import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export async function writeAppRevision() {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  let commit = null; let branch = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    branch = execFileSync('git', ['branch', '--show-current'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch { /* Архив исходников может не содержать Git. */ }
  await mkdir('dist', { recursive: true });
  await writeFile('dist/app-revision.json', JSON.stringify({ schemaVersion: 2, version, commit, branch }));
}
