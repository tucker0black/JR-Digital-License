import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 5000);
const host = '0.0.0.0';
const botDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'bot'
);

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'ok', service: 'bot', application: 'JR Digital license' }));
});

server.listen(port, host, () => {
  console.info(`Health server listening on ${host}:${port}`);
});

const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: botDir,
  env: process.env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.error(`Bot process exited with code ${code ?? 'signal'}.`);
  const exitCode = typeof code === 'number' ? code : 1;
  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 3000).unref();
});

function shutdown(signal) {
  child.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
