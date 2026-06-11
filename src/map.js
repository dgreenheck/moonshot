// Map view: true-scale Kerbin system, vessel orbit line, Ap/Pe markers,
// Mun orbit, predicted Mun-relative trajectory after SOI entry.

import * as THREE from 'three/webgpu';
import { BODIES, getBodyState } from './constants.js';
import { sampleOrbitPoints } from './orbits.js';

function textSprite(text, color = '#cfe3ff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '28px monospace';
  x.fillStyle = color;
  x.textAlign = 'left';
  x.shadowColor = '#000'; x.shadowBlur = 6;
  x.fillText(text, 8, 40);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, depthTest: false, transparent: true, sizeAttenuation: false,
  }));
  s.scale.set(0.22, 0.055, 1);
  s.center.set(0, 0.5);
  s.renderOrder = 20;
  return s;
}

function dotSprite(color, px = 0.02) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.beginPath(); x.arc(32, 32, 20, 0, Math.PI * 2); x.fill();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, sizeAttenuation: false,
  }));
  s.scale.set(px, px, 1);
  s.renderOrder = 19;
  return s;
}

function makeLine(color, opacity = 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 260), 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return line;
}

function setLine(line, pts, offset = null) {
  const attr = line.geometry.getAttribute('position');
  const n = Math.min(pts.length, attr.count);
  for (let i = 0; i < n; i++) {
    attr.setXYZ(i, pts[i].x + (offset?.x ?? 0), pts[i].y + (offset?.y ?? 0), pts[i].z + (offset?.z ?? 0));
  }
  attr.needsUpdate = true;
  line.geometry.setDrawRange(0, n);
}

export class MapView {
  constructor(planetTextures) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01020a);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1e4, 5e9);
    this.cam = { az: 0.6, el: 0.9, dist: 4.2e7 };
    this.visible = false;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 0.25, 0.45);
    this.scene.add(sun);

    this.kerbin = new THREE.Mesh(
      new THREE.SphereGeometry(BODIES.kerbin.radius, 48, 24),
      new THREE.MeshStandardNodeMaterial({ map: planetTextures.kerbin, roughness: 1 }),
    );
    this.mun = new THREE.Mesh(
      new THREE.SphereGeometry(BODIES.mun.radius, 32, 16),
      new THREE.MeshStandardNodeMaterial({ map: planetTextures.mun, roughness: 1 }),
    );
    this.scene.add(this.kerbin, this.mun);

    // Mun orbit circle
    const munOrbitPts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      munOrbitPts.push(new THREE.Vector3(
        Math.cos(a) * BODIES.mun.orbitRadius, 0, Math.sin(a) * BODIES.mun.orbitRadius));
    }
    const munLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(munOrbitPts),
      new THREE.LineBasicMaterial({ color: 0x666677, transparent: true, opacity: 0.7 }),
    );
    this.scene.add(munLine);

    this.orbitLine = makeLine(0x55b1ff);
    this.encLine = makeLine(0xffc14d, 0.95);
    this.scene.add(this.orbitLine, this.encLine);

    this.vesselDot = dotSprite('#7fd0ff', 0.016);
    this.apLabel = textSprite('Ap', '#8fd0ff');
    this.peLabel = textSprite('Pe', '#8fd0ff');
    this.munPeLabel = textSprite('Mun Pe', '#ffc14d');
    this.scene.add(this.vesselDot, this.apLabel, this.peLabel, this.munPeLabel);

    this.soi = new THREE.Mesh(
      new THREE.SphereGeometry(BODIES.mun.soi, 32, 16),
      new THREE.MeshBasicMaterial({
        color: 0x8888aa, wireframe: true, transparent: true, opacity: 0.08, depthWrite: false,
      }),
    );
    this.scene.add(this.soi);
  }

  /** Refresh orbital geometry (call ~1 Hz or after burns). */
  refresh(st, els, encounter) {
    const munPos = getBodyState('mun', st.t).pos;
    this.mun.position.copy(munPos);
    this.soi.position.copy(munPos);

    if (els) {
      const focus = st.body === 'mun' ? munPos : new THREE.Vector3();
      const maxR = st.body === 'mun' ? BODIES.mun.soi * 1.05 : BODIES.kerbin.soi;
      setLine(this.orbitLine, sampleOrbitPoints(els, 220, maxR), focus);
      this.orbitLine.material.color.set(st.body === 'mun' ? 0xc9a4ff : 0x55b1ff);

      // Ap/Pe markers
      const peP = els.phat.clone().multiplyScalar(els.rp).add(focus);
      this.peLabel.position.copy(peP);
      this.peLabel.visible = els.rp > 0;
      if (els.a > 0) {
        const apP = els.phat.clone().multiplyScalar(-els.ra).add(focus);
        this.apLabel.position.copy(apP);
        this.apLabel.visible = true;
      } else this.apLabel.visible = false;
    }

    if (encounter && st.body === 'kerbin') {
      const munAtEnc = getBodyState('mun', encounter.tEnter).pos;
      setLine(this.encLine, sampleOrbitPoints(encounter.relElements, 160, BODIES.mun.soi), munAtEnc);
      this.encLine.visible = true;
      this.munPeLabel.position.copy(
        encounter.relElements.phat.clone().multiplyScalar(encounter.relElements.rp).add(munAtEnc));
      this.munPeLabel.visible = true;
    } else {
      this.encLine.visible = false;
      this.munPeLabel.visible = false;
    }
  }

  /** Per-frame: vessel marker + camera. */
  update(st) {
    const munPos = getBodyState('mun', st.t).pos;
    const vPos = st.body === 'mun' ? st.pos.clone().add(munPos) : st.pos.clone();
    this.vesselDot.position.copy(vPos);

    const { az, el, dist } = this.cam;
    this.camera.position.set(
      Math.cos(az) * Math.sin(el) * dist,
      Math.cos(el) * dist,
      Math.sin(az) * Math.sin(el) * dist,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
  }

  drag(dx, dy) {
    this.cam.az += dx * 0.005;
    this.cam.el = THREE.MathUtils.clamp(this.cam.el + dy * 0.005, 0.05, Math.PI - 0.05);
  }

  zoom(f) {
    this.cam.dist = THREE.MathUtils.clamp(this.cam.dist * f, 2e6, 3e8);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
