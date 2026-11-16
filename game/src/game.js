// Game: the single source of truth. Fixed-step simulation (60 Hz) owned
// here — phases, rounds, money, the bomb, grenades, kills, spectate —
// while rendering only reads this state. No per-frame allocation in the
// hot path: tracers and puffs are pooled by WeaponFx.

import * as THREE from 'three';
import { MAP, MATCH, ECONOMY, WEAPONS, GRENADES, rand, randPick, clamp, dist2d } from './config.js';
import { WeaponState, WeaponFx, traceShot, applyDamage, eyePosition, aimDirection } from './weapons.js';
import { BotController } from './bots.js';
import { PlayerController } from './player.js';
import { SoldierModel } from './soldier.js';

const AMBER_NAMES = ['Raka', 'Dewi', 'Bima', 'Sinta'];
const TEAL_NAMES = ['Vex', 'Mira', 'Kane', 'Onyx', 'Zara'];

export class Game {
  constructor(scene, camera, world, viewmodel, hud, input, sfx) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.viewmodel = viewmodel;
    this.hud = hud;
    this.input = input;
    this.sfx = sfx;
    this.fx = new WeaponFx(scene);

    this.phase = 'menu'; // menu | buy | live | roundEnd | matchEnd
    this.phaseTime = 0;
    this.round = 1;
    this.scoreAmber = 0;
    this.scoreTeal = 0;
    this.money = ECONOMY.startMoney;
    this.simTime = 0;
    this.agents = [];
    this.bots = []; // BotController list
    this.player = null;
    this.playerCtrl = null;
    this.bomb = { state: 'carried', carrierId: null, site: null, x: 0, z: 0, timer: 0, plantProgress: 0 };
    this.grenades = []; // live grenade projectiles
    this.smokes = []; // {x,y,z,r,life}
    this.channel = null; // player plant/defuse channel {kind, t, need}
    this.spectateId = null;
    this.stageFiring = false; // screenshot staging: player auto-fires
    this.stagePlanting = false; // screenshot staging: frozen plant moment
    this.beepTimer = 0;
    this.lastKiller = null;
    this._flashUntil = 0;
    this._lastHurtAt = 0; // throttle the player-hurt sound/flash
    this._buildAgents();
  }

  _buildAgents() {
    // player (Amber, slot 0)
    const player = this._makeAgent('player', 'You', 'amber', 0, true);
    player.pos.x = 0;
    player.pos.z = MAP.attackerSpawn.z;
    player.ownedWeapons = ['pistol'];
    player.weapon = new WeaponState('pistol');
    player.weaponId = 'pistol';
    player.grenades = { frag: 0, flash: 0, smoke: 0 };
    player.grenadeType = 'frag';
    this.player = player;
    this.playerCtrl = new PlayerController(player, this.world, this.sfx);
    this.agents.push(player);

    // Amber bot teammates (slots 1..4)
    for (let i = 0; i < 4; i++) {
      const a = this._makeAgent(`amber-${i + 1}`, AMBER_NAMES[i], 'amber', i + 1, false);
      this.agents.push(a);
      this.bots.push(new BotController(a, this.world, this));
    }
    // Teal defenders (slots 0..4)
    for (let i = 0; i < 5; i++) {
      const a = this._makeAgent(`teal-${i}`, TEAL_NAMES[i], 'teal', i, false);
      this.agents.push(a);
      this.bots.push(new BotController(a, this.world, this));
    }
  }

  _makeAgent(id, name, team, slot, isPlayer) {
    const model = new SoldierModel(team);
    this.scene.add(model.group);
    return {
      id, name, team, slot, isPlayer,
      pos: { x: 0, y: 0, z: 0 },
      yaw: team === 'amber' ? 0 : Math.PI, // attackers face north, defenders south
      pitch: 0,
      hp: 100, armor: 0, alive: true,
      crouching: false, moving: 0,
      weapon: null, weaponId: 'pistol', ownedWeapons: ['pistol'],
      grenades: { frag: 0, flash: 0, smoke: 0 },
      grenadeType: 'frag',
      model,
    };
  }

  agentById(id) { return this.agents.find((a) => a.id === id) || null; }
  aliveCount(team) { return this.agents.filter((a) => a.team === team && a.alive).length; }
  aliveTeammates() { return this.agents.filter((a) => a.team === 'amber' && a.alive && !a.isPlayer); }

  // ---- match flow --------------------------------------------------------
  startMatch() {
    this.scoreAmber = 0;
    this.scoreTeal = 0;
    this.round = 1;
    this.money = ECONOMY.startMoney;
    this.player.ownedWeapons = ['pistol'];
    this.player.weapon = new WeaponState('pistol');
    this.player.weaponId = 'pistol';
    this.player.grenades = { frag: 0, flash: 0, smoke: 0 };
    this.player.armor = 0;
    this.startRound();
  }

  startRound() {
    // spawn positions with a little jitter
    for (const a of this.agents) {
      const isAmber = a.team === 'amber';
      const baseX = (a.slot - 2) * 3;
      const baseZ = isAmber ? MAP.attackerSpawn.z : MAP.defenderSpawn.z;
      a.pos.x = baseX + rand(-1, 1);
      a.pos.z = baseZ + rand(-1, 1);
      a.pos.y = 0;
      a.hp = 100;
      a.alive = true;
      a.crouching = false;
      a.yaw = isAmber ? 0 : Math.PI;
      a.pitch = 0;
      if (a.model) a.model.setAlive();
      a.model.group.visible = true;
    }
    // player keeps owned weapons; bots get a fresh loadout
    for (const b of this.bots) {
      const site = randPick(['A', 'B']);
      b.resetForRound(site);
    }
    // bomb goes to a random Amber (player half the time)
    const ambers = this.agents.filter((a) => a.team === 'amber');
    const carrier = Math.random() < 0.5 ? this.player : randPick(ambers.filter((a) => !a.isPlayer));
    this.bomb = { state: 'carried', carrierId: carrier.id, site: null, x: 0, z: 0, timer: 0, plantProgress: 0 };
    this.grenades = [];
    this.smokes = [];
    this.channel = null;
    this.spectateId = null;
    this.phase = 'buy';
    this.phaseTime = MATCH.buyPhaseSeconds;
    this.hud.hideDeath();
    this.hud.hideEnd();
    this.hud.setSpectate(null);
    this.viewmodel.setVisible(true);
    this.hud.showBanner(`ROUND ${this.round}`, carrier.isPlayer ? 'You carry the bomb — plant it at A or B' : `${carrier.name} carries the bomb`, 2400);
    this.hud.setHint('B — Buy menu · Enter — Skip buy phase');
  }

  skipBuyPhase() {
    if (this.phase !== 'buy') return;
    this.phase = 'live';
    this.phaseTime = MATCH.roundSeconds;
    this.hud.closeBuy();
    this.hud.setHint('Hold E to plant / defuse · B — Buy menu (closed in live rounds)');
    this.sfx.buy();
  }

  endRound(winner, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.phase = 'roundEnd';
    this.phaseTime = MATCH.roundEndSeconds;
    if (winner === 'amber') {
      this.scoreAmber++;
      this.money += ECONOMY.winReward;
      this.hud.showBanner('ROUND WON', reason, 3000);
      this.sfx.roundWin();
    } else {
      this.scoreTeal++;
      this.money += ECONOMY.lossReward;
      this.hud.showBanner('ROUND LOST', reason, 3000);
      this.sfx.roundLose();
    }
    this.hud.closeBuy();
    this.hud.setPlant(null);
    this.channel = null;
  }

  nextRoundOrEnd() {
    if (this.scoreAmber >= MATCH.roundsToWin || this.scoreTeal >= MATCH.roundsToWin || this.round >= MATCH.maxRounds) {
      this.phase = 'matchEnd';
      const won = this.scoreAmber > this.scoreTeal;
      this.hud.showEnd(
        won ? 'VICTORY — Amber takes the relay' : 'DEFEAT — Teal holds the relay',
        `Final score ${this.scoreAmber} — ${this.scoreTeal} · Press Play Again to run it back`,
      );
      if (won) this.sfx.roundWin(); else this.sfx.roundLose();
      return;
    }
    this.round++;
    this.startRound();
  }

  // ---- bomb ---------------------------------------------------------------
  plantBomb(agent, site) {
    if (this.bomb.state !== 'carried' || this.bomb.carrierId !== agent.id) return;
    const def = site === 'A' ? MAP.siteA : MAP.siteB;
    this.bomb = { state: 'planted', carrierId: null, site, x: def.x, z: def.z, timer: MATCH.bombTimerSeconds, plantProgress: 0 };
    this.beepTimer = 0;
    this.sfx.plantDone();
    this.hud.message(`${agent.name} planted the bomb at site ${site}`);
    this.hud.setBomb('planted', MATCH.bombTimerSeconds);
  }

  defuseBomb(agent) {
    if (this.bomb.state !== 'planted') return;
    this.bomb.state = 'defused';
    this.sfx.plantDone();
    this.hud.message(`${agent.name} defused the bomb`);
    this.endRound('teal', 'Bomb defused');
  }

  detonateBomb() {
    if (this.bomb.state !== 'planted') return;
    this.bomb.state = 'detonated';
    this.sfx.explosion();
    this.hud.setBomb(null);
    // blast hurts everyone near the site
    for (const a of this.agents) {
      if (!a.alive) continue;
      const d = dist2d(a.pos.x, a.pos.z, this.bomb.x, this.bomb.z);
      if (d < 13) {
        const dmg = Math.round(120 * (1 - d / 13));
        applyDamage(a, dmg, false);
        if (!a.alive) this.onKill(null, a, 'explosion');
      }
    }
    this.endRound('amber', 'Bomb detonated — site destroyed');
  }

  dropBombAt(x, z) {
    if (this.bomb.state !== 'carried') return;
    this.bomb.state = 'dropped';
    this.bomb.x = x;
    this.bomb.z = z;
    this.bomb.carrierId = null;
    this.hud.message('Bomb dropped');
  }

  // ---- combat ---------------------------------------------------------------
  resolveShot(shooter, shot, from) {
    const def = shot.def;
    const playerEar = eyePosition(this.player);
    for (const dir of shot.dirs) {
      const hit = traceShot(this.world, this.agents, from, dir, def.range, shooter.id);
      this.fx.tracer(from, hit.point, def.tracer);
      if (hit.kind === 'agent') {
        const dmg = def.damage * (hit.isHead ? def.headMult : 1);
        const dealt = applyDamage(hit.agent, dmg, hit.isHead);
        this.fx.blood(hit.point);
        if (shooter.isPlayer) {
          this.hud.hitmarker(hit.isHead);
          this.sfx.hit(hit.isHead);
          // enemy flashes red when hit, so every landed shot reads
          if (hit.agent.model) hit.agent.model.flashHit();
        }
        // the player was hit: red vignette + hurt sound, throttled so a
        // burst does not spam it
        if (hit.agent.isPlayer && this.simTime - this._lastHurtAt > 0.25) {
          this._lastHurtAt = this.simTime;
          this.hud.damageFlash();
          this.sfx.hurt();
        }
        if (!hit.agent.alive) this.onKill(shooter, hit.agent, hit.isHead ? 'headshot' : 'shot');
      } else if (hit.kind === 'wall') {
        this.fx.impact(hit.point);
      }
    }
    // sound: distance from the player's ear
    const d = Math.hypot(from.x - playerEar.x, from.y - playerEar.y, from.z - playerEar.z);
    this.sfx.shot(def.sound, d);
    // bots react to the sound
    for (const b of this.bots) b.hearShot(from.x, from.z);
    // recoil + muzzle flash for the human player
    if (shooter.isPlayer) {
      this.playerCtrl.applyRecoil(def.recoil);
      this.viewmodel.kick(def.recoil);
      this.viewmodel.muzzleFlash();
    }
  }

  onKill(killer, victim, how) {
    const killerName = killer ? killer.name : 'The bomb';
    this.hud.killfeed(`${killerName} ✕ ${victim.name}${how === 'headshot' ? ' (headshot)' : ''}`);
    if (killer && killer.isPlayer) {
      this.money += ECONOMY.killReward;
      this.sfx.kill();
    }
    if (victim.isPlayer) {
      this.sfx.hurt();
      this.enterSpectate();
    }
    if (victim.model) victim.model.setDead();
    if (this.bomb.state === 'carried' && this.bomb.carrierId === victim.id) {
      this.dropBombAt(victim.pos.x, victim.pos.z);
    }
    if (this.spectateId === victim.id) this.advanceSpectate();
  }

  // ---- grenades ---------------------------------------------------------------
  cycleGrenade(agent) {
    const order = ['frag', 'flash', 'smoke'];
    let i = order.indexOf(agent.grenadeType);
    for (let k = 0; k < 3; k++) {
      i = (i + 1) % 3;
      if (agent.grenades[order[i]] > 0) { agent.grenadeType = order[i]; return; }
    }
  }

  throwGrenade(agent) {
    const type = agent.grenadeType;
    if (!agent.grenades[type] || agent.grenades[type] <= 0) {
      if (agent.isPlayer) { this.sfx.denied(); this.hud.setHint('No grenades — buy some with B in the buy phase'); }
      return;
    }
    agent.grenades[type]--;
    const eye = eyePosition(agent);
    const dir = aimDirection(agent.yaw, agent.pitch);
    this.grenades.push({
      type, x: eye.x, y: eye.y, z: eye.z,
      vx: dir.x * 14, vy: dir.y * 14 + 3.5, vz: dir.z * 14,
      fuse: type === 'frag' ? 1.4 : 1.1, owner: agent,
    });
    if (agent.isPlayer) this.sfx.reload();
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.vy -= 12 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y <= 0.3) { g.y = 0.3; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.grenades.splice(i, 1);
        this.detonateGrenade(g);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      this.smokes[i].life -= dt;
      if (this.smokes[i].life <= 0) this.smokes.splice(i, 1);
    }
  }

  detonateGrenade(g) {
    if (g.type === 'frag') {
      this.sfx.explosion();
      this.fx.impact({ x: g.x, y: g.y, z: g.z }, 0xff7b2d);
      for (const a of this.agents) {
        if (!a.alive || a.id === g.owner.id) continue;
        const d = Math.hypot(a.pos.x - g.x, a.pos.y + 1 - g.y, a.pos.z - g.z);
        if (d < 9) {
          applyDamage(a, Math.round(95 * (1 - d / 9)), false);
          if (!a.alive) this.onKill(g.owner, a, 'frag');
        }
      }
    } else if (g.type === 'flash') {
      this.sfx.flashbang();
      for (const a of this.agents) {
        if (!a.alive) continue;
        const d = dist2d(a.pos.x, a.pos.z, g.x, g.z);
        if (d > 26) continue;
        const eye = eyePosition(a);
        if (this.world.losBlocked(eye.x, eye.y, eye.z, g.x, g.y + 0.5, g.z)) continue;
        // facing the flash matters: dot of view dir with direction to flash
        const dir = aimDirection(a.yaw, a.pitch);
        const to = { x: g.x - a.pos.x, y: 0, z: g.z - a.pos.z };
        const tl = Math.hypot(to.x, to.z) || 1;
        const facing = (dir.x * to.x + dir.z * to.z) / tl;
        if (facing > -0.2) {
          if (a.isPlayer) {
            this._flashUntil = this.simTime + 2.2;
            this.hud.flash();
          } else {
            // blinded bots stop and spray wide for a while
            const bot = this.bots.find((b) => b.agent === a);
            if (bot) { bot.aimError = 0.6; bot.reactTimer = 2.0; }
          }
        }
      }
    } else {
      const cloud = this.fx.smokeCloud(g.x, 1.2, g.z);
      this.smokes.push({ x: g.x, y: 1.2, z: g.z, r: 3.2, life: 14, group: cloud });
    }
  }

  smokeBlocks(x0, y0, z0, x1, y1, z1) {
    for (const s of this.smokes) {
      // segment vs sphere
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const fx = x0 - s.x, fy = y0 - s.y, fz = z0 - s.z;
      const a = dx * dx + dy * dy + dz * dz;
      const b = 2 * (fx * dx + fy * dy + fz * dz);
      const c = fx * fx + fy * fy + fz * fz - s.r * s.r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= 1) return true;
    }
    return false;
  }

  // ---- buy menu ---------------------------------------------------------------
  toggleBuyMenu() {
    if (this.hud.buyOpen) { this.hud.closeBuy(); return; }
    this.hud.openBuy(this.money, this.phase, this.player.ownedWeapons);
    if (this.phase !== 'buy') this.hud.setHint('Buying is closed — live round, view only');
  }

  buyItem(kind, id) {
    if (this.phase !== 'buy') { this.sfx.denied(); return false; }
    const price = kind === 'weapon' ? WEAPONS[id].price
      : kind === 'grenade' ? GRENADES[id].price
      : ECONOMY.kevlarPrice;
    if (this.money < price) { this.sfx.denied(); return false; }
    if (kind === 'weapon' && this.player.ownedWeapons.includes(id)) {
      this.playerCtrl.switchWeapon(id);
      this.sfx.buy();
      return true;
    }
    this.money -= price;
    if (kind === 'weapon') {
      this.player.ownedWeapons.push(id);
      this.playerCtrl.switchWeapon(id);
    } else if (kind === 'grenade') {
      this.player.grenades[id]++;
      this.player.grenadeType = id;
    } else {
      this.player.armor = 100;
    }
    this.sfx.buy();
    return true;
  }

  // ---- hold-E plant / defuse ----------------------------------------------------
  channelInteract(agent, dt) {
    if (this.phase !== 'live') return;
    if (agent.team === 'amber' && this.bomb.state === 'carried' && this.bomb.carrierId === agent.id) {
      const site = agent.pos.x < 0 ? MAP.siteA : MAP.siteB;
      const d = dist2d(agent.pos.x, agent.pos.z, site.x, site.z);
      if (d > MAP.siteRadius) return;
      if (!this.channel || this.channel.kind !== 'plant') {
        this.channel = { kind: 'plant', t: 0, need: MATCH.bombPlantSeconds, site: site.label };
      }
      this.channel.t += dt;
      if (agent.isPlayer) {
        this.hud.setPlant(this.channel.t / this.channel.need, `PLANTING BOMB — ${site.label}`);
        if (Math.floor(this.channel.t * 4) !== Math.floor((this.channel.t - dt) * 4)) this.sfx.plantTick();
      }
      if (this.channel.t >= this.channel.need) {
        this.plantBomb(agent, site.label);
        this.channel = null;
        this.hud.setPlant(null);
      }
      return;
    }
    if (agent.team === 'teal' && this.bomb.state === 'planted') {
      const d = dist2d(agent.pos.x, agent.pos.z, this.bomb.x, this.bomb.z);
      if (d > 2.4) return;
      if (!this.channel || this.channel.kind !== 'defuse') {
        this.channel = { kind: 'defuse', t: 0, need: MATCH.bombDefuseSeconds, site: this.bomb.site };
      }
      this.channel.t += dt;
      if (agent.isPlayer) {
        this.hud.setPlant(this.channel.t / this.channel.need, 'DEFUSING BOMB');
        if (Math.floor(this.channel.t * 4) !== Math.floor((this.channel.t - dt) * 4)) this.sfx.plantTick();
      }
      if (this.channel.t >= this.channel.need) {
        this.defuseBomb(agent);
        this.channel = null;
        this.hud.setPlant(null);
      }
    }
  }

  cancelChannel() {
    if (this.channel) {
      this.channel = null;
      this.hud.setPlant(null);
    }
  }

  // ---- spectate ------------------------------------------------------------------
  enterSpectate() {
    this.viewmodel.setVisible(false);
    this.hud.showDeath();
    this.hud.setSpectate('Spectating — click to cycle teammates');
    const mates = this.aliveTeammates();
    this.spectateId = mates.length ? mates[0].id : null;
  }

  advanceSpectate() {
    const mates = this.aliveTeammates();
    if (!mates.length) { this.spectateId = null; return; }
    const i = mates.findIndex((a) => a.id === this.spectateId);
    this.spectateId = mates[(i + 1) % mates.length].id;
  }

  spectateTarget() {
    return this.spectateId ? this.agentById(this.spectateId) : null;
  }

  // ---- per-tick simulation ---------------------------------------------------------
  update(dt) {
    this.simTime += dt;
    if (this.phase === 'menu' || this.phase === 'matchEnd') {
      this.fx.update(dt);
      return;
    }
    if (this.phase === 'buy') {
      this.phaseTime -= dt;
      // player may move and buy; bots wait at spawn
      if (this.player.alive) this.playerCtrl.update(dt, this.input, this);
      if (this.input.pressed('Enter')) this.skipBuyPhase();
      if (this.phaseTime <= 0) this.skipBuyPhase();
    } else if (this.phase === 'live') {
      // Screenshot staging for the plant moment: bots hold still, the round
      // timer does not run down, and the plant channel loops mid-progress
      // so the frame always shows the plant in progress.
      if (this.stagePlanting) {
        if (this.channel) {
          this.channel.t += dt;
          if (this.channel.t >= this.channel.need) this.channel.t = 0.4;
          this.hud.setPlant(this.channel.t / this.channel.need, 'PLANTING BOMB — A');
        }
        this.fx.update(dt);
        this.world.update(dt, this.simTime);
        this.input.endFrame();
        for (const a of this.agents) {
          if (!a.model || a === this.player) continue;
          if (a.alive) a.model.pose(a.pos.x, a.pos.z, a.yaw, 0, dt);
        }
        return;
      }
      this.phaseTime -= dt;
      if (this.player.alive) this.playerCtrl.update(dt, this.input, this);
      for (const b of this.bots) b.update(dt);
      this.updateGrenades(dt);
      // bomb timer + beeps that speed up as it runs down
      if (this.bomb.state === 'planted') {
        this.bomb.timer -= dt;
        this.beepTimer -= dt;
        if (this.beepTimer <= 0) {
          this.beepTimer = 0.25 + 0.75 * (this.bomb.timer / MATCH.bombTimerSeconds);
          this.sfx.beep(this.bomb.timer < 10);
        }
        if (this.bomb.timer <= 0) this.detonateBomb();
      }
      // round-end checks
      if (this.phase === 'live') {
        if (this.aliveCount('amber') === 0) this.endRound('teal', this.bomb.state === 'planted' ? 'Attackers eliminated — bomb fizzles' : 'Amber team eliminated');
        else if (this.aliveCount('teal') === 0) this.endRound('amber', 'Teal team eliminated');
        else if (this.phaseTime <= 0 && this.bomb.state !== 'planted') this.endRound('teal', 'Time expired — bomb never planted');
      }
      // screenshot staging: the player keeps firing in bursts
      if (this.stageFiring && this.player.alive) {
        const w = this.player.weapon;
        if (w.mag === 0 && !w.reloading) w.startReload();
        if (w.cooldown <= 0 && !w.reloading && w.mag > 0) {
          const shot = w.tryFire(aimDirection(this.player.yaw, this.player.pitch), 0.1);
          if (shot && !shot.empty) this.resolveShot(this.player, shot, eyePosition(this.player));
        }
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseTime -= dt;
      this.updateGrenades(dt);
      if (this.phaseTime <= 0) this.nextRoundOrEnd();
    }

    // models follow agents
    for (const a of this.agents) {
      if (!a.model || a === this.player) continue;
      if (a.alive) a.model.pose(a.pos.x, a.pos.z, a.yaw, a.moving || 0, dt);
    }
    this.fx.update(dt);
    this.world.update(dt, this.simTime);
    this.input.endFrame();
  }

  // ---- screenshot staging -----------------------------------------------------------
  // Deterministic scene setups for the three dossier screenshots. These run
  // the real game — same sim, same code — with a chosen starting state.
  applyStage(stage) {
    this.startMatch();
    if (stage === 'buy') {
      this.money = 4650;
      this.hud.openBuy(this.money, 'buy', this.player.ownedWeapons);
      this.hud.setHint('Buy phase — click an item to buy it');
      return;
    }
    if (stage === 'cover') {
      this.skipBuyPhase();
      this.round = 3;
      this.scoreAmber = 2;
      this.scoreTeal = 1;
      this.phaseTime = 84;
      this.money = 3200;
      this.player.hp = 82;
      this.player.pos.x = 0;
      this.player.pos.z = 14;
      // aimed slightly off the nearest enemy: suppressive fire with visible
      // tracers, so the cover shows a fight, not a graveyard
      this.player.yaw = 0.12;
      this.player.pitch = -0.1; // slightly down: more map, less empty sky
      this.player.ownedWeapons = ['pistol', 'rifle'];
      this.player.weapon = new WeaponState('rifle');
      this.player.weaponId = 'rifle';
      // three defenders mid-map, facing the player, mid-fight; the other two
      // hold the sites so the cover shows depth, not an empty backfield
      const teals = this.agents.filter((a) => a.team === 'teal');
      const spots = [[-4, 4, 2.8], [3, 2, -2.9], [0, -4, 3.1], [-14, -12, 2.2], [14, -12, -2.2]];
      teals.forEach((t, i) => {
        t.pos.x = spots[i][0];
        t.pos.z = spots[i][1];
        t.yaw = spots[i][2];
        t.alive = true;
        t.hp = 100;
        if (t.model) t.model.setAlive();
      });
      // two teammates visible on the flanks, the other two pushing mid
      const mates = this.agents.filter((a) => a.team === 'amber' && !a.isPlayer);
      mates[0].pos.x = -6; mates[0].pos.z = 11; mates[0].yaw = 0.2;
      mates[1].pos.x = 6; mates[1].pos.z = 12; mates[1].yaw = -0.2;
      mates[2].pos.x = -2; mates[2].pos.z = 8; mates[2].yaw = 0.1;
      mates[3].pos.x = 2; mates[3].pos.z = 9; mates[3].yaw = -0.1;
      this.stageFiring = true;
      this.hud.setHint('');
      return;
    }
    if (stage === 'plant') {
      this.skipBuyPhase();
      this.round = 2;
      this.scoreAmber = 1;
      this.scoreTeal = 0;
      this.phaseTime = 61;
      this.money = 2100;
      this.bomb.carrierId = 'player';
      this.bomb.state = 'carried';
      // stand at the site edge looking into site A: ring, A board and the
      // objective all read, without standing under the board
      this.player.pos.x = -16.8;
      this.player.pos.z = -9.8;
      this.player.yaw = 0.6;
      this.player.pitch = -0.06;
      this.player.hp = 100;
      this.player.armor = 100;
      this.player.ownedWeapons = ['pistol', 'rifle'];
      this.player.weapon = new WeaponState('rifle');
      this.player.weaponId = 'rifle';
      this.channel = { kind: 'plant', t: 1.8, need: MATCH.bombPlantSeconds, site: 'A' };
      this.stagePlanting = true;
      const teals = this.agents.filter((a) => a.team === 'teal');
      teals[0].pos.x = -26; teals[0].pos.z = -18; teals[0].yaw = 2.4;
      teals[1].pos.x = -13; teals[1].pos.z = -19; teals[1].yaw = 1.8;
      const mates = this.agents.filter((a) => a.team === 'amber' && !a.isPlayer);
      mates[0].pos.x = -19; mates[0].pos.z = -19; mates[0].yaw = 0.8;
      mates[1].pos.x = -14; mates[1].pos.z = -13; mates[1].yaw = 0.5;
      return;
    }
    if (stage === 'spec') {
      this.skipBuyPhase();
      this.player.hp = 0;
      this.player.alive = false;
      this.enterSpectate();
      const mates = this.aliveTeammates();
      if (mates[0]) {
        mates[0].pos.x = 0;
        mates[0].pos.z = 2;
        mates[0].yaw = 0;
      }
    }
  }

  // Debug handle for verification scripts (not a cheat: read-only state).
  debugState() {
    return {
      phase: this.phase,
      round: this.round,
      scoreAmber: this.scoreAmber,
      scoreTeal: this.scoreTeal,
      money: this.money,
      phaseTime: Math.round(this.phaseTime * 10) / 10,
      bomb: { ...this.bomb },
      player: {
        hp: this.player.hp, alive: this.player.alive,
        pos: { ...this.player.pos }, yaw: this.player.yaw,
        weapon: this.player.weaponId, mag: this.player.weapon.mag,
        owned: [...this.player.ownedWeapons], armor: this.player.armor,
        grenades: { ...this.player.grenades },
      },
      bots: this.bots.map((b) => ({
        id: b.agent.id, team: b.agent.team, alive: b.agent.alive,
        x: Math.round(b.agent.pos.x * 10) / 10, z: Math.round(b.agent.pos.z * 10) / 10,
        movedFromSpawn: Math.round(b.movedFromSpawn * 10) / 10,
      })),
      spectateId: this.spectateId,
    };
  }
}
