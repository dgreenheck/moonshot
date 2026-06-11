// TSL-driven visual effects: engine plumes, atmosphere rim, sun, starfield,
// reentry plasma, explosions.

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, uniform, time, mix, smoothstep, clamp,
  positionLocal, positionWorld, normalWorld, cameraPosition, uv, fract, sin, dot,
} from 'three/tsl';

// cheap animated noise
const noise1 = (p, speed) =>
  fract(sin(dot(p.add(time.mul(speed)), vec3(12.9898, 78.233, 45.543))).mul(43758.5453));

// ---------------------------------------------------------------------------
// Engine plume: cone that lengthens with throttle and balloons in vacuum
// ---------------------------------------------------------------------------

export function makePlume(radius) {
  const throttleU = uniform(0);
  const vacU = uniform(0); // 0 = sea level, 1 = vacuum

  const geo = new THREE.CylinderGeometry(radius * 0.45, radius, 1, 16, 8, true);
  geo.translate(0, -0.5, 0); // origin at nozzle, extends down -Y

  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // t: 0 at nozzle, 1 at tip
  const t = positionLocal.y.negate();
  // vacuum plumes balloon outward
  m.positionNode = positionLocal.add(
    vec3(positionLocal.x, 0, positionLocal.z).mul(vacU.mul(1.6).mul(t)),
  );
  const flicker = noise1(positionLocal.mul(6), 9).mul(0.25).add(0.85);
  const core = smoothstep(1.0, 0.0, t);
  m.colorNode = mix(
    vec3(1.0, 0.62, 0.18),               // sea-level orange
    vec3(0.45, 0.62, 1.0),               // vacuum blue
    vacU,
  ).mul(core.mul(2.2).add(0.35)).mul(flicker);
  m.opacityNode = core.pow(1.4).mul(throttleU).mul(flicker).mul(0.85);

  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, throttleU, vacU };
}

/** Per-frame plume update. len in metres. */
export function updatePlume(plume, throttle, vac, len) {
  plume.throttleU.value = throttle;
  plume.vacU.value = vac;
  plume.mesh.scale.set(1, Math.max(0.01, len), 1);
  plume.mesh.visible = throttle > 0.005;
}

// ---------------------------------------------------------------------------
// Atmosphere rim (fresnel shell around Kerbin)
// ---------------------------------------------------------------------------

/**
 * Atmosphere shell. Glow is driven by the view ray's impact parameter
 * (closest approach to the planet centre): exponential falloff with grazing
 * height, forced to zero before the shell's geometric silhouette — no hard
 * edge. centerU must track the planet's render-space position each frame.
 */
export function makeAtmosphere(radius, sunDirU, centerU) {
  const shellR = radius * 1.055;
  const geo = new THREE.SphereGeometry(shellR, 64, 32);
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
  });

  const rayDir = positionWorld.sub(cameraPosition).normalize();
  const toCenter = centerU.sub(cameraPosition);
  const along = dot(toCenter, rayDir);
  const closest = toCenter.sub(rayDir.mul(along));
  // grazing height of the sight line, 0 at the planet surface, 1 at shell top
  const x = closest.length().sub(radius).div(shellR - radius).clamp(-0.35, 1.0);
  const limb = x.mul(-3.2).exp()                       // exponential density falloff
    .mul(smoothstep(1.0, 0.55, x))                     // reach zero before the silhouette
    .min(1.6);
  // suppress the glow at the centre of the disk (only the limb scatters at us)
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1.0).sub(normalWorld.dot(viewDir).abs().pow(1.6));
  const sunlight = normalWorld.dot(sunDirU).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(0.9, 0.45, 0.16), vec3(0.38, 0.64, 1.0), sunlight.pow(0.6));
  m.opacityNode = limb.mul(rim).mul(smoothstep(0.0, 0.45, sunlight).mul(0.8).add(0.05)).mul(0.65);

  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 2;
  return mesh;
}

// ---------------------------------------------------------------------------
// Sun sprite + directional light
// ---------------------------------------------------------------------------

export function makeSun() {
  const m = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const d = uv().sub(vec2(0.5)).length().mul(2);
  const core = smoothstep(0.5, 0.0, d);
  const halo = smoothstep(1.0, 0.15, d).pow(2.5);
  m.colorNode = vec3(1.0, 0.93, 0.78).mul(core.mul(3).add(halo.mul(0.7)));
  m.opacityNode = core.add(halo).clamp(0, 1);
  const sprite = new THREE.Sprite(m);
  sprite.renderOrder = 1;
  return sprite;
}

// ---------------------------------------------------------------------------
// Starfield
// ---------------------------------------------------------------------------

export function makeStars(count = 2500) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(1);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsNodeMaterial({
    transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false,
  });
  const fadeU = uniform(1);
  m.colorNode = vec3(0.9, 0.92, 1.0);
  m.opacityNode = fadeU;
  m.sizeNode = float(1.6);
  const pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  pts.renderOrder = 0;
  return { points: pts, fadeU };
}

// ---------------------------------------------------------------------------
// Reentry plasma: glowing shell that wraps the windward side
// ---------------------------------------------------------------------------

export function makePlasma() {
  const intensityU = uniform(0);
  // Shock wake: narrow tip punching into the airstream just ahead of the
  // craft, flaring open behind it. Apex along -Z; flight aligns +Z to
  // -velocity, so the apex faces windward.
  const geo = new THREE.ConeGeometry(4.2, 16, 20, 6, true);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 6);
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const t = positionLocal.z.add(2).div(16); // 0 at windward tip, 1 at tail
  const streaks = noise1(positionLocal.mul(vec3(8, 8, 0.7)), 14).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(1.0, 0.92, 0.65), vec3(1.0, 0.38, 0.08), clamp(t, 0, 1)).mul(2.2);
  m.opacityNode = smoothstep(1.05, 0.0, t).mul(streaks).mul(intensityU).mul(0.75);
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return { mesh, intensityU };
}

// ---------------------------------------------------------------------------
// Explosions: CPU-animated additive sprites
// ---------------------------------------------------------------------------

function makeFireballMaterial() {
  const m = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const d = uv().sub(vec2(0.5)).length().mul(2);
  m.colorNode = mix(vec3(1.0, 0.9, 0.55), vec3(1.0, 0.35, 0.08), d.clamp(0, 1)).mul(2.5);
  m.opacityNode = smoothstep(1.0, 0.1, d);
  return m;
}
let fireballMat = null;

export class ExplosionPool {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    fireballMat ??= makeFireballMaterial();
  }

  /** localPos: render-space position. size in metres. */
  spawn(localPos, size = 8) {
    const group = new THREE.Group();
    const sprites = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(fireballMat);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(size * (0.4 + Math.random()));
      s.position.copy(v.clone().multiplyScalar(0.15));
      s.scale.setScalar(size * (0.4 + Math.random() * 0.7));
      s.userData.vel = v;
      sprites.push(s);
      group.add(s);
    }
    group.position.copy(localPos);
    this.scene.add(group);
    this.active.push({ group, sprites, life: 0, dur: 1.4 });
  }

  update(dt) {
    for (const e of this.active) {
      e.life += dt;
      const f = e.life / e.dur;
      for (const s of e.sprites) {
        s.position.addScaledVector(s.userData.vel, dt * (1 - f * 0.7));
        s.scale.multiplyScalar(1 + dt * 1.2);
        s.material.opacity = 1; // material-level opacity stays; fade via removal
      }
      e.group.visible = f < 1;
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].life >= this.active[i].dur) {
        this.scene.remove(this.active[i].group);
        this.active.splice(i, 1);
      }
    }
  }
}
