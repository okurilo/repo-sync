// Exercise the per-file security review with real component output and controlled state.
const fs = require('node:fs'); const vm = require('node:vm'); const assert = require('node:assert/strict'); const ts = require('typescript'); const React = require('react');
const securityReviewSource = fs.readFileSync('src/renderer/features/SecurityReview.tsx', 'utf8'); const workflowSource = fs.readFileSync('src/renderer/features/SyncWorkflow.tsx', 'utf8');
assert(!/position:\s*['"]sticky['"]/.test(securityReviewSource), 'review summary must not create a second sticky footer inside its bounded workspace');
assert(workflowSource.includes('ReviewActionBar') && workflowSource.includes('Файлов в пакете:'), 'package summary belongs in the shared lower action bar');
const states = []; let stateIndex = 0;
const react = { ...React, useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => states[index] = typeof next === 'function' ? next(states[index]) : next]; }, useMemo: fn => fn() };
const components = new Map(); const component = name => { if (!components.has(name)) components.set(name, Object.assign(() => null, { displayName: name })); return components.get(name); };
const styledFactory = () => new Proxy(() => undefined, { apply: () => component('Styled') });
const styled = new Proxy(styledFactory, { get: () => styledFactory });
const moduleReview = { exports: {} }; const code = ts.transpileModule(fs.readFileSync('src/renderer/features/SecurityReview.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsxRuntime = { jsx(type, props, key) { return { type, props: props ?? {}, key }; }, jsxs(type, props, key) { return { type, props: props ?? {}, key }; }, Fragment: Symbol('Fragment') };
vm.runInNewContext(code, { exports: moduleReview.exports, require(name) { if (name === 'react') return react; if (name === 'styled-components') return { __esModule: true, default: styled }; if (name === 'react/jsx-runtime') return jsxRuntime; if (name === '../ui/components') return { Button: component('Button'), Muted: component('Muted'), Row: component('Row') }; return {}; } });
const analysis = { entries: [{ path: 'src/a.txt', operation: 'REPLACE' }, { path: 'src/clean.ts', operation: 'ADD' }, { path: 'blocked/key.json', operation: 'ADD', excludedBy: '*.json' }], findings: [
  { id: 'replaceable', path: 'src/a.txt', line: 1, severity: 'warn', reason: 'Email', preview: 'a@example.test', canReplace: true, context: { before: '', match: 'a@example.test', after: '' } },
  { id: 'not-replaceable', path: 'src/a.txt', line: 2, severity: 'block', reason: 'Token', preview: 'token', canReplace: false },
  { id: 'already-kept', path: 'src/a.txt', line: 3, severity: 'warn', reason: 'Name', preview: 'Alice', canReplace: true }
] };
let lastProps; const actions = [];
function render(props = lastProps) { stateIndex = 0; lastProps = props; return moduleReview.exports.SecurityReview(props); }
const props = { analysis, kept: ['already-kept'], selectedPaths: ['src/a.txt', 'src/clean.ts'], redactedIds: [], decide: (...args) => actions.push(args), togglePath: (...args) => actions.push(args), open: (...args) => actions.push(['open', ...args]), busy: false };
function walk(node, visit) { if (!node || typeof node !== 'object') return; visit(node); const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]; for (const child of children) walk(child, visit); }
function textOf(node) { if (node === null || node === undefined || typeof node === 'boolean') return ''; if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(textOf).join(''); return textOf(node.props?.children); }
function allText(node) { return textOf(node); }
function button(node, exact) { let found; walk(node, item => { if (item.type?.displayName === 'Button' && textOf(item).trim() === exact) found = item; }); return found; }
(async () => {
  let view = render(props); let text = allText(view);
  assert(text.includes('a.txt') && text.includes('clean.ts') && text.includes('key.json'), 'tree contains included, clean and rule-excluded files');
  assert(text.includes('Нужно решение · 2') && text.includes('Без совпадений') && text.includes('Исключено правилом'), `tree status distinguishes review states: ${text}`);
  button(view, 'Принять файл · 2').props.onClick(); assert.equal(JSON.stringify(actions.pop()), JSON.stringify([['replaceable', 'not-replaceable'], 'keep']));
  view = render({ ...props, kept: ['already-kept', 'not-replaceable'] });
  button(view, 'Заменить нерешённые на * · 1').props.onClick(); assert.equal(JSON.stringify(actions.pop()), JSON.stringify([['replaceable'], 'mask']));
  view = render({ ...props, redactedIds: ['replaceable'], kept: ['already-kept'] });
  assert.equal(states[2], 'src/a.txt', 'rerender preserves the selected file');
  states[2] = 'src/clean.ts';
  const cleanView = render({ ...props, redactedIds: ['replaceable'], kept: ['already-kept'] });
  assert(allText(cleanView).includes('Автоматическая проверка может пропустить'), 'clean file has explicit review guidance');
  assert(button(cleanView, 'Следующий нерешённый').props.disabled === false, 'navigation remains available while unresolved findings exist');
  assert(cleanView.props?.children, 'workspace remains mounted after selection changes');
  console.log('PASS: complete file tree, statuses, bulk keep/mask scope, clean files, rule exclusions and persistent review workspace');
})().catch(error => { console.error(error); process.exitCode = 1; });
