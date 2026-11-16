// Headless-Chrome driver over CDP (Node 24 built-in WebSocket, no deps).
// Usage:
//   node tools/cdp.mjs shot <url> <outfile.jpg> <waitMs>
//   node tools/cdp.mjs eval <url> <js-expression> <waitMs>
//   node tools/cdp.mjs keys <url> <json-steps> <waitMs>
// Prints JSON to stdout: {errors, result, screenshot}.
import { execFile, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHROME = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');
const PORT = 9333;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push('exception: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 500));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.errors.push('log: ' + msg.params.entry.text.slice(0, 500));
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return p;
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

async function launchChrome(url) {
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=1280,720', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const list = await getJson('/json/list');
      const page = list.find((t) => t.type === 'page');
      if (page) return { chrome, cdp: new CDP(page.webSocketDebuggerUrl) };
    } catch { /* not up yet */ }
  }
  throw new Error('chrome did not start CDP in time');
}

async function main() {
  const [mode, url, arg, waitMs = '3000'] = process.argv.slice(2);
  const { chrome, cdp } = await launchChrome(url);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    await sleep(Number(waitMs));
    if (mode === 'shot') {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 } });
      writeFileSync(arg, Buffer.from(shot.data, 'base64'));
      console.log(JSON.stringify({ ok: true, file: arg, errors: cdp.errors }));
    } else if (mode === 'eval') {
      const result = await cdp.eval(arg);
      console.log(JSON.stringify({ ok: true, result, errors: cdp.errors }));
    } else if (mode === 'keys') {
      // steps: [{type:'key', code, key, ms}, {type:'mouse', x, y, button, ms}, {type:'wait', ms}, {type:'eval', expr}]
      const steps = JSON.parse(arg);
      let lastResult = null;
      for (const s of steps) {
        if (s.type === 'key') {
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: s.code, key: s.key || s.code });
          await sleep(s.ms || 50);
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: s.code, key: s.key || s.code });
        } else if (s.type === 'keydown') {
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: s.code, key: s.key || s.code });
        } else if (s.type === 'keyup') {
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: s.code, key: s.key || s.code });
        } else if (s.type === 'mouse') {
          await cdp.send('Input.dispatchMouseEvent', { type: s.action || 'mousePressed', x: s.x, y: s.y, button: s.button || 'left', clickCount: 1 });
          if (s.action === 'mousePressed') {
            await sleep(60);
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: s.button || 'left', clickCount: 1 });
          }
        } else if (s.type === 'mousemove') {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y });
        } else if (s.type === 'wait') {
          await sleep(s.ms || 1000);
        } else if (s.type === 'eval') {
          lastResult = await cdp.eval(s.expr);
        } else if (s.type === 'shot') {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 } });
          writeFileSync(s.file, Buffer.from(shot.data, 'base64'));
        }
      }
      console.log(JSON.stringify({ ok: true, result: lastResult, errors: cdp.errors }));
    }
  } finally {
    cdp.close();
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  process.exit(1);
});
