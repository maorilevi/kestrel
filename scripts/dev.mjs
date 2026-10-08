// Local development: builds the scanner bundle, then runs the control plane
// (http://localhost:4000) and the web app (http://localhost:3000) together.
import { spawn, spawnSync } from 'node:child_process';

const build = spawnSync('npm', ['run', 'build', '-w', '@kestrel/core'], { stdio: 'inherit', shell: true });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const children = [
  spawn('npm', ['run', 'dev', '-w', '@kestrel/server'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev', '-w', '@kestrel/web'], { stdio: 'inherit', shell: true }),
];

const stop = () => children.forEach((child) => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
