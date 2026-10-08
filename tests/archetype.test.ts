import { describe, expect, it } from 'vitest';

import { profileSources } from './fixtures';

function archetypeOf(
  manifests: Record<string, string>,
  sources: Record<string, string> = {},
): { archetype: string; framework?: string; confidence: string; evidence: string[] } {
  const [project] = profileSources(sources, manifests);
  return {
    archetype: project.archetype,
    framework: project.primaryFramework,
    confidence: project.archetypeConfidence,
    evidence: project.evidence,
  };
}

const pkg = (value: Record<string, unknown>): string => JSON.stringify(value);

describe('serverless archetypes', () => {
  it('detects a Firebase Cloud Function', () => {
    const result = archetypeOf(
      {
        'package.json': pkg({
          name: 'fns',
          dependencies: { 'firebase-functions': '^5.0.0', 'firebase-admin': '^12.0.0' },
        }),
      },
      {
        'src/index.ts': `
import { onRequest } from 'firebase-functions/v2/https';

export const api = onRequest((request, response) => {
  response.send('ok');
});
`,
      },
    );

    expect(result.archetype).toBe('cloud-function');
    expect(result.confidence).toBe('high');
    expect(result.evidence).toContain('package.json: firebase-functions');
    expect(result.evidence).toContain('onRequest() handler');
  });

  it('detects Cloud Functions declared only in firebase.json', () => {
    const result = archetypeOf({
      'package.json': pkg({ name: 'fns', dependencies: { 'firebase-admin': '^12.0.0' } }),
      'firebase.json': JSON.stringify({ functions: { source: '.' } }),
    });

    expect(result.archetype).toBe('cloud-function');
    expect(result.evidence).toContain('firebase.json: functions');
  });

  it('does not mistake Firebase Hosting for Cloud Functions', () => {
    // The client SDK plus a hosting-only config is a web app, not a function.
    const result = archetypeOf(
      {
        'package.json': pkg({
          name: 'web',
          dependencies: { react: '^19.0.0', firebase: '^10.0.0', vite: '^5.0.0' },
        }),
        'firebase.json': JSON.stringify({ hosting: { public: 'dist' } }),
      },
      { 'src/app.tsx': 'export function App() { return <div />; }' },
    );

    expect(result.archetype).toBe('spa');
    expect(result.framework).toBe('React');
  });

  it('detects an AWS Lambda from the serverless manifest', () => {
    const result = archetypeOf(
      {
        'package.json': pkg({ name: 'svc', dependencies: { '@types/aws-lambda': '^8.10.0' } }),
        'serverless.yml': 'service: svc\nprovider:\n  name: aws\n',
      },
      { 'src/handler.ts': 'export const handler = async () => ({ statusCode: 200 });' },
    );

    expect(result.archetype).toBe('lambda-function');
    expect(result.evidence).toContain('exported handler');
  });

  it('detects an Azure Function', () => {
    const result = archetypeOf({
      'package.json': pkg({ name: 'fn', dependencies: { '@azure/functions': '^4.0.0' } }),
    });

    expect(result.archetype).toBe('azure-function');
  });

  it('prefers the serverless runtime over the HTTP framework it embeds', () => {
    // Express inside a Lambda is still a Lambda.
    const result = archetypeOf({
      'package.json': pkg({
        name: 'svc',
        dependencies: { express: '^4.0.0', 'serverless-http': '^3.0.0', 'aws-lambda': '^1.0.0' },
      }),
    });

    expect(result.archetype).toBe('lambda-function');
  });
});

describe('front-end archetypes', () => {
  it('detects an Angular SPA', () => {
    const result = archetypeOf({
      'package.json': pkg({
        name: 'admin',
        dependencies: { '@angular/core': '^18.0.0', '@angular/platform-browser': '^18.0.0' },
        devDependencies: { '@angular/cli': '^18.0.0' },
      }),
    });

    expect(result.archetype).toBe('spa');
    expect(result.framework).toBe('Angular');
  });

  it('detects a Vue SPA', () => {
    const result = archetypeOf({
      'package.json': pkg({ name: 'shop', dependencies: { vue: '^3.4.0', vite: '^5.0.0' } }),
    });

    expect(result.archetype).toBe('spa');
    expect(result.framework).toBe('Vue');
  });

  it('detects a React SPA', () => {
    const result = archetypeOf(
      { 'package.json': pkg({ name: 'web', dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }) },
      { 'src/app.tsx': 'export function App() { return <div />; }' },
    );

    expect(result.archetype).toBe('spa');
    expect(result.framework).toBe('React');
  });

  it('separates a server rendered app from a SPA', () => {
    expect(archetypeOf({ 'package.json': pkg({ name: 'site', dependencies: { next: '^15.0.0', react: '^19.0.0' } }) }))
      .toMatchObject({ archetype: 'ssr-web', framework: 'Next.js' });

    expect(archetypeOf({ 'package.json': pkg({ name: 'site', dependencies: { nuxt: '^3.0.0', vue: '^3.0.0' } }) }))
      .toMatchObject({ archetype: 'ssr-web', framework: 'Nuxt' });
  });

  it('detects a static site generator', () => {
    expect(archetypeOf({ 'package.json': pkg({ name: 'docs', dependencies: { astro: '^4.0.0' } }) }).archetype)
      .toBe('static-site');
  });

  it('detects mobile and desktop shells', () => {
    expect(archetypeOf({ 'package.json': pkg({ name: 'app', dependencies: { expo: '^51.0.0', react: '^19.0.0' } }) }))
      .toMatchObject({ archetype: 'mobile-app' });

    expect(archetypeOf({ 'package.json': pkg({ name: 'app', dependencies: { electron: '^30.0.0' } }) }).archetype)
      .toBe('desktop-app');
  });
});

describe('server archetypes', () => {
  it('detects a REST API from its controllers', () => {
    const result = archetypeOf(
      {
        'package.json': pkg({
          name: 'api',
          dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/platform-express': '^10.0.0' },
        }),
      },
      {
        'src/users.controller.ts': `
import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
      },
    );

    expect(result.archetype).toBe('rest-api');
    expect(result.framework).toBe('NestJS');
    expect(result.evidence).toContain('1 controller(s)');
  });

  it('detects a GraphQL API', () => {
    const result = archetypeOf(
      {
        'package.json': pkg({
          name: 'api',
          dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/graphql': '^12.0.0' },
        }),
      },
      {
        'src/users.resolver.ts': `
import { Resolver } from '@nestjs/graphql';

@Resolver()
export class UsersResolver {}
`,
      },
    );

    expect(result.archetype).toBe('graphql-api');
  });

  it('detects a background worker', () => {
    const result = archetypeOf(
      {
        'package.json': pkg({
          name: 'jobs',
          dependencies: { '@nestjs/core': '^10.0.0', bullmq: '^5.0.0' },
        }),
      },
      {
        'src/jobs.module.ts': `
import { Module } from '@nestjs/common';

@Module({})
export class JobsModule {}
`,
      },
    );

    expect(result.archetype).toBe('worker');
    expect(result.evidence).toContain('no controllers');
  });
});

describe('tooling archetypes', () => {
  it('detects a CLI from the bin field', () => {
    const result = archetypeOf({
      'package.json': pkg({ name: 'tool', bin: { tool: './dist/cli.js' }, dependencies: { commander: '^12.0.0' } }),
    });

    expect(result.archetype).toBe('cli');
  });

  it('detects a VS Code extension', () => {
    const result = archetypeOf({
      'package.json': pkg({
        name: 'ext',
        engines: { vscode: '^1.85.0' },
        contributes: { commands: [] },
      }),
    });

    expect(result.archetype).toBe('vscode-extension');
  });

  it('detects an end to end test package', () => {
    const result = archetypeOf(
      { 'package.json': pkg({ name: '@org/api-e2e', devDependencies: { jest: '^29.0.0' } }) },
      { 'src/support/helpers.ts': 'export const wait = () => undefined;' },
    );

    expect(result.archetype).toBe('test-suite');
  });

  it('falls back to a library when nothing runtime-specific is found', () => {
    const result = archetypeOf(
      { 'package.json': pkg({ name: 'sdk', main: './dist/index.js' }) },
      { 'src/client.ts': 'export class TracerClient {}' },
    );

    expect(result.archetype).toBe('library');
  });
});

describe('monorepo archetypes', () => {
  const manifests = {
    'package.json': pkg({
      name: '@org/source',
      dependencies: {
        '@nestjs/core': '^10.0.0',
        '@nestjs/platform-express': '^10.0.0',
        react: '^19.0.0',
        vite: '^5.0.0',
      },
    }),
    'apps/api/package.json': pkg({ name: '@org/api', dependencies: { '@nestjs/core': '^10.0.0' } }),
    'apps/web/package.json': pkg({ name: '@org/web' }),
    'apps/api-e2e/package.json': pkg({ name: '@org/api-e2e' }),
    'packages/sdk/package.json': pkg({ name: '@org/sdk', main: './index.js' }),
  };

  const sources = {
    'apps/api/src/users.controller.ts': `
import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
    'apps/web/src/app.tsx': 'export function App() { return <div />; }',
    'apps/api-e2e/src/support.ts': 'export const wait = () => undefined;',
    'packages/sdk/src/client.ts': 'export class Client {}',
    'tools/build.ts': 'export const build = () => undefined;',
  };

  const projects = profileSources(sources, manifests);
  const byId = (id: string) => projects.find((project) => project.id === id);

  it('labels every package with what it actually is', () => {
    expect(byId('apps/api')).toMatchObject({ archetype: 'rest-api', primaryFramework: 'NestJS' });
    expect(byId('apps/web')).toMatchObject({ archetype: 'spa', primaryFramework: 'React' });
    expect(byId('apps/api-e2e')?.archetype).toBe('test-suite');
    expect(byId('packages/sdk')?.archetype).toBe('library');
    expect(byId('.')?.archetype).toBe('workspace-root');
  });

  it('gives the workspace root no framework of its own', () => {
    expect(byId('.')?.primaryFramework).toBeUndefined();
  });

  it('carries a human readable label for the toolbar', () => {
    expect(byId('apps/api')?.archetypeLabel).toBe('REST API');
    expect(byId('apps/web')?.archetypeLabel).toBe('SPA');
    expect(byId('.')?.archetypeLabel).toBe('Workspace Root');
  });
});

describe('framework attribution', () => {
  const manifests = {
    'package.json': pkg({
      name: 'root',
      dependencies: { '@nestjs/core': '^10.0.0', react: '^19.0.0' },
    }),
    'packages/sdk/package.json': pkg({ name: 'sdk', main: './index.js' }),
    'apps/api/package.json': pkg({ name: 'api' }),
  };

  const sources = {
    'packages/sdk/src/client.ts': 'export class Client {}',
    'apps/api/src/users.controller.ts': `
import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
  };

  const projects = profileSources(sources, manifests);

  it('never lets a library claim the framework of the app next door', () => {
    const sdk = projects.find((project) => project.id === 'packages/sdk');
    expect(sdk?.archetype).toBe('library');
    expect(sdk?.primaryFramework).toBeUndefined();
  });

  it('borrows a hoisted framework when the archetype is defined by one', () => {
    const api = projects.find((project) => project.id === 'apps/api');
    expect(api?.archetype).toBe('rest-api');
    expect(api?.primaryFramework).toBe('NestJS');
  });
});
