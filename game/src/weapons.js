// Gunplay: hitscan firing with recoil and spread, tracers, impacts,
// headshot vs body damage, and grenades (frag / flash / smoke).
// Damage falls to zero past a weapon's range; kevlar absorbs half.

import * as THREE from 'three';
import { WEAPONS, MAP, clamp } from './config.js';

// Where a shot from `from` along `dir` first hits: a wall, the ground, or
// an agent's head/body sphere. Returns {kind, agent, isHead, point, dist}.
export function traceShot(world, agents, from, dir, maxDist, shooterId) {
  const wall = world.rayHit(from.x, from.y, from.z, dir.x, dir.y, dir.z, maxDist);
  const wallDist = wall ? wall.dist : maxDist;
  let best = null;
  for (const a of agents) {
    if (!a.alive || a.id === shooterId) continue;
    // head sphere (r 0.24) at eye-0.1, body sphere (r 0.48) at chest
    const headC = { x: a.pos.x, y: a.pos.y + 1.52, z: a.pos.z };
    const bodyC = { x: a.pos.x, y: a.pos.y + 1.05, z: a.pos.z };
    const th = raySphere(from, dir, headC, 0.26);
    if (th !== null && th < wallDist && (best === null || th < best.dist)) {
      best = { kind: 'agent', agent: a, isHead: true, dist: th };
    }
    const tb = raySphere(from, dir, bodyC, 0.5);
    if (tb !== null && tb < wallDist && (best === null || tb < best.dist)) {
      best = { kind: 'agent', agent: a, isHead: false, dist: tb };
    }
  }
  if (best) {
    best.point = {
      x: from.x + dir.x * best.dist,
      y: from.y + dir.y * best.dist,
      z: from.z + dir.z * best.dist,
    };
    return best;
  }
  if (wall) return { kind: 'wall', point: { x: wall.x, y: wall.y, z: wall.z }, dist: wall.dist };
  return { kind: 'none', point: { x: from.x + dir.x * maxDist, y: from.y + dir.y * maxDist, z: from.z + dir.z * maxDist }, dist: maxDist };
}

function raySphere(origin, dir, center, radius) {
  const ox = center.x - origin.x, oy = center.y - origin.y, oz = center.z - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return null;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return null;
  return tca - Math.sqrt(r2 - d2);
}

// Visual effects owned by the weapon module: tracers, impact puffs, smoke.
export class WeaponFx {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.puffs = [];
    this.smokes = [];
  }

  tracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  impact(point, color = 0xd8c49a) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    m.position.set(point.x, point.y, point.z);
    this.scene.add(m);
    this.puffs.push({ mesh: m, life: 0.25 });
  }

  blood(point) {
    this.impact(point, 0x8e1f1f);
  }

  smokeCloud(x, y, z) {
    const group = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(1.1 + Math.random() * 0.8, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xcfc8bd, transparent: true, opacity: 0.55, roughness: 1 }),
      );
      s.position.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 2.4);
      group.add(s);
    }
    group.position.set(x, y, z);
    this.scene.add(group);
    this.smokes.push({ group, life: 14 });
    return group;
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      p.mesh.scale.multiplyScalar(1 + dt * 4);
      p.mesh.material.opacity = Math.max(0, p.life / 0.25) * 0.9;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.puffs.splice(i, 1);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.group);
        this.smokes.splice(i, 1);
      }
    }
  }
}

// One agent's weapon state. `owner` is the agent object (player or bot).
export class WeaponState {
  constructor(weaponId) {
    this.setWeapon(weaponId);
  }

  setWeapon(weaponId) {
    const def = WEAPONS[weaponId];
    this.def = def;
    this.weaponId = weaponId;
    this.mag = def.magSize;
    this.reserve = def.reserveMax;
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloading = false;
    this.bloom = 0; // spread growth from sustained fire
  }

  get name() { return this.def.name; }

  startReload() {
    if (this.reloading || this.mag >= this.def.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTimer = this.def.reloadTime;
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.9);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const need = this.def.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = false;
      }
    }
  }

  // Fire one trigger pull. Returns a shot record or null (not ready / empty).
  // `aimDir` is the base direction; spread and recoil are applied here.
  // `moving` 0..1 scales the movement spread penalty.
  tryFire(aimDir, moving, rng = Math.random) {
    if (this.cooldown > 0 || this.reloading) return null;
    if (this.mag <= 0) return { empty: true };
    this.mag -= 1;
    this.cooldown = this.def.fireInterval;
    this.bloom = Math.min(0.05, this.bloom + this.def.recoil * 0.55);
    const spread = this.def.spread + this.def.moveSpread * moving + this.bloom;
    const pellets = this.def.pellets || 1;
    const dirs = [];
    for (let p = 0; p < pellets; p++) {
      const a = rng() * Math.PI * 2;
      const r = spread * Math.sqrt(rng());
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
      // perturb aimDir by small perpendicular offsets
      const up = Math.abs(aimDir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      const right = norm(cross(aimDir, up));
      const upv = cross(right, aimDir);
      dirs.push(norm({
        x: aimDir.x + right.x * dx + upv.x * dy,
        y: aimDir.y + right.y * dx + upv.y * dy,
        z: aimDir.z + right.z * dx + upv.z * dy,
      }));
    }
    return { def: this.def, dirs, empty: false };
  }
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

// Apply damage with kevlar: kevlar absorbs ECONOMY.kevlarAbsorb of the hit
// until its armour points run out. Returns damage actually dealt to health.
export function applyDamage(target, rawDamage, isHead) {
  let dmg = rawDamage;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, dmg * 0.5);
    target.armor -= absorbed;
    dmg -= absorbed;
  }
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
  }
  return dmg;
}

export function eyePosition(agent) {
  return {
    x: agent.pos.x,
    y: agent.pos.y + (agent.crouching ? MAP.crouchEyeHeight : MAP.eyeHeight),
    z: agent.pos.z,
  };
}

export function aimDirection(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
