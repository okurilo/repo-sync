import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';
import { config } from './vite.mjs';

const compiler = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.main.json'], { stdio: 'inherit' });
const code = await new Promise(resolve => compiler.on('exit', resolve));
if (code !== 0) process.exit(1);
const server = await createServer({ ...config, configFile: false });
await server.listen();
const electron = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, REPOSYNC_DEV_URL: 'http://127.0.0.1:5173' } });
const stop = async () => { electron.kill(); await server.close(); process.exit(); };
electron.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
