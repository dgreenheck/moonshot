// Builds the 3D representation of a vessel from its part list.
// Shared by the VAB preview and the flight scene.
// Group origin: stack bottom (y=0), +Y up the stack.

import * as THREE from 'three/webgpu';
import { stackGeometry, partY } from './vessel.js';

const MATS = {};
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!MATS[key]) {
    MATS[key] = new THREE.MeshStandardNodeMaterial({
      color, roughness: opts.rough ?? 0.55, metalness: opts.metal ?? 0.25, ...opts.extra,
    });
  }
  return MATS[key];
}

const WHITE = 0xdfe3e8, GRAY = 0x8d959e, DARK = 0x3a3f46, ORANGE = 0xc96a2a,
  YELLOW = 0xd6b13c, REDDISH = 0x9e4a3a, BLUE = 0x5f87b0;

function cyl(rTop, rBot, h, color, seg = 24) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat(color));
}

/** Build one part's mesh subtree, centred at origin. */
export function buildPartMesh(p) {
  const d = p.def;
  const r = d.size / 2, L = d.length;
  const g = new THREE.Group();

  switch (d.shape) {
    case 'pod': {
      const body = cyl(r * 0.45, r, L, WHITE);
      g.add(body);
      const window = cyl(r * 0.46, r * 0.46, L * 0.18, DARK);
      window.position.y = L * 0.18;
      g.add(window);
      break;
    }
    case 'tank': {
      g.add(cyl(r, r, L, WHITE));
      const band = cyl(r * 1.01, r * 1.01, L * 0.16, ORANGE);
      g.add(band);
      const cap1 = cyl(r * 0.97, r * 1.0, L * 0.07, GRAY); cap1.position.y = L * 0.465; g.add(cap1);
      const cap2 = cyl(r * 1.0, r * 0.97, L * 0.07, GRAY); cap2.position.y = -L * 0.465; g.add(cap2);
      break;
    }
    case 'engine': {
      const mount = cyl(r * 0.9, r * 0.7, L * 0.4, GRAY); mount.position.y = L * 0.3; g.add(mount);
      const nozzle = cyl(r * 0.25, r * 0.78, L * 0.62, DARK); nozzle.position.y = -L * 0.16; g.add(nozzle);
      break;
    }
    case 'srb': {
      g.add(cyl(r, r, L * 0.92, 0xcfd4cf));
      const nose = cyl(0.02, r, L * 0.1, REDDISH); nose.position.y = L * 0.48; g.add(nose);
      const noz = cyl(r * 0.3, r * 0.55, L * 0.1, DARK); noz.position.y = -L * 0.48; g.add(noz);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, L * 0.5, 24, 1, true), mat(REDDISH));
      stripe.position.y = L * 0.1;
      g.add(stripe);
      break;
    }
    case 'decoupler': {
      g.add(cyl(r, r, L, DARK));
      const band = cyl(r * 1.02, r * 1.02, L * 0.4, YELLOW); g.add(band);
      break;
    }
    case 'adapter': {
      g.add(cyl(0.625, r, L, WHITE));
      break;
    }
    case 'nose': {
      g.add(new THREE.Mesh(new THREE.ConeGeometry(r, L, 24), mat(GRAY)));
      break;
    }
    case 'fins': {
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, L, 0.55), mat(REDDISH));
        const a = (i / 4) * Math.PI * 2;
        fin.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
        fin.rotation.y = -a;
        g.add(fin);
      }
      break;
    }
    case 'chute': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(ORANGE));
      dome.position.y = -L * 0.2; g.add(dome);
      const base = cyl(r * 0.6, r * 0.7, L * 0.5, GRAY); base.position.y = -L * 0.25; g.add(base);
      // deployed canopy, hidden until used
      const canopy = new THREE.Group();
      const c = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), mat(ORANGE, { extra: { side: THREE.DoubleSide } }));
      c.position.y = 9;
      canopy.add(c);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x999999 });
      const lpts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        lpts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 3.4, 9.6, Math.sin(a) * 3.4));
      }
      canopy.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lpts), lineMat));
      canopy.visible = false;
      canopy.name = 'canopy';
      g.add(canopy);
      break;
    }
    case 'legs': {
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Group();
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, L, 0.09), mat(GRAY));
        strut.position.y = -L / 2;
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), mat(DARK));
        foot.position.y = -L;
        leg.add(strut, foot);
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        leg.position.set(Math.cos(a) * 0.62, L * 0.4, Math.sin(a) * 0.62);
        leg.userData.axis = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        leg.userData.stowAngle = 1.25;     // folded against the hull
        leg.userData.deployAngle = -0.32;  // splayed out
        leg.name = `leg${i}`;
        g.add(leg);
      }
      break;
    }
    case 'shield': {
      const disc = cyl(r * 1.05, r * 0.92, L, 0x6b5340);
      g.add(disc);
      break;
    }
    default:
      g.add(cyl(r, r, L, GRAY));
  }
  return g;
}

/**
 * Build the whole vessel. Returns { group, meshByKey, plumeAnchors }.
 * plumeAnchors: [{ key, y, radius, count, hostRadius }] engine nozzle exits.
 */
export function buildVesselGroup(parts) {
  const geom = stackGeometry(parts);
  const group = new THREE.Group();
  const meshByKey = new Map();
  const plumeAnchors = [];

  for (const p of parts) {
    if (!p.alive) continue;
    const mesh = buildPartMesh(p);
    const y = partY(geom, p);

    if (p.kind === 'stack') {
      mesh.position.y = y;
      group.add(mesh);
      meshByKey.set(p.key, mesh);
      if (p.def.engine) {
        plumeAnchors.push({
          key: p.key, positions: [new THREE.Vector3(0, y - p.def.length / 2, 0)],
          radius: p.def.size * 0.33,
        });
      }
    } else {
      // radial attachments
      const host = parts.find((q) => q.kind === 'stack' && q.stackIndex === p.stackIndex && q.alive);
      const hostR = host ? host.def.size / 2 : 0.625;
      const wrap = new THREE.Group();
      const positions = [];
      if (p.def.fins || p.def.legs) {
        // these parts are full ×4 sets that radiate from the stack axis
        mesh.position.y = y;
        mesh.scale.setScalar(1 + (hostR - 0.625) * 0.6);
        wrap.add(mesh);
      } else {
        for (let i = 0; i < p.sym; i++) {
          const a = (i / p.sym) * Math.PI * 2;
          const inst = i === 0 ? mesh : buildPartMesh(p);
          const offset = hostR + p.def.size / 2;
          inst.position.set(Math.cos(a) * offset, y, Math.sin(a) * offset);
          wrap.add(inst);
          if (p.def.engine) {
            positions.push(new THREE.Vector3(Math.cos(a) * offset, y - p.def.length / 2, Math.sin(a) * offset));
          }
        }
      }
      group.add(wrap);
      meshByKey.set(p.key, wrap);
      if (p.def.engine) plumeAnchors.push({ key: p.key, positions, radius: p.def.size * 0.3 });
    }
  }
  group.userData.geom = geom;
  return { group, meshByKey, plumeAnchors };
}

/** Animate landing legs on a built vessel. t: 0 stowed, 1 deployed. */
export function setLegs(meshByKey, parts, deployed) {
  for (const p of parts) {
    if (!p.def.legs) continue;
    const wrap = meshByKey.get(p.key);
    if (!wrap) continue;
    wrap.traverse((o) => {
      if (o.name?.startsWith('leg') && o.userData.axis) {
        const ang = deployed ? o.userData.deployAngle : o.userData.stowAngle;
        o.setRotationFromAxisAngle(o.userData.axis, ang);
      }
    });
  }
}

/** Show/hide deployed parachute canopies. */
export function setCanopies(meshByKey, parts) {
  for (const p of parts) {
    if (!p.def.chute) continue;
    const m = meshByKey.get(p.key);
    if (!m) continue;
    m.traverse((o) => { if (o.name === 'canopy') o.visible = p.chuteState === 'deployed'; });
  }
}
