// Exercise the real App callbacks with controlled React state and delayed IPC.
const fs = require('node:fs'); const vm = require('node:vm'); const crypto = require('node:crypto'); const assert = require('node:assert/strict');
const ts = require('typescript'); const React = require('react');
const states = [], refs = [], memos = []; let si = 0, ri = 0, mi = 0, queue = [];
const profile = { id: 'p', name: 'QA', role: 'internal', sources: { internal: { location: '/local', branch: 'main' }, global: { location: '/remote', branch: 'main' } } };
const settings = { profiles: [profile], globalExclusions: [] };
const react = { ...React, useState(init) { const i = si++; if (!(i in states)) states[i] = i === 0 ? settings : i === 2 ? 'p' : typeof init === 'function' ? init() : init; return [states[i], v => states[i] = typeof v === 'function' ? v(states[i]) : v]; }, useRef(init) { const i = ri++; return refs[i] ?? (refs[i] = { current: init }); }, useEffect() {}, useMemo(fn, deps) { const i = mi++; if (!memos[i] || deps.some((v, j) => !Object.is(v, memos[i].deps[j]))) memos[i] = { value: fn(), deps }; return memos[i].value; } };
const components = new Map(); const component = name => { if (!components.has(name)) components.set(name, Object.assign(() => null, { displayName: name })); return components.get(name); };
const api = new Proxy({}, { get(_, name) { return (...args) => new Promise((resolve, reject) => queue.push({ name, args, resolve, reject })); } });
const moduleApp = { exports: {} }; const code = ts.transpileModule(fs.readFileSync('src/renderer/App.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(code, { exports: moduleApp.exports, require(name) { if (name === 'react') return react; if (name === 'react/jsx-runtime') return require('react/jsx-runtime'); if (name === '../shared/fileRules') return require('../dist/main/shared/fileRules.js'); return new Proxy({}, { get(_, key) { if (key === 'appVersionLabel') return () => ''; return component(key); } }); }, window: { reposync: api }, localStorage: { getItem: () => null }, crypto, console, Error });
function find(node, name) { if (!node || typeof node !== 'object') return null; if (node.type?.displayName === name) return node; for (const child of Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]) { const result = find(child, name); if (result) return result; } return null; }
function render() { si = ri = mi = 0; return moduleApp.exports.App(); }
const props = () => find(render(), 'SyncWorkflow').props;
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function finish(name, value) { await tick(); const q = queue.shift(); assert.equal(q?.name, name); q.resolve(value); await tick(); return q; }
const entries = [{ path: 'code.ts', operation: 'REPLACE' }, { path: 'a.PNG', operation: 'ADD' }, { path: 'b.svg', operation: 'ADD' }, { path: 'old.png', operation: 'DELETE' }, { path: 'renamed.ts', oldPath: 'renamed.png', operation: 'RENAME' }, { path: 'blocked.png', operation: 'ADD', excludedBy: '*.png' }];
const analysis = { token: 't', entries, changes: { DELETE: 1 }, findings: [], lineChanges: {}, estimatedBytes: 1000, parts: 1 };
async function begin() { find(render(), 'AppShell').props.outgoing(); await finish('localState', {}); await finish('listCommits', []); await finish('analyze', analysis); await finish('settings', settings); }
(async () => {
  await begin(); assert.equal(props().includeImages, true); assert.deepEqual(Array.from(props().selectedIncomingPaths), ['code.ts', 'a.PNG', 'b.svg', 'renamed.ts']);
  const stable = props().comparison.entries; assert.equal(props().comparison.entries, stable, 'unrelated render does not restart preview');
  props().onSelectedIncomingPathsChange(['code.ts', 'a.PNG', 'old.png', 'renamed.ts']);
  props().toggleImages(false); await tick(); assert.equal(props().includeImages, false); assert.deepEqual(Array.from(props().selectedIncomingPaths), ['code.ts']);
  assert(props().comparison.entries.filter(e => e.path !== 'code.ts').every(e => e.excludedBy));
  assert(props().locked, 'toggle locks IPC'); const call = await finish('selectExport', { findings: [], estimatedBytes: 10, parts: 1 }); assert.deepEqual(Array.from(call.args[1]), ['code.ts']); assert.equal(props().analysis.estimatedBytes, 10);
  props().exclude({ path: 'a.PNG' }); await tick(); assert.equal(queue.length, 0, 'archived finding cannot restore disabled image'); assert(props().analysis.entries.find(e => e.path === 'a.PNG').excludedBy, 'SecurityReview gets disabled image entries');
  // Bulk selection cannot reintroduce disabled images, including image rename sources and DELETE.
  props().onSelectedIncomingPathsChange(entries.map(e => e.path)); assert.deepEqual(Array.from(props().selectedIncomingPaths), ['code.ts']);
  props().toggleImages(true); const enabled = await finish('selectExport', { findings: [], estimatedBytes: 900, parts: 1 }); assert.deepEqual(Array.from(enabled.args[1]), ['code.ts', 'a.PNG', 'old.png', 'renamed.ts']);
  assert(!props().selectedIncomingPaths.includes('b.svg'), 'individually deselected image stays deselected'); assert(!props().selectedIncomingPaths.includes('blocked.png'), 'project exclusions retained');
  // All-images selection becomes an explicit empty set, never implicit full export.
  props().onSelectedIncomingPathsChange(['a.PNG']); props().toggleImages(false); const empty = await finish('selectExport', { findings: [], estimatedBytes: 0, parts: 1 }); assert.equal(empty.args[1].length, 0); assert.equal(props().selectedIncomingPaths.length, 0);
  // Restarting the workflow restores its documented default.
  await begin(); assert.equal(props().includeImages, true); assert.equal(props().selectedIncomingPaths.length, 4); assert.equal(queue.length, 0);
  console.log('PASS: image option defaults, IPC recalculation, stable preview, empty selection, bulk guards and reversible individual choices');
})().catch(error => { console.error(error); process.exitCode = 1; });
