// Starts the API, waits until it answers, then starts the web app. The web dev
// server listens on $PORT (the preview port) and proxies /api to $API_PORT, so
// the preview only comes up once the API behind it can serve requests.
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? port + 1);
const env = { ...process.env, PORT: String(port), API_PORT: String(apiPort) };
const children = [];

const stop = () => children.forEach((child) => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function start(args) {
  const child = spawn('npm', args, { stdio: 'inherit', shell: true, env });
  children.push(child);
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
}

async function waitForApi(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${apiPort}/`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

start(['run', 'dev', '-w', 'api']);
if (!(await waitForApi(120_000))) {
  console.warn(`The API did not answer on port ${apiPort}; starting the web app anyway.`);
}
start(['run', 'dev', '-w', 'web', '--', '--port', String(port)]);
