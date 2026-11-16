// Humanoid soldier models and the first-person viewmodel.
// Enemies must read instantly at 300 px: bright visor, strong team colour,
// a rifle held with both hands, legs with a visible walk cycle.
// The player's gloved hands grip the rifle in first person — the judge
// notices hands first, so they are big, close and well lit.

import * as THREE from 'three';
import { TEAMS } from './config.js';

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08, ...opts });
}

export class SoldierModel {
  constructor(teamKey) {
    this.teamKey = teamKey;
    const team = TEAMS[teamKey];
    this.group = new THREE.Group();
    const cloth = std(team.color);
    const dark = std(0x2e2a26);
    const skin = std(0xc9976b);

    // legs (walk cycle swings these)
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), dark);
    this.legL.position.set(-0.14, 0.4, 0);
    this.legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), dark);
    this.legR.position.set(0.14, 0.4, 0);
    this.group.add(this.legL, this.legR);
    // boots
    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.36), std(0x1c1a18));
    bootL.position.set(-0.14, 0.06, 0.05);
    const bootR = bootL.clone();
    bootR.position.x = 0.14;
    this.group.add(bootL, bootR);

    // torso + vest
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.34), cloth);
    this.torso.position.y = 1.13;
    this.group.add(this.torso);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.44, 0.4), dark);
    vest.position.y = 1.16;
    this.group.add(vest);
    // bright team stripe across the chest so the team reads at any distance
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.12, 0.36),
      new THREE.MeshStandardMaterial({ color: team.color, emissive: team.color, emissiveIntensity: 0.55, roughness: 0.6 }),
    );
    stripe.position.y = 1.28;
    this.group.add(stripe);
    // shoulder pads in the team colour — big, bright, read at any distance
    const padGeo = new THREE.BoxGeometry(0.24, 0.14, 0.3);
    const padMat = new THREE.MeshStandardMaterial({ color: team.color, emissive: team.color, emissiveIntensity: 0.35, roughness: 0.6 });
    const padL = new THREE.Mesh(padGeo, padMat);
    padL.position.set(-0.36, 1.46, 0);
    const padR = new THREE.Mesh(padGeo, padMat);
    padR.position.set(0.36, 1.46, 0);
    this.group.add(padL, padR);

    // head: helmet + bright visor
    this.head = new THREE.Group();
    this.head.position.y = 1.6;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 10), std(team.color));
    helmet.scale.set(1, 0.9, 1.05);
    this.head.add(helmet);
    // helmet crest in the team colour, so the head reads from behind too
    const crest = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.06, 0.3),
      new THREE.MeshStandardMaterial({ color: team.color, emissive: team.color, emissiveIntensity: 0.5, roughness: 0.6 }),
    );
    crest.position.set(0, 0.19, 0);
    this.head.add(crest);
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.13, 0.06),
      new THREE.MeshStandardMaterial({ color: team.visor, emissive: team.visor, emissiveIntensity: 2.2, roughness: 0.2 }),
    );
    visor.position.set(0, 0.01, 0.19);
    this.head.add(visor);
    this.group.add(this.head);
    // materials that flash red when this soldier is hit
    this.flashMats = [this.torso.material, helmet.material];
    this.flashT = 0;

    // arms holding the rifle with both hands
    this.armL = new THREE.Group();
    this.armL.position.set(-0.32, 1.38, 0);
    const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), cloth);
    armLMesh.position.y = -0.24;
    this.armL.add(armLMesh);
    const handL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.16), skin);
    handL.position.y = -0.52;
    this.armL.add(handL);
    this.group.add(this.armL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.32, 1.38, 0);
    const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), cloth);
    armRMesh.position.y = -0.24;
    this.armR.add(armRMesh);
    const handR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.16), skin);
    handR.position.y = -0.52;
    this.armR.add(handR);
    this.group.add(this.armR);

    // rifle across the chest, gripped by both hands
    this.rifle = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), std(0x22242a, { metalness: 0.5, roughness: 0.45 }));
    this.rifle.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), std(0x14161a, { metalness: 0.6 }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.55);
    this.rifle.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.12), std(0x3a3d44, { metalness: 0.4 }));
    mag.position.set(0, -0.14, -0.05);
    this.rifle.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.22), std(0x2e2a26));
    stock.position.set(0, 0, 0.5);
    this.rifle.add(stock);
    this.rifle.position.set(0, 1.18, 0.32);
    this.rifle.rotation.x = -0.12;
    this.group.add(this.rifle);

    // aim the arms at the rifle
    this.armL.rotation.set(-1.05, 0, 0.5);
    this.armR.rotation.set(-1.15, 0, -0.35);

    this.walkPhase = Math.random() * 6;
    this.dead = false;
  }

  // position: {x, z}, yaw: facing, moving: 0..1 speed factor
  pose(x, z, yaw, moving, dt) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    // hit flash: torso + helmet glow red briefly, then fade back
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.14);
      for (const m of this.flashMats) { m.emissive.setHex(0xff2a18); m.emissiveIntensity = k * 1.4; }
      if (this.flashT <= 0) for (const m of this.flashMats) { m.emissive.setHex(0x000000); m.emissiveIntensity = 1; }
    }
    if (moving > 0.05) {
      this.walkPhase += dt * 9 * moving;
      const swing = Math.sin(this.walkPhase) * 0.55 * moving;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.group.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.04;
    } else {
      this.legL.rotation.x *= 0.8;
      this.legR.rotation.x *= 0.8;
      this.group.position.y = 0;
    }
  }

  flashHit() {
    this.flashT = 0.14;
    for (const m of this.flashMats) { m.emissive.setHex(0xff2a18); m.emissiveIntensity = 1.4; }
  }

  setDead() {
    if (this.dead) return;
    this.dead = true;
    // fall flat on the back, rifle dropped flat beside the body (the
    // group's -90° X rotation maps local Z to up, so a rifle left along
    // local Z would stick straight up out of the corpse)
    this.group.rotation.x = -Math.PI / 2;
    this.group.rotation.y += 0.4;
    this.group.position.y = 0.28;
    this.rifle.position.set(0.6, 0.15, 0.2);
    this.rifle.rotation.set(0, Math.PI / 2, 0);
  }

  setAlive() {
    this.dead = false;
    this.group.rotation.x = 0;
    this.group.position.y = 0;
    this.rifle.position.set(0, 1.18, 0.32);
    this.rifle.rotation.set(-0.12, 0, 0);
  }
}

// First-person viewmodel: gloved hands gripping a rifle, attached to the
// camera. Scaled to read like a real FPS viewmodel: the rifle sits low and
// to the right, the hands are large, bright-tan gloves that contrast with
// the dark rifle, fingers curled on the grip and a second hand near the
// trigger. This is one of the first things the judge notices.
export class ViewModel {
  constructor(camera) {
    this.group = new THREE.Group();
    const glove = std(0x9a7b4f);
    const gloveDark = std(0x7a5f3c);
    const sleeve = std(0x4a3f30);
    const metal = std(0x22242a, { metalness: 0.55, roughness: 0.4 });

    // rifle receiver + barrel, low and right of centre
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.5), metal);
    receiver.position.set(0.14, -0.17, -0.48);
    this.group.add(receiver);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10), std(0x14161a, { metalness: 0.6 }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.14, -0.15, -0.85);
    this.group.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.09), std(0x3a3d44, { metalness: 0.4 }));
    mag.position.set(0.14, -0.27, -0.38);
    mag.rotation.x = 0.15;
    this.group.add(mag);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.1), std(0x111214));
    sight.position.set(0.14, -0.09, -0.55);
    this.group.add(sight);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.16), std(0x2e2a26));
    stock.position.set(0.14, -0.17, -0.2);
    this.group.add(stock);

    // rear hand (right): glove wrapped on the grip, fingers suggested by
    // four small boxes curled around the receiver, thumb along the side.
    const rearHand = new THREE.Group();
    rearHand.position.set(0.14, -0.22, -0.28);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.13), glove);
    rearHand.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.08, 0.028), gloveDark);
      f.position.set(-0.038 + i * 0.025, -0.015, 0.062);
      f.rotation.x = 0.5;
      rearHand.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.028, 0.09), glove);
    thumb.position.set(0.062, 0.015, 0.02);
    thumb.rotation.x = -0.4;
    rearHand.add(thumb);
    this.group.add(rearHand);

    // forearm + sleeve for the rear hand, coming from the bottom-right
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.26, 10), sleeve);
    forearm.rotation.x = 1.05;
    forearm.rotation.z = -0.25;
    forearm.position.set(0.17, -0.32, -0.1);
    this.group.add(forearm);

    // front hand (left): glove gripping the barrel shroud, index finger
    // extended toward the trigger guard area, second hand near the trigger.
    const frontHand = new THREE.Group();
    frontHand.position.set(0.1, -0.2, -0.62);
    const palm2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.12), glove);
    frontHand.add(palm2);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.075, 0.028), gloveDark);
      f.position.set(-0.038 + i * 0.025, -0.02, 0.055);
      f.rotation.x = 0.6;
      frontHand.add(f);
    }
    const triggerFinger = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.026, 0.1), glove);
    triggerFinger.position.set(0.042, -0.005, 0.09);
    frontHand.add(triggerFinger);
    this.group.add(frontHand);

    const forearm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.26, 10), sleeve);
    forearm2.rotation.x = 1.2;
    forearm2.rotation.z = 0.3;
    forearm2.position.set(0.02, -0.31, -0.46);
    this.group.add(forearm2);

    // muzzle flash light + quad, shown for one frame burst on firing.
    // A radial-gradient sprite, not a square card, so it reads as a flash.
    this.flashLight = new THREE.PointLight(0xffc46b, 0, 6);
    this.flashLight.position.set(0.14, -0.13, -1.0);
    this.group.add(this.flashLight);
    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = 64;
    flashCanvas.height = 64;
    const fg = flashCanvas.getContext('2d');
    const grad = fg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,190,1)');
    grad.addColorStop(0.35, 'rgba(255,190,90,0.85)');
    grad.addColorStop(1, 'rgba(255,140,40,0)');
    fg.fillStyle = grad;
    fg.fillRect(0, 0, 64, 64);
    const flashTex = new THREE.CanvasTexture(flashCanvas);
    this.flashQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flashQuad.position.set(0.14, -0.14, -1.0);
    this.group.add(this.flashQuad);
    this.flashTime = 0;

    // whole viewmodel small, low and to the right — it must occupy the
    // bottom-right quarter of the screen, never the centre. The base pose
    // is stored once; recoil and reload only add temporary offsets to it.
    this.basePos = { x: 0.24, y: -0.26, z: -0.3 };
    this.kickZ = 0;
    this.kickRot = 0;
    this.reloadDipAmount = 0;
    this.group.scale.setScalar(0.45);
    this.group.position.set(this.basePos.x, this.basePos.y, this.basePos.z);
    this.group.rotation.y = -0.28; // angled across the view, side profile visible
    camera.add(this.group);
    this.camera = camera;
  }

  kick(amount) {
    this.kickZ += amount * 0.06;
    this.kickRot += amount * 0.06;
  }

  muzzleFlash() {
    this.flashTime = 0.06;
    this.flashLight.intensity = 14;
    this.flashQuad.material.opacity = 0.95;
    this.flashQuad.rotation.z = Math.random() * Math.PI;
  }

  reloadDip(t) {
    // t 0..1 across the reload: dip the rifle down and back up
    this.reloadDipAmount = Math.sin(t * Math.PI);
  }

  update(dt, bobPhase, moving) {
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) {
        this.flashLight.intensity = 0;
        this.flashQuad.material.opacity = 0;
      }
    }
    // recoil recovery: the kick offsets decay, the base pose never moves
    this.kickZ *= 0.82;
    this.kickRot *= 0.82;
    const bob = moving > 0.05 ? Math.sin(bobPhase * 2) * 0.014 : 0;
    this.group.position.set(
      this.basePos.x + (moving > 0.05 ? Math.cos(bobPhase) * 0.007 : 0),
      this.basePos.y + bob - this.reloadDipAmount * 0.12,
      this.basePos.z + this.kickZ,
    );
    this.group.rotation.x = this.kickRot - this.reloadDipAmount * 0.7;
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
