// Behavioural audit for Sunset Relay. Drives the real game in headless
// Chrome over CDP and checks the full loop. Waits are measured in SIM
// seconds (game.simTime) because SwiftShader renders slower than real time.
// Prints PASS/FAIL per check. Usage: node tools/audit.mjs
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHROME = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');
const PORT = 9334;
const URL = 'http://localhost:8080/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}  ${detail}`); }
}

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
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push('exception: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
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
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result ? r.result.value : undefined;
  }
  async key(code, key, holdMs = 60) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: key || code });
    if (holdMs > 0) await sleep(holdMs);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: key || code });
  }
  async keyDown(code, key) { await this.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: key || code }); }
  async keyUp(code, key) { await this.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: key || code }); }
  close() { try { this.ws.close(); } catch { /* closed */ } }
  // Wait until the game's sim clock advances by `seconds` (max wallMs).
  async waitSim(seconds, wallMs = 90000) {
    const t0 = await this.eval(`window.__fps.game.simTime`);
    const deadline = Date.now() + wallMs;
    while (Date.now() < deadline) {
      await sleep(500);
      const t = await this.eval(`window.__fps.game.simTime`);
      if (t - t0 >= seconds) return true;
    }
    return false;
  }
  // Wait until eval(expression) is truthy (max wallMs).
  async waitFor(expression, wallMs = 30000) {
    const deadline = Date.now() + wallMs;
    while (Date.now() < deadline) {
      await sleep(400);
      try { if (await this.eval(expression)) return true; } catch { /* retry */ }
    }
    return false;
  }
}

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let cdp;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const list = await getJson('/json/list');
      const page = list.find((t) => t.type === 'page');
      if (page) { cdp = new CDP(page.webSocketDebuggerUrl); break; }
    } catch { /* not up */ }
  }
  if (!cdp) throw new Error('chrome did not start');
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `Element.prototype.requestPointerLock = function() { return Promise.reject(new Error('stubbed lock failure')); };` });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(5000);

    const loaded = await cdp.eval(`({ hasFps: !!window.__fps, phase: window.__fps && window.__fps.game.phase, errors: window.__errors })`);
    check('game loads, no page errors', loaded.hasFps && loaded.errors.length === 0, JSON.stringify(loaded));

    await cdp.eval(`document.getElementById('play').click()`);
    await sleep(1200);
    const started = await cdp.eval(`({ phase: window.__fps.game.phase, lockFailed: window.__fps.input.lockFailed, lockHintHidden: document.getElementById('lock-hint').hidden })`);
    check('play starts buy phase', started.phase === 'buy', JSON.stringify(started));
    check('§4.1 lock failure detected + hint shown', started.lockFailed === true && started.lockHintHidden === false, JSON.stringify(started));

    const yaw0 = await cdp.eval(`window.__fps.game.player.yaw`);
    for (let i = 0; i < 6; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640 + i * 20, y: 360, movementX: 30, movementY: 0 });
      await sleep(80);
    }
    await sleep(400);
    const yaw1 = await cdp.eval(`window.__fps.game.player.yaw`);
    check('§4.1 mouse look works without pointer lock', Math.abs(yaw1 - yaw0) > 0.1, `yaw ${yaw0.toFixed(3)} -> ${yaw1.toFixed(3)}`);

    const p0 = await cdp.eval(`({ x: window.__fps.game.player.pos.x, z: window.__fps.game.player.pos.z })`);
    await cdp.keyDown('KeyW', 'w');
    await cdp.waitSim(1.2);
    await cdp.keyUp('KeyW', 'w');
    const p1 = await cdp.eval(`({ x: window.__fps.game.player.pos.x, z: window.__fps.game.player.pos.z })`);
    const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    check('WASD movement moves the player', moved > 1, `moved ${moved.toFixed(2)} m`);

    const buy0 = await cdp.eval(`(() => { const g = window.__fps.game; const ok = g.buyItem('weapon', 'rifle'); return { ok, money: g.money, owned: g.player.ownedWeapons }; })()`);
    check('buy respects money (rifle $2700 > $800 refused)', buy0.ok === false && !buy0.owned.includes('rifle'), JSON.stringify(buy0));
    await cdp.eval(`window.__fps.game.money = 5000; window.__fps.game.buyItem('weapon', 'rifle'); window.__fps.game.buyItem('grenade', 'frag'); window.__fps.game.buyItem('grenade', 'flash'); window.__fps.game.buyItem('kevlar', 'kevlar');`);
    const buy1 = await cdp.eval(`({ owned: window.__fps.game.player.ownedWeapons, weapon: window.__fps.game.player.weaponId, armor: window.__fps.game.player.armor, grenades: window.__fps.game.player.grenades, money: window.__fps.game.money })`);
    check('buy rifle + grenades + kevlar with funds', buy1.owned.includes('rifle') && buy1.armor === 100 && buy1.grenades.frag === 1 && buy1.grenades.flash === 1, JSON.stringify(buy1));

    await cdp.eval(`window.__fps.game.skipBuyPhase()`);
    await sleep(500);
    const live = await cdp.eval(`window.__fps.game.phase`);
    check('buy phase skips to live round', live === 'live', live);

    const buyLive = await cdp.eval(`(() => { const g = window.__fps.game; g.money = 5000; return g.buyItem('weapon', 'smg'); })()`);
    check('§4.5 buying is refused in a live round', buyLive === false, String(buyLive));
    await cdp.key('KeyB', 'b', 80);
    await sleep(300);
    const buyMenu = await cdp.eval(`({ open: window.__fps.hud.buyOpen, note: document.getElementById('buy-note').textContent })`);
    check('§4.5 B opens buy menu view-only in live round', buyMenu.open === true && buyMenu.note.includes('CLOSED'), JSON.stringify(buyMenu));
    await cdp.key('KeyB', 'b', 80);
    await sleep(200);

    // headshot vs body: ratio must be ~2x (weapon-agnostic)
    const dmg = await cdp.eval(`(() => {
      const g = window.__fps.game;
      const bot = g.agents.find(a => a.team === 'teal');
      const from = { x: g.player.pos.x, y: g.player.pos.y + 1.62, z: g.player.pos.z };
      const def = g.player.weapon.def;
      const shoot = (ty) => {
        bot.pos.x = g.player.pos.x; bot.pos.z = g.player.pos.z - 10; bot.hp = 100; bot.alive = true; bot.armor = 0;
        const dy = ty - 1.62; const len = Math.hypot(dy, 10);
        const dir = { x: 0, y: dy / len, z: -10 / len };
        g.resolveShot(g.player, { def, dirs: [dir] }, from);
        return 100 - bot.hp;
      };
      const head = shoot(1.52);
      const body = shoot(1.05);
      return { head, body, ratio: head / body };
    })()`);
    check('headshot deals ~2x body damage', dmg.head > dmg.body && dmg.ratio > 1.7 && dmg.ratio < 2.3, JSON.stringify(dmg));

    await cdp.eval(`(() => { const w = window.__fps.game.player.weapon; w.mag = 0; w.reserve = 30; w.startReload(); })()`);
    await cdp.waitSim(2.6);
    const rel2 = await cdp.eval(`({ mag: window.__fps.game.player.weapon.mag, reloading: window.__fps.game.player.weapon.reloading })`);
    check('reload refills the magazine', rel2.mag > 0 && rel2.reloading === false, JSON.stringify(rel2));

    // plant: fresh round (so it cannot end mid-hold), protect the player
    // and park BOTH teams in opposite corners so no fight ends the round
    // while the channel runs
    await cdp.eval(`(() => {
      const g = window.__fps.game;
      g.startRound(); g.skipBuyPhase();
      g.bomb.state = 'carried'; g.bomb.carrierId = 'player';
      g.player.pos.x = -22; g.player.pos.z = -14; g.player.hp = 100; g.player.armor = 100; g.player.alive = true;
      for (const a of g.agents) {
        if (a.team === 'teal') { a.pos.x = 28; a.pos.z = -20; }
        if (a.team === 'amber' && !a.isPlayer) { a.pos.x = -28; a.pos.z = 20; }
      }
    })()`);
    await cdp.keyDown('KeyE', 'e');
    const plantedOk = await cdp.waitFor(`window.__fps.game.bomb.state === 'planted'`, 30000);
    await cdp.keyUp('KeyE', 'e');
    const planted = await cdp.eval(`({ state: window.__fps.game.bomb.state, site: window.__fps.game.bomb.site, timer: Math.round(window.__fps.game.bomb.timer) })`);
    check('hold-E plants the bomb at site A', plantedOk && planted.state === 'planted' && planted.site === 'A', JSON.stringify(planted));

    const defused = await cdp.eval(`(() => {
      const g = window.__fps.game;
      const bot = g.agents.find(a => a.team === 'teal');
      bot.pos.x = g.bomb.x; bot.pos.z = g.bomb.z + 1; bot.alive = true; bot.hp = 100;
      for (let i = 0; i < 320; i++) g.channelInteract(bot, 1 / 60);
      return { state: g.bomb.state, phase: g.phase };
    })()`);
    check('defuse channel completes (5 s hold)', defused.state === 'defused', JSON.stringify(defused));

    await cdp.eval(`(() => {
      const g = window.__fps.game;
      g.bomb.state = 'planted'; g.bomb.site = 'A'; g.bomb.x = -22; g.bomb.z = -16; g.bomb.timer = 0.5;
      g.phase = 'live'; g.phaseTime = 50;
    })()`);
    const detOk = await cdp.waitFor(`window.__fps.game.bomb.state === 'detonated'`, 20000);
    const det = await cdp.eval(`({ state: window.__fps.game.bomb.state, phase: window.__fps.game.phase })`);
    check('bomb detonates when the timer hits zero', detOk && det.state === 'detonated' && det.phase === 'roundEnd', JSON.stringify(det));

    const nxtOk = await cdp.waitFor(`window.__fps.game.phase === 'buy' && window.__fps.game.round >= 2`, 60000);
    const nxt = await cdp.eval(`({ phase: window.__fps.game.phase, round: window.__fps.game.round })`);
    check('roundEnd advances to the next round', nxtOk && nxt.phase === 'buy' && nxt.round >= 2, JSON.stringify(nxt));

    // §4.2: fresh live round, then the genuine lock-exit transition
    await cdp.eval(`window.__fps.game.skipBuyPhase()`);
    await sleep(300);
    await cdp.key('Escape', 'Escape', 80);
    await sleep(400);
    const pause0 = await cdp.eval(`document.getElementById('pause-screen').hidden`);
    check('§4.2 no pause screen when lock was never held', pause0 === true, String(pause0));
    await cdp.eval(`(() => { const inp = window.__fps.input; inp.locked = true; document.dispatchEvent(new Event('pointerlockchange')); })()`);
    await sleep(300);
    const pause1 = await cdp.eval(`document.getElementById('pause-screen').hidden`);
    check('§4.2 pause shows on genuine lock exit', pause1 === false, String(pause1));
    await cdp.eval(`document.getElementById('resume').click()`);
    await sleep(200);
    await cdp.eval(`(() => { const inp = window.__fps.input; inp.locked = true; document.dispatchEvent(new Event('pointerlockchange')); })()`);
    await sleep(300);
    const pause2 = await cdp.eval(`document.getElementById('pause-screen').hidden`);
    check('§4.2 resume guard suppresses immediate re-pause', pause2 === true, String(pause2));

    // §4.3 bot displacement over 20+ sim-seconds of a fresh round
    await cdp.eval(`(() => { const g = window.__fps.game; g.scoreAmber = 0; g.scoreTeal = 0; g.round = 1; g.startRound(); g.skipBuyPhase(); })()`);
    await cdp.waitSim(22, 120000);
    const disp = await cdp.eval(`window.__fps.game.debugState().bots.map(b => b.movedFromSpawn)`);
    const minDisp = Math.min(...disp);
    check('§4.3 ALL 9 bots displace >10 m from spawn in 20+ sim-seconds', disp.length === 9 && minDisp > 10, `min ${minDisp.toFixed(1)} m, all [${disp.map((d) => d.toFixed(0)).join(', ')}]`);

    // §4.4 spectate with living teammates
    const spec = await cdp.eval(`(() => {
      const g = window.__fps.game;
      for (const a of g.agents) if (a.team === 'amber' && !a.isPlayer) { a.alive = true; a.hp = 100; if (a.model) a.model.setAlive(); }
      g.player.hp = 0; g.player.alive = false; g.enterSpectate();
      return { spectateId: g.spectateId, viewmodelHidden: !g.viewmodel.group.visible, deathShown: !document.getElementById('death-screen').hidden };
    })()`);
    check('§4.4 death enters spectate, viewmodel hidden', spec.spectateId !== null && spec.viewmodelHidden === true && spec.deathShown === true, JSON.stringify(spec));
    const specTarget = await cdp.eval(`(() => { const g = window.__fps.game; const t = g.spectateTarget(); return t ? { id: t.id, alive: t.alive } : null; })()`);
    check('§4.4 spectate target is a living teammate', specTarget !== null && specTarget.alive === true, JSON.stringify(specTarget));

    check('zero console/page errors across the whole audit', cdp.errors.length === 0, cdp.errors.join(' | ').slice(0, 400));
  } finally {
    cdp.close();
    chrome.kill('SIGKILL');
  }
  console.log(`\nAUDIT: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('AUDIT CRASH:', e.message); process.exit(2); });
