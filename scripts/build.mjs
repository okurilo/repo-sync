import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'vite';
import { config } from './vite.mjs';
await build(config);

let commit = null; let branch = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); branch = execFileSync('git', ['branch', '--show-current'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* source archives have no Git identity */ }
await mkdir('dist', { recursive: true });
await writeFile('dist/app-revision.json', JSON.stringify({ schemaVersion: 1, commit, branch }));
