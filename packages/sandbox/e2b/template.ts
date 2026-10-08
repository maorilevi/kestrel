/**
 * The E2B image every KESTREL project runs in: Node 24 with npm and git.
 *
 *   E2B_API_KEY=... npm run e2b:template -w @kestrel/sandbox
 *
 * Builds (or rebuilds) the `kestrel-node` template in the E2B account.
 */
import { defaultBuildLogger, Template } from 'e2b';

const template = Template()
  .fromNodeImage('24')
  .aptInstall(['git', 'ca-certificates'], { noInstallRecommends: true })
  .runCmd('git config --system init.defaultBranch main');

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    throw new Error('Set E2B_API_KEY first.');
  }
  const info = await Template.build(template, 'kestrel-node', { onBuildLogs: defaultBuildLogger() });
  console.log(`Built E2B template kestrel-node (${JSON.stringify(info)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
