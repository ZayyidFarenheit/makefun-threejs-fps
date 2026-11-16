// Focused bot-displacement check (§4.3): fresh round, 22 sim-seconds,
// report every bot's displacement from spawn. Usage: node tools/displacement.mjs
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHROME = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, '--mute-audio', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const list = await getJson('/json/list');
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch { /* not up */ }
}
if (!ws) throw new Error('chrome did not start');
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result ? r.result.value : undefined;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:8080/' });
await sleep(5000);
await ev(`document.getElementById('play').click()`);
await sleep(800);
await ev(`(() => { const g = window.__fps.game; g.startRound(); g.skipBuyPhase(); })()`);
const t0 = await ev(`window.__fps.game.simTime`);
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  await sleep(500);
  const t = await ev(`window.__fps.game.simTime`);
  if (t - t0 >= 22) break;
}
const disp = await ev(`window.__fps.game.debugState().bots.map(b => ({ id: b.id, moved: b.movedFromSpawn, alive: b.alive }))`);
console.log(JSON.stringify({ errors, disp }, null, 1));
const min = Math.min(...disp.map((d) => d.moved));
console.log(min > 10 ? 'DISPLACEMENT PASS' : 'DISPLACEMENT FAIL', 'min', min.toFixed(1));
ws.close();
chrome.kill('SIGKILL');
process.exit(min > 10 ? 0 : 1);
