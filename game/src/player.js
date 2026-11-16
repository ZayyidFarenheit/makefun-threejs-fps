// The human player: WASD movement with acceleration and friction (no
// ice-skating), jumping, crouching, circle-vs-AABB collision, weapon
// handling, and the hold-E plant/defuse channel. All state lives on the
// agent object so the sim and the renderer read the same truth.

import { WEAPONS, MAP, ECONOMY, MATCH, clamp } from './config.js';
import { WeaponState, aimDirection, eyePosition } from './weapons.js';

const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const AIR_CONTROL = 0.35;
const ACCEL = 36;
const FRICTION = 6;
const JUMP_VELOCITY = 5.2;
const GRAVITY = 14;

export class PlayerController {
  constructor(agent, world, sfx) {
    this.agent = agent; // {pos, yaw, pitch, hp, armor, alive, ...}
    this.world = world;
    this.sfx = sfx;
    this.vel = { x: 0, z: 0 };
    this.vy = 0;
    this.grounded = true;
    this.bobPhase = 0;
    this.moveAmount = 0; // 0..1 for spread + viewmodel bob
    this.stepTimer = 0;
  }

  giveWeapon(weaponId) {
    this.agent.weapon = new WeaponState(weaponId);
    this.agent.weaponId = weaponId;
  }

  switchWeapon(weaponId) {
    if (!this.agent.ownedWeapons.includes(weaponId)) return false;
    if (this.agent.weaponId === weaponId) return false;
    this.giveWeapon(weaponId);
    return true;
  }

  cycleWeapon(dir) {
    const owned = this.agent.ownedWeapons;
    if (owned.length < 2) return;
    let i = owned.indexOf(this.agent.weaponId);
    i = (i + dir + owned.length) % owned.length;
    this.switchWeapon(owned[i]);
  }

  update(dt, input, game) {
    const a = this.agent;
    if (!a.alive) return;
    const keys = input.down;

    // --- look ------------------------------------------------------------
    const look = input.consumeLook();
    const sens = 0.0023;
    a.yaw -= look.dx * sens;
    a.pitch = clamp(a.pitch - look.dy * sens, -1.45, 1.45);

    // --- movement --------------------------------------------------------
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    a.crouching = crouching;
    let fwd = 0, strafe = 0;
    if (keys.has('KeyW')) fwd += 1;
    if (keys.has('KeyS')) fwd -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;
    const maxSpeed = crouching ? CROUCH_SPEED : WALK_SPEED;
    const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
    // forward is -Z rotated by yaw
    let wx = (-sin * fwd + cos * strafe);
    let wz = (-cos * fwd - sin * strafe);
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = this.grounded ? ACCEL : ACCEL * AIR_CONTROL;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    // friction when no input (strong on ground, none in air)
    if (wl === 0 && this.grounded) {
      const f = Math.max(0, 1 - FRICTION * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > maxSpeed) {
      this.vel.x = (this.vel.x / speed) * maxSpeed;
      this.vel.z = (this.vel.z / speed) * maxSpeed;
    }
    // axis-separated integration + collision
    a.pos.x += this.vel.x * dt;
    this.world.resolveCircle(a.pos, MAP.playerRadius);
    a.pos.z += this.vel.z * dt;
    this.world.resolveCircle(a.pos, MAP.playerRadius);

    // --- vertical: jump + gravity ----------------------------------------
    if (keys.has('Space') && this.grounded) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      a.pos.y += this.vy * dt;
      if (a.pos.y <= 0) { a.pos.y = 0; this.vy = 0; this.grounded = true; }
    }

    this.moveAmount = clamp(speed / WALK_SPEED, 0, 1);
    if (this.moveAmount > 0.1 && this.grounded) {
      this.bobPhase += dt * speed * 1.9;
      this.stepTimer -= dt * speed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.2;
        this.sfx.footstep();
      }
    }

    // --- weapons ----------------------------------------------------------
    const w = a.weapon;
    w.update(dt);
    if (input.pressed('KeyR')) {
      if (w.startReload()) this.sfx.reload();
      else if (w.mag === 0) this.sfx.dryClick();
    }
    if (input.pressed('Digit1')) this.switchWeapon('pistol');
    if (input.pressed('Digit2')) this.switchWeapon('smg');
    if (input.pressed('Digit3')) this.switchWeapon('rifle');
    if (input.pressed('Digit4')) this.switchWeapon('shotgun');
    if (input.pressed('Digit5')) this.switchWeapon('sniper');
    if (input.pressed('KeyQ')) this.cycleWeapon(1);
    const wheel = input.consumeWheel();
    if (wheel !== 0) this.cycleWeapon(wheel > 0 ? 1 : -1);

    const wantFire = input.firing || (w.def.auto && input.firing);
    const autoHeld = w.def.auto ? input.firing : input.firing && !this._firedThisPress;
    if (input.firing) {
      if (w.def.auto || !this._firedThisPress) {
        const shot = w.tryFire(aimDirection(a.yaw, a.pitch), this.moveAmount);
        if (shot) {
          if (shot.empty) this.sfx.dryClick();
          else game.resolveShot(a, shot, eyePosition(a));
          this._firedThisPress = true;
        }
      }
    } else {
      this._firedThisPress = false;
    }

    // --- grenades ----------------------------------------------------------
    if (input.pressed('KeyF')) game.cycleGrenade(a);
    if (input.pressed('KeyG')) game.throwGrenade(a);

    // --- plant / defuse channel (hold E) ----------------------------------
    if (keys.has('KeyE')) game.channelInteract(a, dt);
    else game.cancelChannel(a);

    // --- buy menu ----------------------------------------------------------
    if (input.pressed('KeyB')) game.toggleBuyMenu(a);
  }

  // Recoil kick applied by the game after a shot lands.
  applyRecoil(amount) {
    const a = this.agent;
    a.pitch = clamp(a.pitch + amount * 0.6, -1.45, 1.45);
    a.yaw += (Math.random() - 0.5) * amount * 0.35;
  }
}
