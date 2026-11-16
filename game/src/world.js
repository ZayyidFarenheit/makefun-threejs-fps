// Sunset desert relay station: the map. Bright, readable, original layout.
// Three lanes (west / mid / east), two bomb sites (A north-west, B north-east),
// attacker spawn south, defender spawn north. All geometry is procedural:
// no textures, models or network loads — canvas textures are drawn locally.
// Exports colliders (AABBs), a waypoint graph, spawn points and LOS helpers.

import * as THREE from 'three';
import { MAP } from './config.js';

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sandTexture() {
  const tex = makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#d9a066';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = Math.random() * 2.2 + 0.4;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(120,70,30,0.16)' : 'rgba(255,220,160,0.14)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // faint darker patches
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 18 + Math.random() * 30;
      g.fillStyle = 'rgba(140,85,40,0.08)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(11, 8);
  return tex;
}

function skyTexture() {
  const tex = makeCanvas(16, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#241536');
    grad.addColorStop(0.35, '#6b2d5c');
    grad.addColorStop(0.62, '#e85d3d');
    grad.addColorStop(0.8, '#ff9a4d');
    grad.addColorStop(1.0, '#ffd28a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  return tex;
}

function letterTexture(letter) {
  return makeCanvas(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(20,12,6,0.55)';
    g.beginPath();
    g.arc(128, 128, 118, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffb347';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(128, 128, 112, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffd28a';
    g.font = 'bold 150px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 128, 134);
  });
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // {minX,maxX,minZ,maxZ,height}
    this.waypoints = []; // {x,z}
    this.edges = []; // adjacency lists
    this.siteMarkers = {};
    this.dish = null;
    this.flags = [];
    this.build();
  }

  addCollider(minX, maxX, minZ, maxZ, height) {
    this.colliders.push({ minX, maxX, minZ, maxZ, height });
  }

  box(x, z, w, d, h, color, y = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = false;
    m.receiveShadow = false;
    this.scene.add(m);
    return m;
  }

  build() {
    const s = this.scene;
    // --- sky dome, sun, fog ---------------------------------------------
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
    );
    s.add(sky);
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(16, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }),
    );
    sun.position.set(-90, 26, -260);
    sun.lookAt(0, 10, 0);
    s.add(sun);
    s.fog = new THREE.Fog(0xe8935a, 70, 260);

    const hemi = new THREE.HemisphereLight(0xffd9a0, 0x8a5a33, 1.05);
    s.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xffc27a, 2.4);
    sunLight.position.set(-40, 38, -60);
    s.add(sunLight);
    const fill = new THREE.DirectionalLight(0x9db8ff, 0.5);
    fill.position.set(30, 20, 40);
    s.add(fill);

    // --- ground ----------------------------------------------------------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP.halfX * 2 + 120, MAP.halfZ * 2 + 120),
      new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false;
    s.add(ground);

    // --- perimeter walls --------------------------------------------------
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.95 });
    const mkWall = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, MAP.wallHeight, d), wallMat);
      m.position.set(x, MAP.wallHeight / 2, z);
      s.add(m);
      this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, MAP.wallHeight);
    };
    mkWall(0, -MAP.halfZ - 0.5, MAP.halfX * 2 + 2, 1);
    mkWall(0, MAP.halfZ + 0.5, MAP.halfX * 2 + 2, 1);
    mkWall(-MAP.halfX - 0.5, 0, 1, MAP.halfZ * 2 + 2);
    mkWall(MAP.halfX + 0.5, 0, 1, MAP.halfZ * 2 + 2);

    // --- interior lane walls ---------------------------------------------
    const innerMat = new THREE.MeshStandardMaterial({ color: 0xc99a68, roughness: 0.95 });
    const inner = (x, z, w, d, h = 3) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), innerMat);
      m.position.set(x, h / 2, z);
      s.add(m);
      this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h);
    };
    inner(-12, 0, 4, 16); // west lane divider
    inner(12, 0, 4, 16); // east lane divider
    inner(-8, -10, 4, 4); // north connector left
    inner(8, -10, 4, 4); // north connector right
    inner(-16, 14, 4, 4); // south cover left
    inner(16, 14, 4, 4); // south cover right

    // --- crates -----------------------------------------------------------
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6b3f, roughness: 0.9 });
    const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x6e7d5a, roughness: 0.9 });
    const crate = (x, z, size = 1.2, stacked = false, mat = crateMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
      m.position.set(x, size / 2, z);
      s.add(m);
      if (stacked) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(size * 0.9, size * 0.9, size * 0.9), mat);
        top.position.set(x, size + size * 0.45, z);
        top.rotation.y = 0.4;
        s.add(top);
      }
      this.addCollider(x - size / 2, x + size / 2, z - size / 2, z + size / 2, stacked ? size * 2 : size);
    };
    crate(-2, 4, 1.2, true);
    crate(3, -2, 1.2);
    crate(-4, -6, 1.2);
    crate(5, 8, 1.2, false, crateMat2);
    crate(-25, -13, 1.2, true); // west edge of site A: keeps the approach lane clear
    crate(-24, -19, 1.2);
    crate(-17, -19, 1.2, false, crateMat2);
    crate(25, -13, 1.2, true); // east edge of site B, mirrored
    crate(24, -19, 1.2);
    crate(17, -19, 1.2, false, crateMat2);
    crate(-26, 2, 1.2);
    crate(-26, 10, 1.2, false, crateMat2);
    crate(26, 2, 1.2);
    crate(26, 10, 1.2, false, crateMat2);
    crate(-14, 16, 1.2);
    crate(14, 16, 1.2);

    // --- shipping containers ----------------------------------------------
    const cont = (x, z, w, d, color) => {
      const m = this.box(x, z, w, d, 2.6, color);
      m.position.y = 1.3;
      this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 2.6);
    };
    cont(-26, -8, 6, 2.6, 0x3f6d8e);
    cont(26, -8, 6, 2.6, 0xb3543a);
    cont(-6, -13, 4, 2.4, 0x7a5a8e);
    cont(6, -13, 4, 2.4, 0x4a7a5a);

    // --- relay dish tower (centre-north landmark) --------------------------
    const tower = this.box(0, -21, 2.4, 2.4, 7, 0x5a5f6a);
    tower.position.y = 3.5;
    this.addCollider(-1.2, 1.2, -22.2, -19.8, 7);
    const dishGroup = new THREE.Group();
    dishGroup.position.set(0, 7.6, -21);
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(3.4, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.38),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }),
    );
    dish.rotation.x = -0.55; // concave face tilts up toward the sky, north
    dishGroup.add(dish);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(3.32, 0.09, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.5, metalness: 0.5 }),
    );
    rim.rotation.x = -0.55 + Math.PI / 2 - 0.62;
    rim.position.set(0, 1.15, -1.0);
    dishGroup.add(rim);
    const feed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x44484f }),
    );
    feed.rotation.x = Math.PI * 0.72 - Math.PI / 2;
    feed.position.set(0, 1.1, 1.4);
    dishGroup.add(feed);
    s.add(dishGroup);
    this.dish = dishGroup;

    // --- solar panel rows ---------------------------------------------------
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d3a5f, roughness: 0.35, metalness: 0.55 });
    const panelRow = (cx, cz) => {
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.6), panelMat);
        p.position.set(cx - 2.8 + i * 2.8, 1.5, cz);
        p.rotation.x = -0.5;
        s.add(p);
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 1.5, 0.14),
          new THREE.MeshStandardMaterial({ color: 0x555a60 }),
        );
        leg.position.set(cx - 2.8 + i * 2.8, 0.75, cz + 0.3);
        s.add(leg);
      }
      this.addCollider(cx - 4.2, cx + 4.2, cz - 0.9, cz + 0.9, 1.6);
    };
    panelRow(-14, 18.5);
    panelRow(14, 18.5);

    // --- sandbag lines (low cover, 1 m) --------------------------------------
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xc2a878, roughness: 1 });
    const sandbags = (x, z, w) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.8), sandMat);
      m.position.set(x, 0.5, z);
      s.add(m);
      this.addCollider(x - w / 2, x + w / 2, z - 0.4, z + 0.4, 1.0);
    };
    sandbags(-27, -16, 4); // west edge of site A: keeps the approach lane clear
    sandbags(27, -16, 4); // east edge of site B, mirrored
    sandbags(0, 6, 4);

    // --- barrels -------------------------------------------------------------
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9a4a2e, roughness: 0.7, metalness: 0.3 });
    const barrel = (x, z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12), barrelMat);
      m.position.set(x, 0.55, z);
      s.add(m);
      this.addCollider(x - 0.45, x + 0.45, z - 0.45, z + 0.45, 1.1);
    };
    barrel(-8, 2);
    barrel(8, -4);
    barrel(-28, -14);
    barrel(28, -14);
    barrel(10, 18);

    // --- antenna masts with waving flags --------------------------------------
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xff9f1c, side: THREE.DoubleSide });
    const mast = (x, z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 8), mastMat);
      m.position.set(x, 3, z);
      s.add(m);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), flagMat);
      flag.position.set(x + 0.85, 5.5, z);
      s.add(flag);
      this.flags.push(flag);
      this.addCollider(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 6);
    };
    mast(-30, -22);
    mast(30, -22);
    mast(-30, 22);
    mast(30, 22);

    // --- bomb sites: glowing ring + letter billboard ---------------------------
    const site = (def) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(MAP.siteRadius - 0.35, MAP.siteRadius, 40),
        new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(def.x, 0.06, def.z);
      s.add(ring);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(MAP.siteRadius - 0.4, 32),
        new THREE.MeshBasicMaterial({ color: 0xff9f1c, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(def.x, 0.05, def.z);
      s.add(disc);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 3.4),
        new THREE.MeshBasicMaterial({ map: letterTexture(def.label), transparent: true, side: THREE.DoubleSide }),
      );
      board.position.set(def.x, 3.6, def.z);
      s.add(board);
      // light pole at each site, on the north side so it never blocks the
      // approach lane from the south
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 4.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a3f46 }),
      );
      pole.position.set(def.x + 4.6, 2.2, def.z - 3.4);
      s.add(pole);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd28a }),
      );
      lamp.position.set(def.x + 4.6, 4.5, def.z - 3.4);
      s.add(lamp);
      this.siteMarkers[def.label] = { ring, disc, board, x: def.x, z: def.z };
    };
    site(MAP.siteA);
    site(MAP.siteB);

    // --- spawn markers: coloured ground discs ----------------------------------
    const spawnDisc = (x, z, color) => {
      const d = new THREE.Mesh(
        new THREE.CircleGeometry(2.2, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28 }),
      );
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.04, z);
      s.add(d);
    };
    spawnDisc(0, 20, 0xff9f1c);
    spawnDisc(0, -20, 0x19c3d6);

    this.buildWaypoints();
  }

  buildWaypoints() {
    const pts = [
      [-6, 20], [0, 20], [6, 20], // attacker spawn
      [-2, 14], [2, 14], [0, 8], [0, 2], [0, -4], [0, -10], // mid
      [-14, 16], [-20, 12], [-26, 6], [-26, -2], [-24, -8], [-22, -12], [-22, -16], // west to A
      [14, 16], [20, 12], [26, 6], [26, -2], [24, -8], [22, -12], [22, -16], // east to B
      [-6, -20], [0, -20], [6, -20], // defender spawn
      [-16, -14], [16, -14], [0, -8], [-10, -18], [10, -18], // defender holds
      [-10, 6], [10, 6], // mid flanks
    ];
    this.waypoints = pts.map(([x, z]) => ({ x, z }));
    const n = this.waypoints.length;
    this.edges = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.waypoints[i], b = this.waypoints[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < 13.5 && this.pathClear(a.x, a.z, b.x, b.z, 0.7)) {
          this.edges[i].push(j);
          this.edges[j].push(i);
        }
      }
    }
  }

  // Is the straight segment (with clearance) free of colliders? 2D, XZ plane.
  pathClear(x0, z0, x1, z1, clearance) {
    for (const c of this.colliders) {
      if (c.height < 0.4) continue;
      if (this.segmentHitsBox(x0, z0, x1, z1, c.minX - clearance, c.maxX + clearance, c.minZ - clearance, c.maxZ + clearance)) return false;
    }
    return true;
  }

  segmentHitsBox(x0, z0, x1, z1, minX, maxX, minZ, maxZ) {
    // Liang-Barsky clip of the segment against the box.
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dz = z1 - z0;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, x0 - minX) && clip(dx, maxX - x0) && clip(-dz, z0 - minZ) && clip(dz, maxZ - z0);
  }

  // Line of sight between two eye points: blocked if the segment passes
  // through a collider below its top at the crossing point.
  losBlocked(x0, y0, z0, x1, y1, z1) {
    for (const c of this.colliders) {
      // 2D segment vs box, with entry parameter.
      let t0 = 0, t1 = 1;
      const dx = x1 - x0, dz = z1 - z0;
      let ok = true;
      const clip = (p, q) => {
        if (!ok) return;
        if (p === 0) { if (q < 0) ok = false; return; }
        const r = q / p;
        if (p < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; }
        else { if (r < t0) ok = false; else if (r < t1) t1 = r; }
      };
      clip(-dx, x0 - c.minX); clip(dx, c.maxX - x0);
      clip(-dz, z0 - c.minZ); clip(dz, c.maxZ - z0);
      if (!ok || t0 > t1) continue;
      const yAt = y0 + (y1 - y0) * Math.max(0, t0);
      if (yAt < c.height) return true;
    }
    return false;
  }

  // Ray vs colliders + ground. Returns {dist, x, y, z} of nearest hit, or null.
  rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    if (dy < 0) {
      const t = -oy / dy;
      if (t > 0 && t < maxDist) best = { dist: t, x: ox + dx * t, y: 0, z: oz + dz * t };
    }
    for (const c of this.colliders) {
      let tmin = 0, tmax = maxDist;
      let ok = true;
      const slab = (o, d, lo, hi) => {
        if (!ok) return;
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) ok = false; return; }
        let ta = (lo - o) / d, tb = (hi - o) / d;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > tmin) tmin = ta;
        if (tb < tmax) tmax = tb;
        if (tmin > tmax) ok = false;
      };
      slab(ox, dx, c.minX, c.maxX);
      slab(oz, dz, c.minZ, c.maxZ);
      slab(oy, dy, 0, c.height);
      if (ok && tmin > 0.001 && tmin < (best ? best.dist : maxDist)) {
        best = { dist: tmin, x: ox + dx * tmin, y: oy + dy * tmin, z: oz + dz * tmin };
      }
    }
    return best;
  }

  // Circle (radius r) vs colliders: push (x,z) out of every overlapped box.
  resolveCircle(pos, r) {
    for (const c of this.colliders) {
      if (c.height < 0.3) continue;
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = pos.x - c.minX, pr = c.maxX - pos.x;
        const pt = pos.z - c.minZ, pb = c.maxZ - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.minX - r;
        else if (m === pr) pos.x = c.maxX + r;
        else if (m === pt) pos.z = c.minZ - r;
        else pos.z = c.maxZ + r;
      }
    }
    pos.x = Math.max(-MAP.halfX + 0.5, Math.min(MAP.halfX - 0.5, pos.x));
    pos.z = Math.max(-MAP.halfZ + 0.5, Math.min(MAP.halfZ - 0.5, pos.z));
  }

  nearestWaypoint(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.waypoints.length; i++) {
      const w = this.waypoints[i];
      const d = (w.x - x) ** 2 + (w.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // BFS shortest path of waypoint indices from a to b.
  findPath(a, b) {
    if (a === b) return [a];
    const prev = new Array(this.waypoints.length).fill(-1);
    const q = [a];
    prev[a] = a;
    while (q.length) {
      const cur = q.shift();
      for (const nb of this.edges[cur]) {
        if (prev[nb] !== -1) continue;
        prev[nb] = cur;
        if (nb === b) {
          const path = [b];
          let p = b;
          while (p !== a) { p = prev[p]; path.push(p); }
          return path.reverse();
        }
        q.push(nb);
      }
    }
    return [a, b];
  }

  update(dt, t) {
    if (this.dish) this.dish.rotation.y = Math.sin(t * 0.12) * 0.25;
    for (let i = 0; i < this.flags.length; i++) {
      this.flags[i].rotation.y = Math.sin(t * 2.2 + i * 1.7) * 0.22;
    }
  }
}
