import type { ParsedClass, ParsedFile } from '../parser/parsed-model';

/**
 * Resolves a symbol name referenced from a file to the class it declares.
 *
 * Resolution order (most specific first):
 *   1. a class declared in the referencing file
 *   2. an import binding whose module resolved to a workspace file
 *   3. a globally unique class with that name
 *
 * Anything else is reported as unresolved so the caller can create an
 * `external` node instead of guessing.
 */
/** A class or a function, reduced to what an id needs. */
export interface DeclaredSymbol {
  name: string;
  filePath: string;
}

export class SymbolIndex {
  private readonly byName = new Map<string, ParsedClass[]>();
  private readonly byPath = new Map<string, ParsedFile>();
  private readonly declarationsByName = new Map<string, DeclaredSymbol[]>();

  constructor(files: readonly ParsedFile[]) {
    for (const file of files) {
      this.byPath.set(file.filePath, file);
      for (const declaration of file.classes) {
        const existing = this.byName.get(declaration.name);
        if (existing) {
          existing.push(declaration);
        } else {
          this.byName.set(declaration.name, [declaration]);
        }
        this.addDeclaration(declaration.name, file.filePath);
      }
      for (const declaration of file.functions) {
        this.addDeclaration(declaration.name, file.filePath);
      }
    }
  }

  private addDeclaration(name: string, filePath: string): void {
    const existing = this.declarationsByName.get(name);
    if (existing) {
      existing.push({ name, filePath });
    } else {
      this.declarationsByName.set(name, [{ name, filePath }]);
    }
  }

  /**
   * Resolves a name to the class *or function* it refers to, using the same
   * order as {@link resolve}. Front-end code is written with functions, so the
   * UI graph needs this.
   */
  resolveDeclaration(fromFilePath: string | undefined, symbolName: string): DeclaredSymbol | undefined {
    const fromFile = fromFilePath ? this.byPath.get(fromFilePath) : undefined;

    if (fromFile) {
      const local =
        fromFile.classes.some((declaration) => declaration.name === symbolName) ||
        fromFile.functions.some((declaration) => declaration.name === symbolName);
      if (local) {
        return { name: symbolName, filePath: fromFile.filePath };
      }

      const binding = fromFile.imports.find((candidate) => candidate.symbol === symbolName);
      if (binding?.resolvedFilePath) {
        const target = this.byPath.get(binding.resolvedFilePath);
        const exported =
          target?.classes.some((declaration) => declaration.name === binding.originalName) ||
          target?.functions.some((declaration) => declaration.name === binding.originalName);
        if (exported && target) {
          return { name: binding.originalName, filePath: target.filePath };
        }
      }
    }

    const candidates = this.declarationsByName.get(symbolName);
    return candidates?.length === 1 ? candidates[0] : undefined;
  }

  getFile(relativePath: string): ParsedFile | undefined {
    return this.byPath.get(relativePath);
  }

  resolve(fromFilePath: string | undefined, symbolName: string): ParsedClass | undefined {
    const fromFile = fromFilePath ? this.byPath.get(fromFilePath) : undefined;

    if (fromFile) {
      const local = fromFile.classes.find((declaration) => declaration.name === symbolName);
      if (local) {
        return local;
      }

      const binding = fromFile.imports.find((candidate) => candidate.symbol === symbolName);
      if (binding?.resolvedFilePath) {
        const target = this.byPath.get(binding.resolvedFilePath);
        const exported = target?.classes.find(
          (declaration) => declaration.name === binding.originalName || declaration.name === symbolName,
        );
        if (exported) {
          return exported;
        }
      }
    }

    const candidates = this.byName.get(symbolName);
    if (candidates?.length === 1) {
      return candidates[0];
    }

    return undefined;
  }

  /** Package the symbol was imported from, when it comes from a bare specifier. */
  resolvePackage(fromFilePath: string | undefined, symbolName: string): string | undefined {
    const fromFile = fromFilePath ? this.byPath.get(fromFilePath) : undefined;
    const binding = fromFile?.imports.find((candidate) => candidate.symbol === symbolName);
    if (!binding) {
      return undefined;
    }
    return /^[./]/.test(binding.moduleSpecifier) ? undefined : binding.moduleSpecifier;
  }
}
