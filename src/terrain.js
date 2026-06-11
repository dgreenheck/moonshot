// Procedural terrain: height functions (collision + meshes + textures all
// sample the same field), planet spheres with canvas textures, and a local
// high-res terrain patch that follows the vessel for landings.

import * as THREE from 'three/webgpu';
import { fbm3, valueNoise3 } from './noise.js';
import { BODIES, PAD_DIR, PAD_ALTITUDE } from './constants.js';

// ---------------------------------------------------------------------------
// Height fields (dir: unit vector from body centre; returns metres above datum)
// ---------------------------------------------------------------------------

/**
 * Height above datum. `detail=false` skips the metre-scale octaves — used for
 * the global planet texture (seen from orbit); collision and the local patch
 * always sample full detail.
 */
export function heightAt(bodyName, dir, detail = true) {
  if (bodyName === 'kerbin') return kerbinHeight(dir, detail);
  return munHeight(dir, detail);
}

// ridge transform: 0..1 with sharp crests where n crosses 0.5
const ridged = (n) => 1 - Math.abs(2 * n - 1);

function kerbinHeight(dir, detail) {
  const x = dir.x, y = dir.y, z = dir.z;
  // continents
  let h = (fbm3(x * 2.3, y * 2.3, z * 2.3, 5) - 0.5) * 2 * 3000;
  // ridged mountain belts, only rising out of solid land
  const belts = ridged(fbm3(x * 5.2 + 31.7, y * 5.2, z * 5.2, 4));
  h += Math.pow(belts, 3.2) * 2200 * smoother(60, 900, h);
  // rolling hills
  h += (fbm3(x * 16 + 7.1, y * 16, z * 16, 4) - 0.5) * 520;
  if (detail) {
    h += (fbm3(x * 60 + 3.3, y * 60, z * 60, 3) - 0.5) * 150;   // ~60 m bumps
    h += (fbm3(x * 230 + 11.9, y * 230, z * 230, 2) - 0.5) * 35; // ~16 m roughness
  }
  h = Math.max(0, h); // ocean clamps to sea level
  // flatten around the launch pad
  const padAngle = Math.acos(THREE.MathUtils.clamp(dir.dot(PAD_DIR), -1, 1));
  const w = smoother(0.0012, 0.006, padAngle);
  return PAD_ALTITUDE * (1 - w) + h * w;
}

/** Crater field at one scale: bowls with raised rims where a noise field peaks. */
function craterField(dir, freq, seed, depth) {
  const n = valueNoise3(dir.x * freq + seed, dir.y * freq + seed * 0.7, dir.z * freq);
  const bowl = smoother(0.74, 0.93, n);
  const rim = smoother(0.64, 0.74, n) * (1 - smoother(0.74, 0.84, n));
  return rim * depth * 0.35 - Math.pow(bowl, 1.5) * depth;
}

function munHeight(dir, detail) {
  const x = dir.x, y = dir.y, z = dir.z;
  // broad maria/highlands
  let h = (fbm3(x * 4.5, y * 4.5, z * 4.5, 5) - 0.5) * 2 * 850;
  // ridged highland ranges
  const range = ridged(fbm3(x * 8.5 + 50.2, y * 8.5, z * 8.5, 4));
  h += Math.pow(range, 2.6) * 950;
  // mid-scale roughness
  h += (fbm3(x * 26 + 9.4, y * 26, z * 26, 3) - 0.5) * 240;
  if (detail) {
    h += (fbm3(x * 85 + 4.8, y * 85, z * 85, 3) - 0.5) * 90;     // boulder-field scale
    h += (fbm3(x * 320 + 23.5, y * 320, z * 320, 2) - 0.5) * 22; // ~12 m rubble
  }
  // craters at three scales — big basins down to fresh small ones
  h += craterField(dir, 11, 50, 800);
  h += craterField(dir, 33, 17, 300);
  if (detail) h += craterField(dir, 96, 71, 110);
  return h;
}

function smoother(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Surface colours (used by both the global texture and the local patch)
// ---------------------------------------------------------------------------

function kerbinColor(h, dir, out) {
  const tint = valueNoise3(dir.x * 90 + 5, dir.y * 90, dir.z * 90) - 0.5;
  if (h <= 0.5) {
    const deep = fbm3(dir.x * 8 + 9, dir.y * 8, dir.z * 8, 2);
    out.setRGB(0.05 + deep * 0.03, 0.18 + deep * 0.06, 0.38 + deep * 0.1);
  } else if (h < 45) out.setRGB(0.76, 0.7, 0.5);                       // beach
  else if (h < 1100) out.setRGB(0.19 + h / 5200 + tint * 0.05, 0.4 + tint * 0.06, 0.17); // grass
  else if (h < 2400) out.setRGB(0.43 + tint * 0.05, 0.37 + tint * 0.04, 0.29);           // rock
  else out.setRGB(0.88, 0.9, 0.94);                                     // snow
  const lat = Math.abs(dir.y);
  if (lat > 0.86 && h > 0.5) out.setRGB(0.9, 0.92, 0.96);              // polar caps
  return out;
}

function munColor(h, dir, out) {
  const g = 0.3 + ((h + 1900) / 4000) * 0.32 +
    (valueNoise3(dir.x * 70, dir.y * 70, dir.z * 70) - 0.5) * 0.07;
  out.setRGB(g, g, g * 1.02);
  return out;
}

export function colorAt(bodyName, h, dir, out) {
  return bodyName === 'kerbin' ? kerbinColor(h, dir, out) : munColor(h, dir, out);
}

// ---------------------------------------------------------------------------
// Global planet texture (equirectangular canvas, generated once)
// ---------------------------------------------------------------------------

export function makePlanetTexture(bodyName, w = 1024, h = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const dir = new THREE.Vector3();
  const col = new THREE.Color();
  for (let y = 0; y < h; y++) {
    const phi = ((y + 0.5) / h) * Math.PI;        // 0 at +Y pole (three.js sphere UV)
    for (let x = 0; x < w; x++) {
      const theta = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      // match THREE.SphereGeometry UV convention: u wraps around -Z at u=0… close enough
      dir.set(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const ht = heightAt(bodyName, dir, false); // low-detail pass: orbit-view texture
      colorAt(bodyName, ht, dir, col);
      const i = (y * w + x) * 4;
      img.data[i] = col.r * 255; img.data[i + 1] = col.g * 255;
      img.data[i + 2] = col.b * 255; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// Local terrain patch — regenerated as the vessel moves; lives in the
// floating-origin world (positions are set relative to the render origin).
// ---------------------------------------------------------------------------

const PATCH_RES = 96;

export class TerrainPatch {
  constructor() {
    this.mesh = null;
    this.body = null;
    this.centerDir = new THREE.Vector3();
    this.size = 0;
    this.centerWorld = new THREE.Vector3(); // body-centred position of patch origin
  }

  /** Rebuild if needed. vesselPos is body-centred; alt is AGL-ish altitude. */
  update(bodyName, vesselPos, alt, scene) {
    if (alt > 90_000) { this.hide(); return; }
    const R = BODIES[bodyName].radius;
    const dir = vesselPos.clone().normalize();
    const wanted = THREE.MathUtils.clamp(alt * 6, 3000, 240_000);
    const moved = this.centerDir.distanceTo(dir) * R;
    if (this.mesh && this.body === bodyName &&
        Math.abs(wanted - this.size) / this.size < 0.5 && moved < this.size * 0.12) {
      this.mesh.visible = true;
      return;
    }
    this.build(bodyName, dir, wanted, scene);
  }

  build(bodyName, dir, size, scene) {
    if (this.mesh) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.body = bodyName;
    this.centerDir.copy(dir);
    this.size = size;

    const R = BODIES[bodyName].radius;
    // local ENU frame at the patch centre
    const up = dir.clone();
    const east = new THREE.Vector3(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-6) east.set(0, 0, 1);
    east.normalize();
    const north = up.clone().cross(east).normalize();

    const n = PATCH_RES;
    const verts = new Float32Array((n + 1) * (n + 1) * 3);
    const cols = new Float32Array((n + 1) * (n + 1) * 3);
    const idx = [];
    const p = new THREE.Vector3(), d = new THREE.Vector3(), col = new THREE.Color();

    const h0 = heightAt(bodyName, dir);
    this.centerWorld = dir.clone().multiplyScalar(R + h0);

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        // non-uniform grid: dense in the middle where the vessel is
        const fu = warp((i / n) * 2 - 1), fv = warp((j / n) * 2 - 1);
        const ex = fu * size / 2, nz = fv * size / 2;
        // point on sphere via tangent-plane projection
        d.copy(dir).multiplyScalar(R).addScaledVector(east, ex).addScaledVector(north, nz).normalize();
        const ht = heightAt(bodyName, d);
        p.copy(d).multiplyScalar(R + ht).sub(this.centerWorld);
        const k = (j * (n + 1) + i) * 3;
        verts[k] = p.x; verts[k + 1] = p.y; verts[k + 2] = p.z;
        colorAt(bodyName, ht, d, col);
        cols[k] = col.r; cols[k + 1] = col.g; cols[k + 2] = col.b;
      }
    }
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    if (!this.material) {
      this.material = new THREE.MeshStandardNodeMaterial({
        vertexColors: true, roughness: 0.95, metalness: 0,
      });
    }
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  hide() { if (this.mesh) this.mesh.visible = false; }

  /** Set render position given the floating origin (both body-centred coords). */
  place(origin) {
    if (!this.mesh || !this.mesh.visible) return;
    this.mesh.position.copy(this.centerWorld).sub(origin);
  }
}

function warp(x) { return Math.sign(x) * Math.pow(Math.abs(x), 1.6); }
