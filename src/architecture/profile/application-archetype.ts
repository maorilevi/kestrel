import type { ScannedManifest } from '../scanner/repository-scanner';

/**
 * What an application actually *is* at runtime.
 *
 * `ProjectKind` answers "server or client"; the archetype answers "a Cloud
 * Function, a Lambda, a REST service, an Angular SPA". It is what a developer
 * would call the thing in conversation, and it is what the toolbar shows.
 */
export type ApplicationArchetype =
  | 'rest-api'
  | 'graphql-api'
  | 'cloud-function'
  | 'lambda-function'
  | 'azure-function'
  | 'worker'
  | 'cli'
  | 'spa'
  | 'ssr-web'
  | 'static-site'
  | 'mobile-app'
  | 'desktop-app'
  | 'vscode-extension'
  | 'test-suite'
  | 'library'
  | 'workspace-root'
  | 'unknown';

export const ARCHETYPE_LABELS: Readonly<Record<ApplicationArchetype, string>> = {
  'rest-api': 'REST API',
  'graphql-api': 'GraphQL API',
  'cloud-function': 'Cloud Function',
  'lambda-function': 'Lambda',
  'azure-function': 'Azure Function',
  worker: 'Worker',
  cli: 'CLI',
  spa: 'SPA',
  'ssr-web': 'SSR Web App',
  'static-site': 'Static Site',
  'mobile-app': 'Mobile App',
  'desktop-app': 'Desktop App',
  'vscode-extension': 'VS Code Extension',
  'test-suite': 'Test Suite',
  library: 'Library',
  'workspace-root': 'Workspace Root',
  unknown: 'Unknown',
};

/** Groups archetypes for colour coding and for coarse behaviour. */
export type ArchetypeFamily = 'server' | 'serverless' | 'client' | 'tooling' | 'container';

export const ARCHETYPE_FAMILY: Readonly<Record<ApplicationArchetype, ArchetypeFamily>> = {
  'rest-api': 'server',
  'graphql-api': 'server',
  worker: 'server',
  'cloud-function': 'serverless',
  'lambda-function': 'serverless',
  'azure-function': 'serverless',
  spa: 'client',
  'ssr-web': 'client',
  'static-site': 'client',
  'mobile-app': 'client',
  'desktop-app': 'client',
  cli: 'tooling',
  'vscode-extension': 'tooling',
  'test-suite': 'tooling',
  library: 'tooling',
  'workspace-root': 'container',
  unknown: 'container',
};

/** Facts read from a `package.json` beyond its dependencies. */
export interface PackageFacts {
  name: string;
  hasBin: boolean;
  hasEntryPoint: boolean;
  vsCodeEngine: boolean;
  hasContributes: boolean;
  workspaces: boolean;
  scripts: string[];
}

export interface ArchetypeInput {
  facts: PackageFacts;
  /** Dependencies the package declares itself. */
  ownDependencies: Record<string, string>;
  /** Dependencies hoisted to an ancestor package. */
  inheritedDependencies: Record<string, string>;
  /** Manifests that live inside this project (or apply to it). */
  manifests: readonly ScannedManifest[];
  hasChildren: boolean;
  controllerCount: number;
  moduleCount: number;
  tsxCount: number;
  fileCount: number;
  /** Function call names seen anywhere in the project's sources. */
  callNames: ReadonlySet<string>;
  /** Names of exported functions and constants. */
  exportNames: ReadonlySet<string>;
}

export interface ArchetypeResult {
  archetype: ApplicationArchetype;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  /** The framework that identifies the application, e.g. `React`, `NestJS`. */
  primaryFramework?: string;
}

/* ------------------------------------------------------------------ tables */

/** Packages that identify a UI framework, in display priority order. */
const UI_FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ['@angular/core', 'Angular'],
  ['nuxt', 'Nuxt'],
  ['next', 'Next.js'],
  ['@remix-run/react', 'Remix'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['astro', 'Astro'],
  ['gatsby', 'Gatsby'],
  ['react-native', 'React Native'],
  ['expo', 'Expo'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['solid-js', 'SolidJS'],
  ['preact', 'Preact'],
  ['react', 'React'],
  ['lit', 'Lit'],
  ['@ionic/angular', 'Ionic'],
  ['@ionic/react', 'Ionic'],
];

/** Packages that identify a server framework, in display priority order. */
const SERVER_FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ['@nestjs/core', 'NestJS'],
  ['@nestjs/common', 'NestJS'],
  ['fastify', 'Fastify'],
  ['express', 'Express'],
  ['koa', 'Koa'],
  ['@hapi/hapi', 'Hapi'],
  ['hono', 'Hono'],
];

const GRAPHQL_PACKAGES = [
  '@nestjs/graphql',
  '@apollo/server',
  'apollo-server',
  'apollo-server-express',
  'graphql-yoga',
  'type-graphql',
  'mercurius',
];

const CLOUD_FUNCTION_PACKAGES = ['firebase-functions', '@google-cloud/functions-framework'];
const CLOUD_FUNCTION_CALLS = [
  'onRequest',
  'onCall',
  'onSchedule',
  'onDocumentCreated',
  'onDocumentWritten',
  'onObjectFinalized',
  'onValueCreated',
  'cloudEvent',
  'http',
];

const LAMBDA_PACKAGES = [
  'aws-lambda',
  '@types/aws-lambda',
  'serverless',
  'serverless-http',
  '@aws-sdk/client-lambda',
  'aws-cdk-lib',
  'sst',
  '@middy/core',
];

const AZURE_FUNCTION_PACKAGES = ['@azure/functions', 'azure-functions-core-tools'];

const WORKER_PACKAGES = [
  'bullmq',
  'bull',
  '@nestjs/bull',
  '@nestjs/bullmq',
  'agenda',
  'node-cron',
  'bree',
  'kafkajs',
  '@nestjs/microservices',
  'amqplib',
  'temporalio',
  '@temporalio/worker',
];

const CLI_PACKAGES = ['commander', 'yargs', 'oclif', '@oclif/core', 'inquirer', 'cac', 'meow'];

const MOBILE_PACKAGES = ['react-native', 'expo', '@ionic/angular', '@ionic/react', '@capacitor/core'];

const DESKTOP_PACKAGES = ['electron', '@tauri-apps/api', 'nw'];

const SSR_PACKAGES = ['next', 'nuxt', '@remix-run/node', '@remix-run/react', '@sveltejs/kit', '@angular/ssr', '@nguniversal/express-engine'];

const STATIC_SITE_PACKAGES = ['astro', 'gatsby', '@11ty/eleventy', 'vitepress', '@docusaurus/core', 'vuepress'];

const SPA_FRAMEWORK_PACKAGES = ['react', 'react-dom', 'vue', 'svelte', 'solid-js', 'preact', '@angular/core', 'lit'];

const BUNDLER_PACKAGES = ['vite', 'webpack', 'react-scripts', 'parcel', '@angular/cli', '@vitejs/plugin-react', 'rsbuild'];

const TEST_PACKAGES = ['@playwright/test', 'cypress', 'jest', 'vitest', '@nx/jest', 'supertest'];

/* --------------------------------------------------------------- detection */

/**
 * Decides what an application is. Rules are ordered from most specific to
 * least: a Firebase Functions package that also uses Express is a Cloud
 * Function, not a REST service.
 */
export function detectArchetype(input: ArchetypeInput): ArchetypeResult {
  const evidence: string[] = [];
  const own = input.ownDependencies;
  const all = { ...input.inheritedDependencies, ...input.ownDependencies };

  /**
   * Own dependencies decide; hoisted ones only refine.
   *
   * In a monorepo every package inherits the union of the root's dependencies,
   * so an inherited package alone must never name the archetype — otherwise an
   * e2e project next to a React app becomes a React app.
   */
  const hasOwn = (packageName: string): boolean => Boolean(own[packageName]);

  const ownOf = (packages: readonly string[]): string | undefined =>
    packages.find((packageName) => hasOwn(packageName));

  const anyOf = (packages: readonly string[]): string | undefined =>
    packages.find((packageName) => Boolean(all[packageName]));

  const note = (text: string): void => {
    if (!evidence.includes(text)) {
      evidence.push(text);
    }
  };

  const manifestNamed = (fileName: string): ScannedManifest | undefined =>
    input.manifests.find((manifest) => basename(manifest.relativePath) === fileName);

  const result = (
    archetype: ApplicationArchetype,
    confidence: ArchetypeResult['confidence'],
  ): ArchetypeResult => ({
    archetype,
    confidence,
    evidence,
    primaryFramework: primaryFrameworkFor(archetype, own, all),
  });

  // 0. A workspace root hoists dependencies for its packages and is not itself
  //    an application.
  if (input.hasChildren && input.controllerCount === 0 && input.tsxCount === 0) {
    note('holds nested packages');
    return result('workspace-root', 'high');
  }

  // 1. VS Code extension — unambiguous from the manifest.
  if (input.facts.vsCodeEngine) {
    note('package.json: engines.vscode');
    if (input.facts.hasContributes) {
      note('package.json: contributes');
    }
    return result('vscode-extension', 'high');
  }

  // 2. Serverless runtimes. These win over the HTTP framework they embed.
  const firebase = manifestNamed('firebase.json');
  const firebaseFunctions = firebase !== undefined && hasJsonKey(firebase.content, 'functions');
  const cloudFunctionPackage = anyOf(CLOUD_FUNCTION_PACKAGES);
  const cloudFunctionCall = CLOUD_FUNCTION_CALLS.find((name) => input.callNames.has(name));

  if (
    ownOf(CLOUD_FUNCTION_PACKAGES) ||
    firebaseFunctions ||
    (cloudFunctionPackage && cloudFunctionCall)
  ) {
    if (cloudFunctionPackage) {
      note(`package.json: ${cloudFunctionPackage}`);
    }
    if (firebaseFunctions) {
      note('firebase.json: functions');
    }
    if (cloudFunctionCall) {
      note(`${cloudFunctionCall}() handler`);
    }
    return result('cloud-function', cloudFunctionCall || firebaseFunctions ? 'high' : 'medium');
  }

  const serverless = manifestNamed('serverless.yml') ?? manifestNamed('serverless.yaml');
  const samTemplate = manifestNamed('template.yaml') ?? manifestNamed('template.yml');
  const lambdaPackage = anyOf(LAMBDA_PACKAGES);

  if (
    ownOf(LAMBDA_PACKAGES) ||
    serverless ||
    (samTemplate && /AWS::Serverless/.test(samTemplate.content)) ||
    (lambdaPackage && input.exportNames.has('handler'))
  ) {
    if (lambdaPackage) {
      note(`package.json: ${lambdaPackage}`);
    }
    if (serverless) {
      note(`${serverless.relativePath}`);
    }
    if (samTemplate) {
      note('SAM template');
    }
    if (input.exportNames.has('handler')) {
      note('exported handler');
    }
    return result('lambda-function', serverless || lambdaPackage ? 'high' : 'medium');
  }

  const azurePackage = anyOf(AZURE_FUNCTION_PACKAGES);
  const hostJson = manifestNamed('host.json');
  if (ownOf(AZURE_FUNCTION_PACKAGES) || hostJson) {
    if (azurePackage) {
      note(`package.json: ${azurePackage}`);
    }
    if (hostJson) {
      note('host.json');
    }
    return result('azure-function', azurePackage ? 'high' : 'medium');
  }

  // 3. Client runtimes that are not browsers.
  const mobile = ownOf(MOBILE_PACKAGES);
  if (mobile) {
    note(`package.json: ${mobile}`);
    return result('mobile-app', 'high');
  }

  const desktop = ownOf(DESKTOP_PACKAGES);
  if (desktop) {
    note(`package.json: ${desktop}`);
    return result('desktop-app', 'high');
  }

  // 4. Web front-ends: rendering strategy decides the archetype.
  const ssr = anyOf(SSR_PACKAGES);
  if (ssr && (hasOwn(ssr) || input.tsxCount > 0)) {
    note(`package.json: ${ssr}`);
    if (input.tsxCount > 0) {
      note(`${input.tsxCount} .tsx file(s)`);
    }
    return result('ssr-web', hasOwn(ssr) ? 'high' : 'medium');
  }

  const staticSite = ownOf(STATIC_SITE_PACKAGES);
  if (staticSite) {
    note(`package.json: ${staticSite}`);
    return result('static-site', 'high');
  }

  const spaFramework = anyOf(SPA_FRAMEWORK_PACKAGES);
  const bundler = anyOf(BUNDLER_PACKAGES);
  const serverFramework = anyOf(SERVER_FRAMEWORKS.map(([packageName]) => packageName));

  // A UI framework plus files that render: a browser application. An inherited
  // framework needs its own rendering files to count.
  const spaProven =
    spaFramework !== undefined &&
    input.controllerCount === 0 &&
    (input.tsxCount > 0 || (hasOwn(spaFramework) && bundler !== undefined));

  if (spaFramework && spaProven) {
    note(`package.json: ${spaFramework}`);
    if (bundler) {
      note(`bundler: ${bundler}`);
    }
    if (input.tsxCount > 0) {
      note(`${input.tsxCount} .tsx file(s)`);
    }
    return result('spa', hasOwn(spaFramework) || input.tsxCount > 0 ? 'high' : 'medium');
  }

  // 5. Server side.
  const graphql = anyOf(GRAPHQL_PACKAGES);
  if (graphql && (hasOwn(graphql) || input.controllerCount > 0) && (serverFramework || input.controllerCount > 0)) {
    note(`package.json: ${graphql}`);
    return result('graphql-api', 'high');
  }

  const workerPackage = anyOf(WORKER_PACKAGES);
  if (
    workerPackage &&
    (hasOwn(workerPackage) || input.moduleCount > 0) &&
    input.controllerCount === 0 &&
    input.moduleCount > 0
  ) {
    note(`package.json: ${workerPackage}`);
    note('no controllers');
    return result('worker', 'medium');
  }

  if (input.controllerCount > 0) {
    note(`${input.controllerCount} controller(s)`);
    if (serverFramework) {
      note(`package.json: ${serverFramework}`);
    }
    return result('rest-api', 'high');
  }

  if (serverFramework && hasOwn(serverFramework)) {
    note(`package.json: ${serverFramework}`);
    return result('rest-api', 'medium');
  }

  if (workerPackage && hasOwn(workerPackage)) {
    note(`package.json: ${workerPackage}`);
    return result('worker', 'low');
  }

  // 6. Tooling and libraries.
  const cliPackage = anyOf(CLI_PACKAGES);
  if (input.facts.hasBin || cliPackage) {
    if (input.facts.hasBin) {
      note('package.json: bin');
    }
    if (cliPackage) {
      note(`package.json: ${cliPackage}`);
    }
    return result('cli', input.facts.hasBin ? 'high' : 'medium');
  }

  if (looksLikeTestSuite(input)) {
    note(`${input.facts.name} contains only test tooling`);
    return result('test-suite', 'medium');
  }

  if (input.fileCount > 0) {
    if (input.facts.hasEntryPoint) {
      note('package.json: main / exports');
    } else {
      note('no runtime signals found');
    }
    return result('library', input.facts.hasEntryPoint ? 'medium' : 'low');
  }

  return result('unknown', 'low');
}

/** A package named `*-e2e` whose only dependencies are test runners. */
function looksLikeTestSuite(input: ArchetypeInput): boolean {
  const named = /(^|[-.])(e2e|tests?|spec)$/i.test(input.facts.name.replace(/^@[^/]+\//, ''));
  if (!named) {
    return false;
  }

  const dependencies = Object.keys(input.ownDependencies);
  const onlyTestTooling = dependencies.every((name) => TEST_PACKAGES.includes(name));
  return onlyTestTooling && input.controllerCount === 0 && input.tsxCount === 0;
}

/**
 * The framework worth showing next to the archetype.
 *
 * A package's own dependency always wins. A hoisted one is only borrowed when
 * the archetype is defined by a framework — a REST API or an SPA. A library or
 * a test package never claims the framework of the app next door.
 */
function primaryFrameworkFor(
  archetype: ApplicationArchetype,
  own: Record<string, string>,
  all: Record<string, string>,
): string | undefined {
  const family = ARCHETYPE_FAMILY[archetype];
  if (family === 'container') {
    return undefined;
  }

  const tables =
    family === 'client'
      ? [UI_FRAMEWORKS, SERVER_FRAMEWORKS]
      : [SERVER_FRAMEWORKS, UI_FRAMEWORKS];

  const lookup = (dependencies: Record<string, string>): string | undefined => {
    for (const table of tables) {
      for (const [packageName, label] of table) {
        if (dependencies[packageName]) {
          return label;
        }
      }
    }
    return undefined;
  };

  const declared = lookup(own);
  if (declared || family === 'tooling') {
    return declared;
  }
  return lookup(all);
}

/** True when a JSON manifest declares a top level key with real content. */
function hasJsonKey(content: string, key: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    const value = (parsed as Record<string, unknown>)[key];
    return value !== undefined && value !== null;
  } catch {
    return false;
  }
}

function basename(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}
