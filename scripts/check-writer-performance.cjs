const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { create, fs } = require('./writer-fixture.cjs');
(async () => {
  const sizes = process.argv.includes('--quick') ? [20, 40] : [100, 200, 1000];
  const baselineArg = process.argv.find(arg => arg.startsWith('--baseline='));
  const baseline = baselineArg ? require('node:fs').readFileSync(baselineArg.slice(11), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const results = []; let measuring = false; let metric;
  const spawn = cp.spawn; const open = fs.open;
  cp.spawn = function(command, args, ...rest) { const start = performance.now(); const counted = measuring && command === 'git'; const child = spawn.call(this, command, args, ...rest); if (counted) { metric.gitCommands++; child.once('close', () => metric.gitMs += performance.now() - start); } return child; };
  fs.open = async function(name, ...args) { const handle = await open.call(this, name, ...args); if (measuring && /journal\.json\.|progress\.log$/.test(String(name))) { const write = handle.writeFile.bind(handle); const sync = handle.sync.bind(handle); handle.writeFile = async (data, ...rest) => { metric.journalWrites++; metric.journalBytes += Buffer.byteLength(data); return write(data, ...rest); }; handle.sync = async () => { const start = performance.now(); try { return await sync(); } finally { metric.journalSyncMs += performance.now() - start; } }; } return handle; };
  try { for (const count of sizes) {
    const fixture = await create({ count, ignored: 2000, mixed: false });
    try { for (const direction of ['apply', 'restore']) {
      const prepared = await fixture.prepare(direction);
      metric = { direction, files: count, gitCommands: 0, gitMs: 0, journalWrites: 0, journalBytes: 0, journalSyncMs: 0 };
      measuring = true; const start = performance.now(); await prepared.run(); measuring = false;
      metric.totalMs = performance.now() - start; const rounded = Object.fromEntries(Object.entries(metric).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])); results.push(rounded); console.log(JSON.stringify(rounded));
      if (baseline.length) { const old = baseline.find(item => item.files === count && item.direction === direction); assert(old && old.totalMs / metric.totalMs >= 2, 'Measured speedup must be at least 2x'); }
      if (process.argv.includes('--assert')) assert(metric.gitCommands < 90, `Git commands grew with files: ${metric.gitCommands}`);
    } } finally { measuring = false; await fixture.cleanup(); }
  }
  if (process.argv.includes('--assert')) for (const direction of ['apply', 'restore']) { const values = results.filter(r => r.direction === direction); assert.equal(values[0].gitCommands, values.at(-1).gitCommands); assert(values.at(-1).journalBytes / values.at(-1).files < 2 * values[0].journalBytes / values[0].files, 'Journal bytes must scale linearly'); }
  } finally { measuring = false; cp.spawn = spawn; fs.open = open; }
})().catch(error => { console.error(error); process.exitCode = 1; });
