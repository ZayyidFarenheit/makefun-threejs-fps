// HUD and screens: health/ammo/timer/score/money, kill feed, buy menu,
// round banners, start / pause / death / match-end overlays. All DOM is
// built once and updated in place — no per-frame allocation.

import { WEAPONS, GRENADES, ECONOMY, MATCH } from './config.js';

export class Hud {
  constructor(doc) {
    this.doc = doc;
    this.el = {};
    const ids = ['health-bar', 'health-num', 'armor-num', 'ammo-mag', 'ammo-reserve',
      'weapon-name', 'timer', 'round-label', 'score-amber', 'score-teal',
      'money', 'alive-amber', 'alive-teal', 'killfeed', 'banner', 'banner-title',
      'banner-sub', 'bomb-status', 'bomb-timer', 'hint', 'hitmarker',
      'crosshair', 'start-screen', 'pause-screen', 'death-screen', 'end-screen',
      'buy-menu', 'buy-items', 'buy-note', 'buy-money', 'spectate-label',
      'plant-bar', 'plant-fill', 'plant-label', 'end-title', 'end-sub',
      'flash-overlay', 'lock-hint', 'round-skip'];
    for (const id of ids) this.el[id] = doc.getElementById(id);
    this.lastMoney = -1;
    this.buyOpen = false;
    this.buyPhase = false;
    this._buildBuyMenu();
  }

  _buildBuyMenu() {
    const items = [];
    for (const id of ['smg', 'rifle', 'shotgun', 'sniper']) {
      const w = WEAPONS[id];
      items.push({ kind: 'weapon', id, name: w.name, price: w.price, desc: `${w.damage} dmg · ${w.magSize} rnd mag` });
    }
    for (const id of ['frag', 'flash', 'smoke']) {
      const g = GRENADES[id];
      items.push({ kind: 'grenade', id, name: g.name, price: g.price, desc: 'Throwable · press G' });
    }
    items.push({ kind: 'kevlar', id: 'kevlar', name: 'Kevlar Vest', price: ECONOMY.kevlarPrice, desc: 'Absorbs half of each hit' });
    const host = this.el['buy-items'];
    host.innerHTML = '';
    for (const it of items) {
      const row = this.doc.createElement('div');
      row.className = 'buy-row';
      row.dataset.kind = it.kind;
      row.dataset.id = it.id;
      row.innerHTML = `<span class="buy-name">${it.name}</span><span class="buy-desc">${it.desc}</span><span class="buy-price">$${it.price}</span>`;
      host.appendChild(row);
    }
  }

  showStart() {
    this.el['start-screen'].hidden = false;
    this.el['pause-screen'].hidden = true;
    this.el['death-screen'].hidden = true;
    this.el['end-screen'].hidden = true;
  }
  hideStart() { this.el['start-screen'].hidden = true; }

  showPause() { this.el['pause-screen'].hidden = false; }
  hidePause() { this.el['pause-screen'].hidden = true; }
  showDeath() { this.el['death-screen'].hidden = false; }
  hideDeath() { this.el['death-screen'].hidden = true; }
  showEnd(title, sub) {
    this.el['end-title'].textContent = title;
    this.el['end-sub'].textContent = sub;
    this.el['end-screen'].hidden = false;
  }
  hideEnd() { this.el['end-screen'].hidden = true; }

  showBanner(title, sub, ms = 2600) {
    this.el['banner-title'].textContent = title;
    this.el['banner-sub'].textContent = sub;
    this.el['banner'].hidden = false;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.el['banner'].hidden = true; }, ms);
  }
  hideBanner() { this.el['banner'].hidden = true; }

  openBuy(money, phase, owned) {
    this.buyOpen = true;
    this.buyPhase = phase === 'buy';
    this.el['buy-menu'].hidden = false;
    this.el['buy-money'].textContent = `$${money}`;
    this.el['buy-note'].textContent = this.buyPhase
      ? 'Buy phase — click an item to buy it. Press B to close.'
      : 'BUYING IS CLOSED — live round, view only.';
    for (const row of this.el['buy-items'].children) {
      const price = row.querySelector('.buy-price').textContent.slice(1);
      const afford = money >= Number(price);
      const isOwned = row.dataset.kind === 'weapon' && owned.includes(row.dataset.id);
      row.classList.toggle('cant', !afford && !this.buyPhase);
      row.classList.toggle('owned', isOwned);
      row.classList.toggle('closed', !this.buyPhase);
    }
  }

  closeBuy() {
    this.buyOpen = false;
    this.el['buy-menu'].hidden = true;
  }

  setLockHint(show) {
    this.el['lock-hint'].hidden = !show;
  }

  flash() {
    const o = this.el['flash-overlay'];
    o.style.opacity = '0.95';
    setTimeout(() => { o.style.opacity = '0'; }, 60);
    setTimeout(() => { o.style.opacity = '0.55'; }, 200);
    setTimeout(() => { o.style.opacity = '0'; }, 900);
  }

  hitmarker(head) {
    const h = this.el['hitmarker'];
    h.classList.add('on');
    h.classList.toggle('head', head);
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => h.classList.remove('on'), 110);
  }

  killfeed(text) {
    const feed = this.el['killfeed'];
    const line = this.doc.createElement('div');
    line.className = 'feed-line';
    line.textContent = text;
    feed.prepend(line);
    while (feed.children.length > 4) feed.removeChild(feed.lastChild);
    setTimeout(() => { if (line.parentNode) line.remove(); }, 6000);
  }

  message(text) { this.killfeed(text); }

  setHint(text) {
    if (this.el['hint'].textContent !== text) this.el['hint'].textContent = text;
  }

  setSpectate(text) {
    this.el['spectate-label'].hidden = !text;
    if (text) this.el['spectate-label'].textContent = text;
  }

  setPlant(progress, label) {
    if (progress === null) {
      this.el['plant-bar'].hidden = true;
      return;
    }
    this.el['plant-bar'].hidden = false;
    this.el['plant-fill'].style.width = `${Math.round(progress * 100)}%`;
    this.el['plant-label'].textContent = label;
  }

  setBomb(status, seconds) {
    const b = this.el['bomb-status'];
    if (!status) { b.hidden = true; return; }
    b.hidden = false;
    this.el['bomb-timer'].textContent = status === 'planted' ? `BOMB ${seconds.toFixed(0)}s` : status.toUpperCase();
  }

  // Called every render frame with the sim state; cheap text updates only
  // when the value actually changed.
  update(g, player) {
    const hp = Math.max(0, Math.ceil(player.hp));
    this.el['health-num'].textContent = String(hp);
    this.el['health-bar'].style.width = `${hp}%`;
    this.el['health-bar'].style.background = hp > 50 ? '#7ddb6a' : hp > 25 ? '#ffb347' : '#ff5a4d';
    this.el['armor-num'].textContent = player.armor > 0 ? `Kevlar ${Math.ceil(player.armor)}` : '';
    const w = player.weapon;
    this.el['ammo-mag'].textContent = String(w.mag);
    this.el['ammo-reserve'].textContent = `/ ${w.reserve}`;
    this.el['ammo-mag'].parentElement.classList.toggle('empty', w.mag === 0);
    this.el['weapon-name'].textContent = w.name + (w.reloading ? ' — RELOADING' : '');
    this.el['timer'].textContent = g.phase === 'buy'
      ? `BUY ${Math.ceil(g.phaseTime)}s`
      : g.bomb.state === 'planted'
        ? `BOMB ${Math.ceil(g.bomb.timer)}s`
        : `${Math.floor(g.phaseTime / 60)}:${String(Math.floor(g.phaseTime % 60)).padStart(2, '0')}`;
    this.el['round-label'].textContent = `ROUND ${g.round} / ${MATCH.maxRounds}`;
    this.el['score-amber'].textContent = String(g.scoreAmber);
    this.el['score-teal'].textContent = String(g.scoreTeal);
    if (g.money !== this.lastMoney) {
      this.el['money'].textContent = `$${g.money}`;
      this.lastMoney = g.money;
    }
    this.el['alive-amber'].textContent = `Amber alive: ${g.aliveCount('amber')}`;
    this.el['alive-teal'].textContent = `Teal alive: ${g.aliveCount('teal')}`;
    this.el['round-skip'].hidden = !(g.phase === 'buy');
    if (this.buyOpen) this.openBuy(g.money, g.phase, player.ownedWeapons);
  }
}
