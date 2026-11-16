// Bot AI: 5v5 teammates and opponents that play the round for real.
// Attackers pick a site and push it; defenders hold and retake; everyone
// reacts to sight and sound, plants and defuses. Includes the stuck
// recovery from bug §4.3: a bot that moves ≤0.5 m in 1.5 s sidesteps
// ~2.5 m perpendicular to the blocked direction, then retries its path.

import { MAP, WEAPONS, clamp, rand, randPick, angleLerp, dist2d } from './config.js';
import { WeaponState, aimDirection, eyePosition, traceShot, applyDamage } from './weapons.js';

const BOT_SPEED = 4.6;
const REACT_MIN = 0.35;
const REACT_MAX = 0.75;
const ENGAGE_RANGE = 42;

export class BotController {
  constructor(agent, world, game) {
    this.agent = agent;
    this.world = world;
    this.game = game;
    this.path = []; // waypoint indices
    this.pathI = 0;
    this.objective = 'push'; // push | hold | plant | defuse | retake | hunt
    this.targetSite = null;
    this.holdPoint = null;
    this.holdYaw = 0;
    this.decideTimer = 0;
    this.target = null; // visible enemy agent
    this.reactTimer = 0;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.aimError = 0;
    this.lastPos = { x: agent.pos.x, z: agent.pos.z };
    this.stuckTimer = 0;
    this.sidestepDir = 1;
    this.sidestepTimer = 0;
    this.sidestepTarget = null;
    this.lastShotHeard = null; // {x, z, time}
    this.plantTimer = 0;
    this.defuseTimer = 0;
    this.spawnPos = { x: agent.pos.x, z: agent.pos.z };
    this.movedFromSpawn = 0;
  }

  resetForRound(site) {
    const a = this.agent;
    // Record the spawn point startRound already placed this bot at.
    // (Do NOT move the bot here: the constructor's spawnPos is (0,0), and
    // resetting to it used to teleport every bot to the middle of the map.)
    this.spawnPos = { x: a.pos.x, z: a.pos.z };
    a.pos.y = 0;
    a.hp = 100;
    a.armor = 0;
    a.alive = true;
    a.crouching = false;
    this.path = [];
    this.pathI = 0;
    this.target = null;
    this.reactTimer = 0;
    this.burstLeft = 0;
    this.stuckTimer = 0;
    this.sidestepTimer = 0;
    this.sidestepTarget = null;
    this.plantTimer = 0;
    this.defuseTimer = 0;
    this.movedFromSpawn = 0;
    // attackers get a rifle or smg, defenders a rifle or shotgun
    const pool = a.team === 'amber' ? ['rifle', 'rifle', 'smg', 'shotgun'] : ['rifle', 'rifle', 'smg', 'sniper'];
    const w = randPick(pool);
    a.weapon = new WeaponState(w);
    a.weaponId = w;
    a.ownedWeapons = ['pistol', w];
    if (a.team === 'amber') {
      this.targetSite = site || randPick(['A', 'B']);
      this.objective = 'push';
      this.setPathToSite(this.targetSite);
    } else {
      this.objective = 'hold';
      const holds = [
        { x: -18, z: -12, yaw: 2.6 }, { x: 18, z: -12, yaw: -2.6 },
        { x: 0, z: -6, yaw: 3.1 }, { x: -20, z: -8, yaw: 2.2 }, { x: 20, z: -8, yaw: -2.2 },
      ];
      const h = holds[this.agent.slot % holds.length];
      this.holdPoint = { x: h.x, z: h.z };
      this.holdYaw = h.yaw;
      this.setPathTo(this.holdPoint.x, this.holdPoint.z);
    }
    if (a.model) a.model.setAlive();
  }

  setPathTo(x, z) {
    const from = this.world.nearestWaypoint(this.agent.pos.x, this.agent.pos.z);
    const to = this.world.nearestWaypoint(x, z);
    this.path = this.world.findPath(from, to);
    this.pathI = 0;
  }

  setPathToSite(site) {
    const def = site === 'A' ? MAP.siteA : MAP.siteB;
    this.setPathTo(def.x, def.z);
  }

  hearShot(x, z) {
    const a = this.agent;
    if (!a.alive) return;
    if (dist2d(a.pos.x, a.pos.z, x, z) < 26) {
      this.lastShotHeard = { x, z, time: this.game.simTime };
    }
  }

  // Pick the nearest visible enemy within range and a forward cone.
  scanForEnemy() {
    const a = this.agent;
    const eye = eyePosition(a);
    let best = null, bestD = ENGAGE_RANGE;
    for (const other of this.game.agents) {
      if (!other.alive || other.team === a.team) continue;
      const d = dist2d(a.pos.x, a.pos.z, other.pos.x, other.pos.z);
      if (d > bestD) continue;
      const oEye = eyePosition(other);
      if (this.world.losBlocked(eye.x, eye.y, eye.z, oEye.x, oEye.y, oEye.z)) continue;
      // must be roughly in front (120 degree cone) unless very close
      const angTo = Math.atan2(-(other.pos.x - a.pos.x), -(other.pos.z - a.pos.z));
      let diff = Math.abs(((angTo - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d > 6 && diff > 1.1) continue;
      best = other;
      bestD = d;
    }
    return best;
  }

  update(dt) {
    const a = this.agent;
    const g = this.game;
    if (!a.alive) return;
    a.weapon.update(dt);
    this.decideTimer -= dt;
    if (this.decideTimer <= 0) {
      this.decideTimer = 0.2;
      this.decide();
    }

    // --- combat: if an enemy is near, stop and shoot. A distant enemy
    // does NOT pin a bot to its spawn: while it still has a path to walk,
    // it keeps pushing and only fights up close (or once it has arrived).
    const enemy = this.scanForEnemy();
    const enemyDist = enemy ? dist2d(a.pos.x, a.pos.z, enemy.pos.x, enemy.pos.z) : Infinity;
    const arrived = this.pathI >= this.path.length ||
      (this.objective === 'hold' && this.holdPoint && dist2d(a.pos.x, a.pos.z, this.holdPoint.x, this.holdPoint.z) < 1.2);
    if (enemy && (enemyDist < 12 || arrived)) {
      if (this.target !== enemy) {
        this.target = enemy;
        this.reactTimer = rand(REACT_MIN, REACT_MAX);
        this.aimError = rand(0.02, 0.07);
      }
      this.reactTimer -= dt;
      // face the target with a little error
      const dx = enemy.pos.x - a.pos.x, dz = enemy.pos.z - a.pos.z;
      const wantYaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * this.aimError;
      a.yaw = angleLerp(a.yaw, wantYaw, Math.min(1, dt * 10));
      const dy = (eyePosition(enemy).y - eyePosition(a).y);
      const dist = Math.max(1, Math.hypot(dx, dz));
      a.pitch = clamp(Math.atan2(dy, dist), -1.2, 1.2);
      if (this.reactTimer <= 0) this.fireAt(enemy, dt);
      this.trackStuck(dt, false);
      return; // engaged: do not walk
    }
    this.target = null;

    // --- bomb duties -------------------------------------------------------
    if (g.bomb.state === 'planted') {
      if (a.team === 'teal') {
        // defenders retake the planted site and defuse
        const site = g.bomb.site === 'A' ? MAP.siteA : MAP.siteB;
        const d = dist2d(a.pos.x, a.pos.z, g.bomb.x, g.bomb.z);
        if (d < 2.2) {
          // channel the defuse
          this.defuseTimer += dt;
          a.yaw = angleLerp(a.yaw, Math.atan2(-(g.bomb.x - a.pos.x), -(g.bomb.z - a.pos.z)), dt * 6);
          if (this.defuseTimer >= 5) {
            g.defuseBomb(a);
            this.defuseTimer = 0;
          }
          return;
        }
        if (this.objective !== 'retake') {
          this.objective = 'retake';
          this.setPathTo(site.x, site.z);
        }
        this.followPath(dt);
        return;
      }
      // attackers: guard the planted bomb from a short distance
      if (this.objective !== 'guard') {
        this.objective = 'guard';
        const site = g.bomb.site === 'A' ? MAP.siteA : MAP.siteB;
        this.setPathTo(site.x + rand(-3, 3), site.z + rand(2, 5));
      }
      this.followPath(dt);
      return;
    }

    // --- plant: attacker carrying the bomb at the site ----------------------
    if (a.team === 'amber' && g.bomb.state === 'carried' && g.bomb.carrierId === a.id) {
      const site = this.targetSite === 'A' ? MAP.siteA : MAP.siteB;
      const d = dist2d(a.pos.x, a.pos.z, site.x, site.z);
      if (d < 3.5) {
        this.plantTimer += dt;
        if (this.plantTimer >= 3) {
          g.plantBomb(a, this.targetSite);
          this.plantTimer = 0;
        }
        return;
      }
    }

    // --- follow the path ----------------------------------------------------
    if (this.objective === 'hold' && this.holdPoint) {
      const d = dist2d(a.pos.x, a.pos.z, this.holdPoint.x, this.holdPoint.z);
      if (d < 1.2) {
        // arrived: hold and watch the lane; occasionally peek toward sound
        a.yaw = angleLerp(a.yaw, this.holdYaw, Math.min(1, dt * 2));
        if (this.lastShotHeard && g.simTime - this.lastShotHeard.time < 2) {
          const want = Math.atan2(-(this.lastShotHeard.x - a.pos.x), -(this.lastShotHeard.z - a.pos.z));
          a.yaw = angleLerp(a.yaw, want, Math.min(1, dt * 4));
        }
        this.trackStuck(dt, false);
        return;
      }
    }
    this.followPath(dt);
  }

  decide() {
    const g = this.game;
    const a = this.agent;
    // If the bomb is dropped, the nearest attacker goes to pick it up.
    if (g.bomb.state === 'dropped' && a.team === 'amber') {
      const d = dist2d(a.pos.x, a.pos.z, g.bomb.x, g.bomb.z);
      if (d < 4) {
        g.bomb.state = 'carried';
        g.bomb.carrierId = a.id;
        g.hud.message(`${a.name} picked up the bomb`);
      } else if (this.objective !== 'fetch') {
        this.objective = 'fetch';
        this.setPathTo(g.bomb.x, g.bomb.z);
      }
    }
  }

  followPath(dt) {
    const a = this.agent;
    if (this.sidestepTimer > 0) {
      // stuck recovery: sidestep perpendicular to the blocked direction
      this.sidestepTimer -= dt;
      if (this.sidestepTarget) {
        this.moveToward(this.sidestepTarget.x, this.sidestepTarget.z, dt, BOT_SPEED * 0.9);
        if (dist2d(a.pos.x, a.pos.z, this.sidestepTarget.x, this.sidestepTarget.z) < 0.6) {
          this.sidestepTimer = 0;
          this.sidestepTarget = null;
        }
      }
      this.trackStuck(dt, true);
      return;
    }
    if (this.pathI >= this.path.length) {
      // reached the end of the path: idle-scan
      this.trackStuck(dt, false);
      return;
    }
    const wp = this.world.waypoints[this.path[this.pathI]];
    const d = dist2d(a.pos.x, a.pos.z, wp.x, wp.z);
    if (d < 0.9) {
      this.pathI++;
      return;
    }
    this.moveToward(wp.x, wp.z, dt, BOT_SPEED);
    this.trackStuck(dt, true);
  }

  moveToward(tx, tz, dt, speed) {
    const a = this.agent;
    const dx = tx - a.pos.x, dz = tz - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const wantYaw = Math.atan2(-dx, -dz);
    a.yaw = angleLerp(a.yaw, wantYaw, Math.min(1, dt * 8));
    // move along the desired direction (not the facing) so strafing works
    a.pos.x += (dx / d) * speed * dt;
    a.pos.z += (dz / d) * speed * dt;
    this.world.resolveCircle(a.pos, MAP.playerRadius);
    a.moving = 1;
  }

  trackStuck(dt, tryingToMove) {
    const a = this.agent;
    const moved = dist2d(a.pos.x, a.pos.z, this.lastPos.x, this.lastPos.z);
    if (tryingToMove) {
      this.stuckTimer += dt;
      if (this.stuckTimer >= 1.5) {
        if (moved <= 0.5) {
          // STUCK: sidestep ~2.5 m perpendicular, alternate sides
          const perp = a.yaw + (Math.PI / 2) * this.sidestepDir;
          this.sidestepDir *= -1;
          this.sidestepTarget = {
            x: a.pos.x + Math.sin(perp) * 2.5,
            z: a.pos.z + Math.cos(perp) * 2.5,
          };
          this.sidestepTimer = 1.4;
          this.stuckTimer = 0;
        } else {
          this.stuckTimer = 0;
        }
        this.lastPos = { x: a.pos.x, z: a.pos.z };
      }
    } else {
      this.stuckTimer = 0;
      this.lastPos = { x: a.pos.x, z: a.pos.z };
    }
    this.movedFromSpawn = Math.max(this.movedFromSpawn, dist2d(a.pos.x, a.pos.z, this.spawnPos.x, this.spawnPos.z));
    a.moving = tryingToMove ? 1 : 0;
  }

  fireAt(enemy, dt) {
    const a = this.agent;
    const g = this.game;
    const w = a.weapon;
    if (this.burstPause > 0) {
      this.burstPause -= dt;
      return;
    }
    if (this.burstLeft <= 0) {
      this.burstLeft = w.def.auto ? 3 + ((Math.random() * 3) | 0) : 1;
    }
    const from = eyePosition(a);
    const to = eyePosition(enemy);
    const base = {
      x: to.x - from.x,
      y: to.y - from.y + (Math.random() - 0.5) * 0.35,
      z: to.z - from.z,
    };
    const len = Math.hypot(base.x, base.y, base.z) || 1;
    const dir = { x: base.x / len, y: base.y / len, z: base.z / len };
    const shot = w.tryFire(dir, 0.25);
    if (shot && !shot.empty) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.burstPause = w.def.auto ? rand(0.35, 0.8) : rand(0.5, 1.0);
      g.resolveShot(a, shot, from);
    }
  }
}
