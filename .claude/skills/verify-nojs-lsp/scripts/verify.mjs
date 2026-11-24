#!/usr/bin/env node
// verify-nojs-lsp harness: build, health-check and drive the No.JS language server over LSP stdio,
// and package + smoke-test the VS Code extension.
// Usage: node .claude/skills/verify-nojs-lsp/scripts/verify.mjs <launch|doctor|drive|package|cleanup> [options]
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const VERIFY_DIR = path.join(ROOT, '.verify');
const EVIDENCE_DIR = path.join(VERIFY_DIR, 'evidence');
const RUN_DIR = path.join(VERIFY_DIR, 'run');
const SERVER_BUNDLE = path.join(ROOT, 'out/server/src/server.js');
const CLIENT_BUNDLE = path.join(ROOT, 'out/client/src/extension.js');
const BIN = path.join(ROOT, 'bin/nojs-language-server.js');
const STEP_TIMEOUT = Number(process.env.VERIFY_STEP_TIMEOUT || 5000);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const command = opts._[0];

function gitSha() {
  try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

function bundleIsStale() {
  if (!fs.existsSync(SERVER_BUNDLE)) return true;
  const src = Math.max(newestMtime(path.join(ROOT, 'server/src')), newestMtime(path.join(ROOT, 'client/src')));
  return src > fs.statSync(SERVER_BUNDLE).mtimeMs;
}

// ── LSP client over stdio ──
class LspSession {
  constructor(serverEntry, transcriptFile, stderrFile) {
    this.transcriptFile = transcriptFile;
    this.proc = spawn(process.execPath, [serverEntry, '--stdio'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', (d) => fs.appendFileSync(stderrFile, d));
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.buffer = Buffer.alloc(0);
    this.exited = new Promise((resolve) => this.proc.on('exit', (code, signal) => resolve({ code, signal })));
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
  }

  record(direction, msg) {
    fs.appendFileSync(this.transcriptFile, JSON.stringify({ t: new Date().toISOString(), dir: direction, msg }) + '\n');
  }

  send(msg) {
    const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
    this.record('client->server', JSON.parse(body));
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const length = Number((this.buffer.slice(0, headerEnd).toString().match(/Content-Length: (\d+)/i) || [])[1]);
      if (this.buffer.length < headerEnd + 4 + length) return;
      const msg = JSON.parse(this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString());
      this.buffer = this.buffer.slice(headerEnd + 4 + length);
      this.record('server->client', msg);
      if (msg.id !== undefined && msg.method) this.send({ id: msg.id, result: null });
      else if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) this.notifications.push(msg);
    }
  }

  request(method, params) {
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} got no response within ${STEP_TIMEOUT}ms`)); }, STEP_TIMEOUT);
    });
    this.send({ id, method, params });
    return p;
  }

  notify(method, params) { this.send({ method, params }); }

  async initialize(rootDir) {
    const rootUri = pathToFileURL(rootDir).href;
    const result = await this.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'verify-nojs-lsp' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(rootDir) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: true },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix'] } } },
        },
        workspace: { workspaceFolders: true },
      },
    });
    this.notify('initialized', {});
    return result;
  }

  async shutdown() {
    try { await this.request('shutdown', null); } catch { /* reported by exit status below */ }
    this.notify('exit', null);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
    const status = await Promise.race([this.exited, timeout]);
    if (status === null) { this.proc.kill('SIGKILL'); return { code: null, signal: 'SIGKILL (did not exit within 3s)' }; }
    return status;
  }
}

function serverEntryFrom(o) {
  return o.server && o.server !== true ? path.resolve(o.server) : BIN;
}

// ── launch: build once ──
function launch() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules/vscode-languageserver'))) {
    console.log('INSTALL npm ci');
    const i = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
    if (i.status !== 0) { console.error('FAIL: npm ci exited ' + i.status); process.exit(1); }
  }
  console.log('BUILD npm run compile (esbuild -> out/; the bundles are tracked, commit them with source changes)');
  const b = spawnSync('npm', ['run', 'compile'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0 || !fs.existsSync(SERVER_BUNDLE) || !fs.existsSync(CLIENT_BUNDLE)) {
    console.error(`FAIL: npm run compile exited ${b.status}; expected ${path.relative(ROOT, SERVER_BUNDLE)} and ${path.relative(ROOT, CLIENT_BUNDLE)}`);
    process.exit(1);
  }
  console.log(`READY server=${path.relative(ROOT, BIN)} -> ${path.relative(ROOT, SERVER_BUNDLE)} nojs-lsp=${pkg.version} sha=${gitSha()}`);
}

// ── doctor ──
async function handshake(serverEntry, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ws = fs.mkdtempSync(path.join(RUN_DIR, 'doctor-'));
  const session = new LspSession(serverEntry, path.join(outDir, 'transcript.jsonl'), path.join(outDir, 'server-stderr.log'));
  try {
    const init = await session.initialize(ws);
    const exit = await session.shutdown();
    return { init, exit };
  } finally {
    if (session.proc.exitCode === null) session.proc.kill('SIGKILL');
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

const EXPECTED_CAPABILITIES = ['completionProvider', 'hoverProvider', 'definitionProvider', 'referencesProvider', 'documentSymbolProvider', 'documentLinkProvider', 'semanticTokensProvider', 'codeActionProvider', 'inlayHintProvider'];

async function doctor() {
  let failed = false;
  const report = (status, msg) => { if (status === 'FAIL') failed = true; console.log(`${status} ${msg}`); };
  const serverEntry = serverEntryFrom(opts);
  if (fs.existsSync(SERVER_BUNDLE)) report('OK', `${path.relative(ROOT, SERVER_BUNDLE)} exists`);
  else report('FAIL', `${path.relative(ROOT, SERVER_BUNDLE)} missing: run launch`);
  if (bundleIsStale()) report('WARN', 'out/ is older than server/src or client/src: run launch to rebuild');
  else report('OK', 'out/ is newer than every file in server/src and client/src');
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(RUN_DIR, 'doctor-transcript-'));
  try {
    const { init, exit } = await handshake(serverEntry, outDir);
    const caps = init?.capabilities || {};
    const missing = EXPECTED_CAPABILITIES.filter((c) => !caps[c]);
    if (missing.length === 0) report('OK', `initialize answered by ${path.relative(ROOT, serverEntry)} with all ${EXPECTED_CAPABILITIES.length} expected capabilities; completion triggers ${JSON.stringify(caps.completionProvider.triggerCharacters)}`);
    else report('FAIL', `initialize capabilities missing: ${missing.join(', ')}`);
    if (exit.code === 0) report('OK', 'server exited 0 after shutdown/exit');
    else report('FAIL', `server exit after shutdown/exit: ${JSON.stringify(exit)}`);
  } catch (err) {
    report('FAIL', `LSP handshake failed: ${err.message} (stderr: ${path.relative(ROOT, outDir)}/server-stderr.log)`);
  }
  if (!failed) fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

// ── drive ──
function offsetToPosition(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}

function locate(text, at) {
  const spec = typeof at === 'string' ? { text: at } : at;
  let idx = -1;
  for (let n = 0; n <= (spec.occurrence || 0); n++) {
    idx = text.indexOf(spec.text, idx + 1);
    if (idx === -1) throw new Error(`anchor ${JSON.stringify(spec.text)} (occurrence ${spec.occurrence || 0}) not found in document`);
  }
  return offsetToPosition(text, idx + spec.text.length + (spec.delta || 0));
}

const labelsOf = (items) => (Array.isArray(items) ? items : items?.items || []).map((i) => i.label);
const hoverText = (h) => {
  if (!h) return '';
  const c = h.contents;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x.value)).join('\n');
  return c.value || '';
};

function checkList(desc, actual, expect = {}, exact = false) {
  const hit = (a, x) => (exact ? a === x : a.includes(x));
  const missing = (expect.includes || []).filter((x) => !actual.some((a) => hit(a, x)));
  const present = (expect.excludes || []).filter((x) => actual.some((a) => hit(a, x)));
  const problems = [];
  if (missing.length) problems.push(`missing ${JSON.stringify(missing)}`);
  if (present.length) problems.push(`unexpected ${JSON.stringify(present)}`);
  if (expect.count !== undefined && actual.length !== expect.count) problems.push(`count ${actual.length} != ${expect.count}`);
  if (expect.min !== undefined && actual.length < expect.min) problems.push(`count ${actual.length} < ${expect.min}`);
  const duplicates = actual.filter((a, i) => actual.indexOf(a) !== i);
  if (expect.unique && duplicates.length) problems.push(`duplicates ${JSON.stringify([...new Set(duplicates)])}`);
  if (problems.length) throw new Error(`${desc}: ${problems.join('; ')}`);
}

async function drive() {
  if (!opts.scenario) { console.error('usage: verify.mjs drive --scenario <file.json> [--server <entry.js>]'); process.exit(2); }
  const scenarioPath = path.resolve(opts.scenario);
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  const name = opts.name || scenario.name || path.basename(scenarioPath, '.json');
  const serverEntry = serverEntryFrom(opts);
  const outDir = path.join(EVIDENCE_DIR, `${stamp()}-${name}`);
  fs.mkdirSync(path.join(outDir, 'documents'), { recursive: true });
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const ws = fs.mkdtempSync(path.join(RUN_DIR, `${name}-`));

  const docs = {};
  for (const [file, spec] of Object.entries(scenario.documents || {})) {
    const text = typeof spec === 'string' ? spec : fs.readFileSync(path.resolve(path.dirname(scenarioPath), spec.file), 'utf8');
    docs[file] = { text, version: 1, uri: pathToFileURL(path.join(ws, file)).href };
    fs.mkdirSync(path.dirname(path.join(ws, file)), { recursive: true });
    fs.writeFileSync(path.join(ws, file), text);
    fs.copyFileSync(path.join(ws, file), path.join(outDir, 'documents', file.replace(/[\\/]/g, '__')));
  }

  const log = (line) => fs.appendFileSync(path.join(outDir, 'steps.log'), line + '\n');
  const session = new LspSession(serverEntry, path.join(outDir, 'transcript.jsonl'), path.join(outDir, 'server-stderr.log'));
  const doc = (file) => { if (!docs[file]) throw new Error(`document ${file} not declared in scenario.documents`); return docs[file]; };
  const save = (i, verb, data) => fs.writeFileSync(path.join(outDir, `${String(i).padStart(2, '0')}-${verb}.json`), JSON.stringify(data, null, 2));
  const latestDiagnostics = (uri, after) => [...session.notifications].reverse().find((n) => n.method === 'textDocument/publishDiagnostics' && n.params.uri === uri && n.seq > after);
  let seq = 0;
  const origPush = session.notifications.push.bind(session.notifications);
  session.notifications.push = (n) => origPush({ ...n, seq: ++seq });
  const marks = {};

  const actions = {
    open: async (i, file) => {
      const d = doc(file);
      marks[d.uri] = seq;
      session.notify('textDocument/didOpen', { textDocument: { uri: d.uri, languageId: 'html', version: d.version, text: d.text } });
    },
    change: async (i, file, text) => {
      const d = doc(file);
      d.text = text;
      d.version += 1;
      marks[d.uri] = seq;
      session.notify('textDocument/didChange', { textDocument: { uri: d.uri, version: d.version }, contentChanges: [{ text }] });
      fs.writeFileSync(path.join(outDir, 'documents', `${file.replace(/[\\/]/g, '__')}.v${d.version}`), text);
    },
    configure: async (i, settings) => {
      Object.values(docs).forEach((d) => { marks[d.uri] = seq; });
      session.notify('workspace/didChangeConfiguration', { settings: { nojs: settings } });
    },
    'expect-diagnostics': async (i, file, expect = {}) => {
      const d = doc(file);
      const deadline = Date.now() + STEP_TIMEOUT;
      let last = null;
      let lastErr = 'no publishDiagnostics received after the last open/change/configure';
      while (Date.now() < deadline) {
        const n = latestDiagnostics(d.uri, marks[d.uri] ?? 0);
        if (n) {
          last = n.params.diagnostics;
          try { checkList('diagnostics', last.map((x) => `${x.message} [severity ${x.severity}]`), expect); save(i, 'diagnostics', last); return; }
          catch (err) { lastErr = err.message; }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (last) save(i, 'diagnostics', last);
      throw new Error(lastErr);
    },
    completion: async (i, file, at, expect = {}) => {
      const d = doc(file);
      const res = await session.request('textDocument/completion', { textDocument: { uri: d.uri }, position: locate(d.text, at) });
      save(i, 'completion', res);
      checkList('completion labels', labelsOf(res), expect, true);
    },
    hover: async (i, file, at, expect = {}) => {
      const d = doc(file);
      const res = await session.request('textDocument/hover', { textDocument: { uri: d.uri }, position: locate(d.text, at) });
      save(i, 'hover', res);
      const text = hoverText(res);
      if (!text) throw new Error('hover returned no content');
      checkList('hover text', [text], { includes: expect.includes, excludes: expect.excludes });
    },
    definition: async (i, file, at, expect = {}) => {
      const d = doc(file);
      const res = await session.request('textDocument/definition', { textDocument: { uri: d.uri }, position: locate(d.text, at) });
      save(i, 'definition', res);
      const locs = (Array.isArray(res) ? res : res ? [res] : []);
      if (!locs.length) throw new Error('definition returned no location');
      if (expect.line !== undefined && !locs.some((l) => (l.range || l.targetRange).start.line === expect.line)) {
        throw new Error(`definition lines ${JSON.stringify(locs.map((l) => (l.range || l.targetRange).start.line))} do not include ${expect.line}`);
      }
      if (expect.target) {
        const want = locate(d.text, expect.target).line;
        if (!locs.some((l) => (l.range || l.targetRange).start.line === want)) throw new Error(`definition does not point at the line of ${JSON.stringify(expect.target)} (${want})`);
      }
    },
    symbols: async (i, file, expect = {}) => {
      const d = doc(file);
      const res = await session.request('textDocument/documentSymbol', { textDocument: { uri: d.uri } });
      save(i, 'symbols', res);
      const flat = [];
      const walk = (list) => (list || []).forEach((s) => { flat.push(s.name); walk(s.children); });
      walk(res);
      checkList('document symbols', flat, expect);
    },
    'code-actions': async (i, file, at, expect = {}) => {
      const d = doc(file);
      const n = latestDiagnostics(d.uri, -1);
      const pos = locate(d.text, at);
      const diagnostics = (n?.params.diagnostics || []).filter((x) => x.range.start.line <= pos.line && x.range.end.line >= pos.line);
      const res = await session.request('textDocument/codeAction', { textDocument: { uri: d.uri }, range: { start: pos, end: pos }, context: { diagnostics } });
      save(i, 'code-actions', res);
      checkList('code action titles', (res || []).map((a) => a.title), expect);
    },
  };

  const result = { name, scenario: path.relative(ROOT, scenarioPath), server: path.relative(ROOT, serverEntry), gitSha: gitSha(), version: pkg.version, startedAt: new Date().toISOString(), passed: false, steps: scenario.steps.length, failedStep: null };
  let failure = null;
  try {
    const init = await session.initialize(ws);
    save(0, 'initialize', init);
    log(`PASS #0 initialize (${Object.keys(init.capabilities).length} capabilities)`);
    console.log('PASS #0 initialize');
    for (let i = 0; i < scenario.steps.length; i++) {
      const [verb, ...args] = scenario.steps[i];
      const label = `#${i + 1} ${verb} ${args.map((a) => JSON.stringify(a)).join(' ')}`.slice(0, 300);
      const t0 = Date.now();
      try {
        if (!actions[verb]) throw new Error(`unknown step verb "${verb}"`);
        await actions[verb](i + 1, ...args);
        log(`PASS ${label} (${Date.now() - t0}ms)`);
        console.log(`PASS ${label}`);
      } catch (err) {
        failure = { index: i + 1, step: scenario.steps[i], error: err.message.split('\n')[0] };
        log(`FAIL ${label}: ${failure.error}`);
        console.log(`FAIL ${label}: ${failure.error}`);
        break;
      }
    }
  } catch (err) {
    failure = { index: 0, step: 'initialize', error: err.message };
    console.log(`FAIL #0 initialize: ${err.message}`);
  }
  const exit = await session.shutdown();
  if (!failure && exit.code !== 0) failure = { index: null, step: 'shutdown', error: `server exit ${JSON.stringify(exit)}` };
  result.serverExit = exit;
  result.passed = !failure;
  result.failedStep = failure;
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.rmSync(ws, { recursive: true, force: true });
  console.log(`${result.passed ? 'PASSED' : 'FAILED'} ${name}: evidence in ${path.relative(ROOT, outDir)}/`);
  process.exit(result.passed ? 0 : 1);
}

// ── package: build the VSIX and smoke-test the packaged server ──
const REQUIRED_VSIX_ENTRIES = [
  'extension/package.json',
  'extension/out/server/src/server.js',
  'extension/out/client/src/extension.js',
  'extension/bin/nojs-language-server.js',
  'extension/data/nojs-custom-data.json',
  'extension/snippets/nojs.json',
  'extension/logo.png',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/LICENSE.txt',
];
const FORBIDDEN_VSIX_PATTERNS = [/^extension\/node_modules\//, /^extension\/\.claude\//, /^extension\/\.verify\//, /^extension\/server\/src\//, /^extension\/test\//, /\.map$/];

async function packageVsix() {
  const outDir = path.join(EVIDENCE_DIR, `${stamp()}-package`);
  fs.mkdirSync(outDir, { recursive: true });
  const vsix = path.join(outDir, `nojs-lsp-${pkg.version}.vsix`);
  const log = (line) => { fs.appendFileSync(path.join(outDir, 'steps.log'), line + '\n'); console.log(line); };
  const vsce = spawnSync('npx', ['vsce', 'package', '--out', vsix], { cwd: ROOT, encoding: 'utf8' });
  fs.writeFileSync(path.join(outDir, 'vsce.log'), `${vsce.stdout}\n${vsce.stderr}`);
  if (vsce.status !== 0 || !fs.existsSync(vsix)) { log(`FAIL vsce package exited ${vsce.status}; see ${path.relative(ROOT, outDir)}/vsce.log`); process.exit(1); }
  log(`PASS vsce package -> ${path.relative(ROOT, vsix)} (${fs.statSync(vsix).size} bytes)`);

  const listing = spawnSync('unzip', ['-Z1', vsix], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  fs.writeFileSync(path.join(outDir, 'vsix-contents.txt'), listing.join('\n') + '\n');
  const missing = REQUIRED_VSIX_ENTRIES.filter((e) => !listing.includes(e));
  const forbidden = listing.filter((e) => FORBIDDEN_VSIX_PATTERNS.some((re) => re.test(e)));
  let failed = false;
  if (missing.length) { failed = true; log(`FAIL vsix is missing ${JSON.stringify(missing)}`); } else log(`PASS vsix contains the ${REQUIRED_VSIX_ENTRIES.length} required entries (${listing.length} files total)`);
  if (forbidden.length) { failed = true; log(`FAIL vsix ships files that must stay out: ${JSON.stringify(forbidden.slice(0, 10))}`); } else log('PASS vsix ships no node_modules, sources, tests, source maps, .claude or .verify files');

  const extractDir = path.join(RUN_DIR, `vsix-${stamp()}`);
  fs.mkdirSync(extractDir, { recursive: true });
  spawnSync('unzip', ['-q', vsix, '-d', extractDir]);
  const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, 'extension/package.json'), 'utf8'));
  if (manifest.version === pkg.version && manifest.main === './out/client/src/extension.js') log(`PASS packaged manifest version ${manifest.version}, main ${manifest.main}, activationEvents ${JSON.stringify(manifest.activationEvents)}`);
  else { failed = true; log(`FAIL packaged manifest version ${manifest.version} main ${manifest.main}`); }
  try {
    const { init, exit } = await handshake(path.join(extractDir, 'extension/bin/nojs-language-server.js'), path.join(outDir, 'packaged-server'));
    const missingCaps = EXPECTED_CAPABILITIES.filter((c) => !init?.capabilities?.[c]);
    if (!missingCaps.length && exit.code === 0) log('PASS packaged server (extension/bin/nojs-language-server.js from the vsix, outside node_modules) answers initialize and exits 0');
    else { failed = true; log(`FAIL packaged server capabilities missing ${JSON.stringify(missingCaps)}, exit ${JSON.stringify(exit)}`); }
  } catch (err) {
    failed = true;
    log(`FAIL packaged server handshake: ${err.message}`);
  }
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ name: 'package', vsix: path.relative(ROOT, vsix), version: pkg.version, gitSha: gitSha(), files: listing.length, passed: !failed, finishedAt: new Date().toISOString() }, null, 2));
  console.log(`${failed ? 'FAILED' : 'PASSED'} package: evidence in ${path.relative(ROOT, outDir)}/`);
  process.exit(failed ? 1 : 0);
}

// ── cleanup ──
function cleanup() {
  const leftovers = fs.existsSync(RUN_DIR) ? fs.readdirSync(RUN_DIR) : [];
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  const stray = spawnSync('pgrep', ['-f', `${ROOT}/(bin/nojs-language-server|out/server/src/server).js`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  console.log(`CLEANED ${leftovers.length} scratch workspace(s) in ${path.relative(ROOT, RUN_DIR)}/; evidence kept in ${path.relative(ROOT, EVIDENCE_DIR)}/`);
  if (stray.length) {
    console.log(`WARN language server process(es) from this checkout still running: ${stray.join(', ')}. They are not killed automatically; check with ps -p <pid> -o command= and kill only the ones this run started.`);
    process.exit(1);
  }
}

const commands = { launch, doctor, drive, package: packageVsix, cleanup };
if (!commands[command]) {
  console.error('usage: node .claude/skills/verify-nojs-lsp/scripts/verify.mjs <launch|doctor|drive|package|cleanup> [--scenario file.json] [--server <entry.js>]');
  process.exit(2);
}
await commands[command]();
