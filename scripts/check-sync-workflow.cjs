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
const analysis = { token: 't', state: 'head', entries, changes: { DELETE: 1 }, findings: [], lineChanges: {}, estimatedBytes: 1000, parts: 1 };
function findAction(node, label) { if (!node || typeof node !== 'object') return null; if (node.type?.displayName === 'Button' && node.props.children === label) return node; for (const child of Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]) { const result = findAction(child, label); if (result) return result; } return null; }
async function begin() { find(render(), 'AppShell').props.outgoing(); await finish('localState', {}); await finish('listCommits', []); await finish('listBranches', ['main']); assert.equal(props().step, 'source'); assert.equal(queue.length, 0, 'source does not analyze automatically'); findAction(props().sourceControls, 'Показать изменения').props.onClick(); await finish('analyze', analysis); await finish('settings', settings); }
const local = { branch: 'main', head: 'h', workingChanges: {staged:0,unstaged:0,untracked:0}, issue: null };
async function incoming() {
  find(render(), 'AppShell').props.incoming(); await finish('localState', local);
  await finish('branchContext', { branches: ['main','feature'], defaultBranch: 'main' });
  await finish('refreshSource', {}); await finish('listCommits', [{sha:'sha',date:'today'}]);
  assert.equal(props().step, 'source'); assert.equal(queue.length, 0, 'no automatic incoming analysis');
}
async function compare() { props().sourceControls.props.compare({mode:'branch',branch:'feature',baseBranch:'main'}); await finish('analyze', analysis); assert.equal(props().step, 'compare'); }
(async () => {
  await incoming();
  props().sourceControls.props.change({mode:'branches',branch:'main',baseBranch:'feature'}); await tick(); assert.equal(queue.length, 0, 'changing mode does not analyze');
  await compare();
  props().checkSelection(); props().checkSelection(); await finish('localState', local);
  await finish('prepareIncoming', {token:'prepared',entries:[entries[0]],conflicts:[],overwritePaths:[{path:'code.ts'}]});
  assert.equal(queue.length,0,'double click performs one preparation'); assert.equal(props().step,'apply');
  props().confirmOverwrite(true); assert(props().overwriteConfirmed);
  props().setStep('compare'); assert.equal(props().selectedIncomingPaths.length,5,'back preserves selected files');
  props().onSelectedIncomingPathsChange(['code.ts']); assert.equal(props().importPreview,null); assert(!props().overwriteConfirmed,'selection invalidates consent');
  props().checkSelection(); await finish('localState',{...local,issue:'Wrong branch'}); assert.equal(queue.length,0,'local blocker prevents prepare'); assert(props().localProblem);
  props().checkSelection(); await finish('localState',local); await finish('prepareIncoming',{token:'next',entries:[entries[0]],conflicts:[],overwritePaths:[{path:'code.ts'}]});
  props().confirmOverwrite(true); props().apply(); const applied=await finish('applyImport',settings); assert.equal(applied.args[1],true); await finish('localState',local); assert.equal(props().step,'done');
  await begin(); props().checkSelection(); await finish('selectExport',{findings:[{id:'f',path:'code.ts',severity:'block'}],originalFindings:[{id:'f',path:'code.ts',severity:'block'}],parts:1,estimatedBytes:20}); await finish('settings',settings);
  assert.equal(props().step,'security'); assert(props().reviewReady);
  const reviewSnapshot=props().reviewFindings;props().decide(['f'],'keep');await tick();assert.equal(queue.length,0,'accepting without a mask does not rescan');assert(props().reviewReady);assert.equal(props().reviewFindings,reviewSnapshot,'review data remains mounted after a local decision');
  props().decide(['f'],'mask'); await tick(); assert(!props().reviewReady,'recalculation invalidates export readiness');
  assert.equal(props().step,'security');assert.equal(props().reviewFindings,reviewSnapshot,'pending recalculation retains the current findings');
  const failed=queue.shift(); assert.equal(failed.name,'selectExport'); failed.reject(new Error('Scan failed')); await tick(); assert(!props().reviewReady); assert.equal(props().error,'Scan failed');
  assert.equal(props().step,'security');assert.equal(props().reviewFindings,reviewSnapshot,'failed recalculation keeps the review visible');
  props().setStep('compare'); props().checkSelection(); await finish('selectExport',{findings:[],originalFindings:[],parts:1,estimatedBytes:20}); await finish('settings',settings); assert.equal(props().step,'apply','no findings still has explicit review stage');
  props().exportPackage(); await finish('exportPackage',['part.md']); await finish('settings',settings); assert.equal(props().step,'done');
  await incoming(); props().sourceControls.props.compare({mode:'branch',branch:'feature',baseBranch:'main'}); await tick(); queue.shift().reject(new Error('Git unavailable')); await tick(); assert.equal(props().step,'source'); assert.equal(props().error,'Git unavailable'); assert.equal(props().analysis,null);
  props().retryComparison(); await finish('analyze',analysis); assert.equal(props().step,'compare','manual retry recovers failed comparison');
  profile.role='external'; find(render(),'AppShell').props.repositories();
  find(render(),'RepositoryCard').props.importPackage(); await finish('choosePackage',['part.md']);
  assert.equal(props().step,'loading','package loading owns a stable frame before Git read'); await finish('localState',local);
  await tick(); const brokenPackage=queue.shift(); assert.equal(brokenPackage.name,'loadPackage'); brokenPackage.reject(new Error('Broken package')); await tick(); assert.equal(props().error,'Broken package');
  props().retryComparison(); await finish('choosePackage',null); assert.equal(props().error,'Broken package','cancelling retry preserves recoverable error'); assert(!props().locked);
  props().retryComparison(); await finish('choosePackage',['part.md']); await finish('localState',local); await finish('loadPackage',{token:'package',entries:[entries[0]],from:'a',to:'b'}); assert.equal(props().step,'compare');
  // Execute the real workflow view as well: check final button guards and source isolation.
  const workflow = {exports:{}};
  const workflowCode=ts.transpileModule(fs.readFileSync('src/renderer/features/SyncWorkflow.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(workflowCode,{exports:workflow.exports,require(name){if(name==='react')return {...React,useMemo:fn=>fn(),useRef:init=>({current:init}),useEffect(){}};if(name==='react/jsx-runtime'||name==='styled-components')return require(name);return new Proxy({},{get:(_,key)=>component(key)});}});
  const view=overrides=>workflow.exports.SyncWorkflow({...props(),...overrides});
  function text(node){if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node?.props?.children??[]);}
  function button(node,label){if(!node||typeof node!=='object')return null;if(node.type?.displayName==='Button'&&text(node).trim()===label)return node;for(const child of Array.isArray(node.props?.children)?node.props.children:[node.props?.children]){const found=button(child,label);if(found)return found;}return null;}
  const exportProps={step:'apply',direction:'outgoing',settings:{...settings,outputDirectory:'/out'},analysis:{...analysis,findings:[]},reviewFindings:[],reviewReady:true,selectedIncomingPaths:['code.ts'],busy:false,locked:false,error:''};
  assert(!button(view(exportProps),'Создать пакет').props.disabled);
  for(const change of [{reviewReady:false},{settings},{selectedIncomingPaths:[]},{locked:true},{error:'failed'},{reviewFindings:[{id:'f',path:'code.ts'}]}])assert(button(view({...exportProps,...change}),'Создать пакет').props.disabled,'unsafe export is disabled');
  const secret={id:'f',path:'code.ts',severity:'block'};
  assert(button(view({...exportProps,analysis:{...analysis,findings:[secret]},reviewFindings:[secret],kept:['f'],override:false}),'Создать пакет').props.disabled,'keeping secret still needs explicit override');
  const incomingProps={step:'apply',direction:'incoming',importPreview:{token:'p',entries:[entries[0]],overwritePaths:[{path:'code.ts'}]},overwriteConfirmed:false,locked:false,busy:false,error:''};
  assert(button(view(incomingProps),'Применить изменения · 1').props.disabled);
  assert(!button(view({...incomingProps,overwriteConfirmed:true}),'Применить изменения · 1').props.disabled);
  assert(button(view({...incomingProps,importPreview:{entries:[],conflicts:[{path:'code.ts'}]}}),'Подтвердить результат').props.disabled,'all-conflict result is not success');
  assert(!button(view({...incomingProps,importPreview:{entries:[]}}),'Подтвердить результат').props.disabled,'no-op result is confirmable');
  const selectionProps={step:'compare',direction:'incoming',locked:false,error:'',comparison:{...props().comparison,entries:[]},selectedIncomingPaths:[]};
  assert(!button(view(selectionProps),'Проверить результат').props.disabled,'empty diff can be checked without writing');
  assert(button(view({...selectionProps,comparison:props().comparison}),'Проверить выбранные файлы').props.disabled,'empty selection of nonempty diff cannot proceed');
  const sourceView=view({...selectionProps,step:'source'});assert(!find(sourceView,'Comparison'),'source stage has no diff or stale actions');
  const sourceModule={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/renderer/features/IncomingSource.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:sourceModule.exports,require(name){if(name==='react')return {...React,useState:init=>[init,()=>{}]};if(name==='react/jsx-runtime')return require(name);return new Proxy({},{get:(_,key)=>component(key)});}});
  const source=selection=>sourceModule.exports.IncomingSource({branch:'feature',context:{branches:['main','feature']},selection,commits:[{sha:'sha',date:'today'}],busy:false,change(){},compare(){},reload(){}});
  for(const mode of ['branch','branches','commit','range','repositories','zero'])assert(!button(source({mode,branch:'feature',baseBranch:'main',from:'from',commit:'sha'}),'Показать изменения').props.disabled,mode+' is available');
  for(const selection of [{mode:'branch',branch:'feature'},{mode:'branches',branch:'feature',baseBranch:'feature'},{mode:'range',branch:'feature',commit:'sha'}])assert(button(source(selection),'Показать изменения').props.disabled,'invalid source cannot be compared');
  console.log('PASS: explicit sources, no automatic analysis, back/selection/consent, single-flight, local blocker, apply, review/scan failure, export and retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
