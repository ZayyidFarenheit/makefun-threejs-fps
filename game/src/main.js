// Bootstrap: renderer, fixed-step simulation (60 Hz) fully separate from
// rendering, first-person camera and the third-person spectate chase
// camera (bug §4.4), WebGL context-loss recovery and error guards (§4.7).
// No network: the only import is the vendored three.js module.

import * as THREE from 'three';
import { World } from './world.js';
import { ViewModel } from './soldier.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { MAP, clamp } from './config.js';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));

const params = new URLSearchParams(location.search);
const stage = params.get('stage'); // cover | buy | plant | spec (screenshot staging)

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('start-screen').querySelector('p').textContent =
    'WebGL 2 is not available in this browser, so the game cannot start. Please use desktop Chrome.';
  throw err;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.id = 'gl';
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = new World(scene);
const viewmodel = new ViewModel(camera);
const hud = new Hud(document);
const sfx = new SoundBank();
const input = new Input(renderer.domElement, {
  onPause: () => {
    if (game.phase === 'live' || game.phase === 'buy') hud.showPause();
  },
  isDead: () => game.player && !game.player.alive,
  onLockFailed: () => hud.setLockHint(true),
  onAnyKey: () => sfx.ensure(),
});
const game = new Game(scene, camera, world, viewmodel, hud, input, sfx);
window.__fps = { game, world, hud, input, sfx, THREE, version: 'duskfall-1' };

// ---- UI wiring ------------------------------------------------------------
document.getElementById('play').addEventListener('click', () => {
  sfx.ensure();
  sfx.startAmbient();
  hud.hideStart();
  game.startMatch();
  input.requestLock();
});
document.getElementById('resume').addEventListener('click', () => {
  input.armResumeGuard();
  hud.hidePause();
  input.requestLock();
});
document.getElementById('quit-to-start').addEventListener('click', () => {
  hud.hidePause();
  game.phase = 'menu';
  hud.showStart();
  input.exitLock();
});
document.getElementById('play-again').addEventListener('click', () => {
  hud.hideEnd();
  game.startMatch();
  input.requestLock();
});
document.getElementById('round-skip').addEventListener('click', () => game.skipBuyPhase());
document.getElementById('death-screen').addEventListener('click', () => game.advanceSpectate());
// buy menu rows (event delegation; view-only rows do nothing when closed)
document.getElementById('buy-items').addEventListener('click', (e) => {
  const row = e.target.closest('.buy-row');
  if (!row) return;
  if (game.phase !== 'buy') return;
  game.buyItem(row.dataset.kind, row.dataset.id);
});
// spectate cycling also on canvas click while dead (resume click never fires
// a shot: the player controller is skipped while dead)
renderer.domElement.addEventListener('mousedown', () => {
  if (game.player && !game.player.alive && (game.phase === 'live' || game.phase === 'buy')) {
    game.advanceSpectate();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- WebGL context loss: show a note, resume cleanly -----------------------
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  hud.setHint('Graphics context lost — restoring…');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  hud.setHint('');
});

// ---- spectate chase camera (bug §4.4) ---------------------------------------
// Behind and above the target (~2.2 m back, ~0.9 m above eye), looking past
// them at their aim point. Pull-back is clamped step by step against
// colliders and requires an open ray camera→aim; boxed in, it falls back to
// the eye position and hides the target mesh only then.
//
// The camera never hard-cuts into spectate: on death (and when the watched
// teammate changes) it glides from the current pose to the chase pose over
// ~0.5 s with a smoothstep ease, so dying feels like a swoop, not a snap.
const lastGoodCam = { x: 0, y: 2, z: 20 };
let specBlend = 1; // 0..1: 1 = fully on the chase camera
let specFrom = null; // camera pose {x,y,z,ax,ay,az} the glide starts from
let specWasAlive = true;
let specTargetId = null;

function updateSpectateCamera(target, blend = 1, from = null) {
  const eyeY = target.pos.y + MAP.eyeHeight;
  const fx = -Math.sin(target.yaw), fz = -Math.cos(target.yaw);
  const fy = Math.sin(target.pitch);
  // Clamp the aim point to just before the first wall the target faces, so
  // the camera never falls back to the eye position (which hides the target
  // and shows a blank wall) when the target faces a nearby wall. The aim
  // must stay strictly on this side of the wall: 85% of the hit distance,
  // and halfway when the wall is so close even that overshoots it.
  let aimDist = 8;
  const hit = world.rayHit(target.pos.x, eyeY, target.pos.z, fx, fy, fz, 8);
  if (hit) {
    aimDist = Math.min(8, hit.dist * 0.85);
    aimDist = Math.max(0.15, aimDist);
    if (aimDist >= hit.dist) aimDist = hit.dist * 0.5;
  }
  const aimX = target.pos.x + fx * aimDist;
  const aimY = eyeY + fy * aimDist;
  const aimZ = target.pos.z + fz * aimDist;
  const dists = [2.2, 1.5, 0.8, 0.3];
  let pose = null;
  for (const d of dists) {
    const cx = target.pos.x - fx * d;
    const cy = eyeY + 0.9;
    const cz = target.pos.z - fz * d;
    if (pointInCollider(cx, cy, cz, 0.35)) continue;
    if (world.losBlocked(cx, cy, cz, aimX, aimY, aimZ)) continue;
    pose = { cx, cy, cz, ax: aimX, ay: aimY, az: aimZ };
    target.model.group.visible = true;
    break;
  }
  if (!pose) {
    // boxed in: eye position, hide the target mesh so it does not fill the frame
    pose = { cx: target.pos.x, cy: eyeY, cz: target.pos.z, ax: aimX, ay: aimY, az: aimZ };
    target.model.group.visible = false;
  }
  // Glide from the death pose (or the old chase pose on a target change)
  // instead of snapping: smoothstep over ~0.5 s.
  if (from && blend < 1) {
    const t = blend * blend * (3 - 2 * blend);
    pose = {
      cx: from.x + (pose.cx - from.x) * t,
      cy: from.y + (pose.cy - from.y) * t,
      cz: from.z + (pose.cz - from.z) * t,
      ax: from.ax + (pose.ax - from.ax) * t,
      ay: from.ay + (pose.ay - from.ay) * t,
      az: from.az + (pose.az - from.az) * t,
    };
  }
  setCamera(pose.cx, pose.cy, pose.cz, pose.ax, pose.ay, pose.az);
}

function pointInCollider(x, y, z, pad) {
  for (const c of world.colliders) {
    if (y > c.height) continue;
    if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
  }
  return false;
}

function setCamera(cx, cy, cz, ax, ay, az) {
  if (![cx, cy, cz, ax, ay, az].every(Number.isFinite)) return; // keep last good
  camera.position.set(cx, cy, cz);
  camera.lookAt(ax, ay, az);
  lastGoodCam.x = cx;
  lastGoodCam.y = cy;
  lastGoodCam.z = cz;
}

// ---- first-person camera ------------------------------------------------------
function updatePlayerCamera() {
  const p = game.player;
  const eyeY = p.pos.y + (p.crouching ? MAP.crouchEyeHeight : MAP.eyeHeight);
  camera.position.set(p.pos.x, eyeY, p.pos.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  camera.rotation.z = 0;
  if (![camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite)) {
    camera.position.set(lastGoodCam.x, lastGoodCam.y, lastGoodCam.z);
  } else {
    lastGoodCam.x = camera.position.x;
    lastGoodCam.y = camera.position.y;
    lastGoodCam.z = camera.position.z;
  }
}

// ---- fixed-step loop ------------------------------------------------------------
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (contextLost) return;
  let frameDt = (now - last) / 1000;
  last = now;
  if (frameDt > 0.25) frameDt = 0.25;
  acc += frameDt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    game.update(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0; // drop backlog rather than spiral

  // camera
  if (game.player.alive) {
    specWasAlive = true;
    specBlend = 1;
    specTargetId = null;
    updatePlayerCamera();
    viewmodel.update(frameDt, game.playerCtrl.bobPhase, game.playerCtrl.moveAmount);
  } else {
    const target = game.spectateTarget();
    if (target && target.alive) {
      // On death (or a teammate change) start the glide from the current
      // camera pose; otherwise keep riding the chase camera.
      if (specWasAlive || target.id !== specTargetId) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        specFrom = {
          x: camera.position.x, y: camera.position.y, z: camera.position.z,
          ax: camera.position.x + dir.x, ay: camera.position.y + dir.y, az: camera.position.z + dir.z,
        };
        specBlend = 0;
        specWasAlive = false;
        specTargetId = target.id;
      }
      specBlend = Math.min(1, specBlend + frameDt / 0.5);
      updateSpectateCamera(target, specBlend, specFrom);
    }
    else updatePlayerCamera(); // no one left to watch: stay at the body
  }

  // reload dip on the viewmodel
  const w = game.player.weapon;
  if (w && w.reloading) viewmodel.reloadDip(1 - w.reloadTimer / w.def.reloadTime);

  hud.update(game, game.player);
  renderer.render(scene, camera);
}

// ---- staging / start -------------------------------------------------------------
if (stage) {
  hud.hideStart();
  sfx.ensure();
  game.applyStage(stage);
  input.lockFailed = true; // staging runs without pointer lock
  hud.setLockHint(false);
} else {
  hud.showStart();
}
requestAnimationFrame(frame);
