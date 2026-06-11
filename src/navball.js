// The navball: its own little WebGPU renderer + scene, fed the ship attitude
// and local ENU frame every frame.

import * as THREE from 'three/webgpu';

function makeBallTexture() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');

  // sky / ground
  const sky = x.createLinearGradient(0, 0, 0, h / 2);
  sky.addColorStop(0, '#5fa8e8'); sky.addColorStop(1, '#2b6fc4');
  x.fillStyle = sky; x.fillRect(0, 0, w, h / 2);
  const gnd = x.createLinearGradient(0, h / 2, 0, h);
  gnd.addColorStop(0, '#a8702f'); gnd.addColorStop(1, '#5e3c14');
  x.fillStyle = gnd; x.fillRect(0, h / 2, w, h / 2);

  // pitch lines every 15 deg
  x.strokeStyle = 'rgba(255,255,255,0.75)';
  x.fillStyle = 'rgba(255,255,255,0.9)';
  x.font = '22px monospace';
  x.textAlign = 'center';
  for (let pitch = -75; pitch <= 75; pitch += 15) {
    if (pitch === 0) continue;
    const y = h / 2 - (pitch / 180) * h;
    x.lineWidth = 2;
    for (let k = 0; k < 8; k++) {
      const cx = (k + 0.5) * (w / 8);
      x.beginPath(); x.moveTo(cx - 28, y); x.lineTo(cx + 28, y); x.stroke();
      x.fillText(String(Math.abs(pitch)), cx, y - 6);
    }
  }
  // horizon
  x.lineWidth = 5; x.strokeStyle = '#ffffff';
  x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();

  // heading meridians every 45 deg + cardinal labels
  x.lineWidth = 1.5; x.strokeStyle = 'rgba(255,255,255,0.45)';
  const labels = ['N', '45', 'E', '135', 'S', '225', 'W', '315'];
  x.font = 'bold 30px monospace';
  for (let i = 0; i < 8; i++) {
    const cx = (i / 8) * w;
    x.beginPath(); x.moveTo(cx, 0); x.lineTo(cx, h); x.stroke();
    x.fillText(labels[i], cx === 0 ? 14 : cx, h / 2 - 16);
    x.fillText(labels[i], cx === 0 ? 14 : cx, h / 2 + 38);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function markerSprite(draw, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 10;
  return s;
}

const drawPrograde = (x) => {
  x.strokeStyle = '#ffd84d'; x.lineWidth = 5;
  x.beginPath(); x.arc(32, 32, 13, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.moveTo(32, 4); x.lineTo(32, 14); x.stroke();
  x.beginPath(); x.moveTo(4, 32); x.lineTo(19, 32); x.moveTo(45, 32); x.lineTo(60, 32); x.stroke();
  x.fillStyle = '#ffd84d'; x.beginPath(); x.arc(32, 32, 4, 0, Math.PI * 2); x.fill();
};
const drawRetrograde = (x) => {
  x.strokeStyle = '#ffd84d'; x.lineWidth = 5;
  x.beginPath(); x.arc(32, 32, 13, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.moveTo(22, 22); x.lineTo(42, 42); x.moveTo(42, 22); x.lineTo(22, 42); x.stroke();
  x.beginPath(); x.moveTo(32, 4); x.lineTo(32, 14); x.moveTo(4, 32); x.lineTo(14, 32);
  x.moveTo(50, 32); x.lineTo(60, 32); x.stroke();
};
const drawCrosshair = (x) => {
  x.strokeStyle = '#ff9e2c'; x.lineWidth = 6; x.lineCap = 'round';
  x.beginPath();
  x.moveTo(8, 32); x.lineTo(24, 32); x.lineTo(32, 44); x.lineTo(40, 32); x.lineTo(56, 32);
  x.stroke();
  x.fillStyle = '#ff9e2c'; x.beginPath(); x.arc(32, 36, 3.5, 0, Math.PI * 2); x.fill();
};

export class Navball {
  constructor(container) {
    this.container = container;
    this.ready = false;
  }

  async init() {
    const size = 190;
    this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
    this.renderer.setSize(size, size);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.container.appendChild(this.renderer.domElement);
    await this.renderer.init();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 10);
    this.camera.position.set(0, 0, 3.3);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshStandardNodeMaterial({ map: makeBallTexture(), roughness: 0.7, metalness: 0 }),
    );
    this.ball = ball;
    this.scene.add(ball);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.5, 1, 2);
    this.scene.add(key);

    // bezel ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.04, 0.05, 12, 48),
      new THREE.MeshStandardNodeMaterial({ color: 0x1a2233, roughness: 0.4, metalness: 0.6 }),
    );
    this.scene.add(ring);

    this.progradeM = markerSprite(drawPrograde, 0.34);
    this.retroM = markerSprite(drawRetrograde, 0.34);
    this.scene.add(this.progradeM, this.retroM);

    const cross = markerSprite(drawCrosshair, 0.4);
    cross.position.set(0, 0, 1.18);
    this.scene.add(cross);

    this.ready = true;
    this._E = new THREE.Matrix3();
    this._B = new THREE.Quaternion();
  }

  /**
   * up: radial-out unit vector (world); quat: ship attitude; vel: world velocity.
   */
  update(up, quat, vel) {
    if (!this.ready) return;

    // ENU basis: x=east, y=up(zenith), z=north
    const east = new THREE.Vector3(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-8) east.set(0, 0, -1);
    east.normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();

    const toENU = (w, out) => out.set(w.dot(east), w.dot(up), w.dot(north));

    const noseW = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const dorsalW = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const n = toENU(noseW, new THREE.Vector3());
    const d = toENU(dorsalW, new THREE.Vector3());
    // B: rotation with rows [(d x n), d, n] maps painted dirs to view space
    const r = new THREE.Vector3().crossVectors(d, n);
    const m = new THREE.Matrix4().set(
      r.x, r.y, r.z, 0,
      d.x, d.y, d.z, 0,
      n.x, n.y, n.z, 0,
      0, 0, 0, 1,
    );
    this._B.setFromRotationMatrix(m);
    this.ball.quaternion.copy(this._B);

    // velocity markers
    const sp = vel.length();
    if (sp > 2) {
      const vENU = toENU(vel.clone().divideScalar(sp), new THREE.Vector3());
      const pPos = vENU.clone().applyQuaternion(this._B).multiplyScalar(1.06);
      const rPos = pPos.clone().negate();
      this.progradeM.position.copy(pPos);
      this.retroM.position.copy(rPos);
      this.progradeM.visible = pPos.z > 0.1;
      this.retroM.visible = rPos.z > 0.1;
    } else {
      this.progradeM.visible = this.retroM.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
  }

  setVisible(v) {
    if (this.renderer) this.renderer.domElement.style.display = v ? 'block' : 'none';
  }
}
