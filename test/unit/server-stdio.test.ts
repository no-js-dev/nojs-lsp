/**
 * The language server driven over stdio the way a non-VS Code editor drives it:
 * settings arrive either pushed (workspace/didChangeConfiguration) or pulled
 * (workspace/configuration), and editors often send only the keys the user set.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(__dirname, '../..');
const DOC_URI = 'file:///workspace/index.html';
const DOC = '<div state="{ name: \'Ada\' }"><span bind="name | "></span><p bind="name | uppercasee"></p></div>';
const FILTER_POSITION = { line: 0, character: DOC.indexOf('name | "') + 'name | '.length };

let bundleDir: string;
let serverJs: string;

beforeAll(() => {
  bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nojs-lsp-stdio-'));
  serverJs = path.join(bundleDir, 'server.js');
  buildSync({
    entryPoints: [path.join(ROOT, 'server/src/server.ts')],
    bundle: true,
    outfile: serverJs,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    external: ['vscode'],
    mainFields: ['module', 'main'],
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    logLevel: 'silent',
  });
});

afterAll(() => {
  fs.rmSync(bundleDir, { recursive: true, force: true });
});

const clients: StdioClient[] = [];

afterEach(() => {
  // A failed expectation skips stop(); never leave a server process behind.
  clients.splice(0).forEach((c) => c.kill());
});

type Message = { id?: number; method?: string; params?: any; result?: any; error?: { code: number; message: string } };

class StdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, (msg: Message) => void>();
  private waiters: Array<{ match: (msg: Message) => boolean; resolve: (msg: Message) => void }> = [];

  constructor(private answerConfiguration?: (params: any) => unknown) {
    this.proc = spawn(process.execPath, [serverJs, '--stdio'], { stdio: 'pipe' });
    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    clients.push(this);
  }

  kill() {
    if (this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill('SIGKILL');
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString())![1]);
      if (this.buffer.length < headerEnd + 4 + length) return;
      const msg: Message = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      if (msg.id !== undefined && msg.method) {
        const result = msg.method === 'workspace/configuration' && this.answerConfiguration
          ? (msg.params.items as unknown[]).map(() => this.answerConfiguration!(msg.params))
          : null;
        this.write({ id: msg.id, result });
      } else if (msg.id !== undefined) {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      } else {
        const i = this.waiters.findIndex((w) => w.match(msg));
        if (i !== -1) this.waiters.splice(i, 1)[0].resolve(msg);
      }
    }
  }

  private write(msg: object) {
    const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  request(method: string, params: unknown): Promise<Message> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no response within 5s (server exit code ${this.proc.exitCode})`));
      }, 5000);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.write({ method, params });
  }

  next(match: (msg: Message) => boolean): Promise<Message> {
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  firstDiagnostics?: Promise<Message>;

  async start(withConfigurationCapability: boolean) {
    await this.request('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: withConfigurationCapability ? { workspace: { configuration: true } } : {},
    });
    this.notify('initialized', {});
    this.firstDiagnostics = this.next((m) => m.method === 'textDocument/publishDiagnostics');
    this.notify('textDocument/didOpen', { textDocument: { uri: DOC_URI, languageId: 'html', version: 1, text: DOC } });
  }

  completionAtFilter() {
    return this.request('textDocument/completion', { textDocument: { uri: DOC_URI }, position: FILTER_POSITION });
  }

  async stop() {
    if (this.proc.exitCode === null) {
      await this.request('shutdown', null).catch(() => undefined);
      this.notify('exit', null);
    }
    if (this.proc.exitCode === null) await new Promise((resolve) => this.proc.once('exit', resolve));
  }
}

const labels = (msg: Message) => ((msg.result?.items ?? msg.result ?? []) as Array<{ label: string }>).map((i) => i.label);

describe('language server over stdio: settings sent by the editor', () => {
  it('keeps completing after a didChangeConfiguration that carries only some keys', async () => {
    const client = new StdioClient();
    await client.start(false);
    client.notify('workspace/didChangeConfiguration', { settings: { nojs: { validation: { enabled: true } } } });

    const completion = await client.completionAtFilter();
    expect(completion.error).toBeUndefined();
    expect(labels(completion)).toContain('uppercase');
    await client.stop();
  }, 15000);

  it('applies the keys a partial didChangeConfiguration carries', async () => {
    const client = new StdioClient();
    await client.start(false);
    expect((await client.firstDiagnostics!).params.diagnostics.length).toBeGreaterThan(0);

    const cleared = client.next((m) => m.method === 'textDocument/publishDiagnostics');
    client.notify('workspace/didChangeConfiguration', { settings: { nojs: { validation: { enabled: false } } } });
    expect((await cleared).params.diagnostics).toEqual([]);

    const completion = await client.completionAtFilter();
    expect(completion.error).toBeUndefined();
    expect(labels(completion)).toContain('uppercase');
    await client.stop();
  }, 15000);

  it('keeps completing when the editor answers workspace/configuration with null', async () => {
    const client = new StdioClient(() => null);
    await client.start(true);

    const completion = await client.completionAtFilter();
    expect(completion.error).toBeUndefined();
    expect(labels(completion)).toContain('uppercase');
    await client.stop();
  }, 15000);
});
