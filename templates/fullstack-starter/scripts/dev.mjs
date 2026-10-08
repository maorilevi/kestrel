// Starts the API and the web app together. The web dev server listens on $PORT
// (the preview port) and proxies /api to the API on $API_PORT.
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? port + 1);
const env = { ...process.env, PORT: String(port), API_PORT: String(apiPort) };

const children = [
  spawn('npm', ['run', 'dev', '-w', 'api'], { stdio: 'inherit', shell: true, env }),
  spawn('npm', ['run', 'dev', '-w', 'web', '--', '--port', String(port)], { stdio: 'inherit', shell: true, env }),
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
