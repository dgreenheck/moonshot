// MOONSHOT — entry point. Owns the WebGPU renderer and the VAB <-> flight
// mode switch.

import * as THREE from 'three/webgpu';
import { VAB } from './vab.js';
import { Flight } from './flight.js';

const app = document.getElementById('app');

async function boot() {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  app.prepend(renderer.domElement);
  await renderer.init();

  // ---- VAB preview scene ----
  const vabScene = new THREE.Scene();
  vabScene.background = new THREE.Color(0x0a0f1a);
  const vabCam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
  vabScene.add(new THREE.AmbientLight(0xaaccff, 0.7));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
  key.position.set(4, 6, 5);
  vabScene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
  rim.position.set(-5, 2, -4);
  vabScene.add(rim);
  // floor grid
  const grid = new THREE.GridHelper(60, 30, 0x2c4569, 0x16243a);
  vabScene.add(grid);

  let mode = 'vab';
  let vabFocusH = 8;
  let vabAngle = 0.6;
  let vabDrag = false;

  const flight = new Flight({
    renderer,
    onRevert: () => {
      mode = 'vab';
      vab.show();
    },
  });
  await flight.init();

  const vab = new VAB({
    scene: vabScene,
    camera: vabCam,
    frame: (h) => { vabFocusH = Math.max(6, h); },
    onLaunch: (design) => {
      vab.hide();
      mode = 'flight';
      flight.sound.ensure(); // user gesture: unlock audio
      flight.start(design);
    },
  });
  vab.show();

  // VAB camera drag
  addEventListener('pointerdown', (e) => {
    if (mode === 'vab' && e.target === renderer.domElement) vabDrag = true;
  });
  addEventListener('pointerup', () => { vabDrag = false; });
  addEventListener('pointermove', (e) => {
    if (mode === 'vab' && vabDrag) vabAngle += e.movementX * 0.006;
  });

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    vabCam.aspect = innerWidth / innerHeight;
    vabCam.updateProjectionMatrix();
    flight.resize(innerWidth, innerHeight);
  });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    if (mode === 'vab') {
      const r = Math.max(10, vabFocusH * 1.7);
      vabCam.position.set(
        Math.cos(vabAngle) * r,
        vabFocusH * 0.55,
        Math.sin(vabAngle) * r,
      );
      vabCam.lookAt(0, vabFocusH * 0.45, 0);
      renderer.setClearColor(0x0a0f1a);
      renderer.render(vabScene, vabCam);
    } else {
      flight.frame(dt);
    }
  });
}

boot().catch((err) => {
  console.error(err);
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#ff8d7e;font-family:monospace;padding:40px;text-align:center;';
  const h2 = document.createElement('h2');
  h2.textContent = 'Failed to start';
  const p1 = document.createElement('p');
  p1.textContent = String(err?.message || err);
  const p2 = document.createElement('p');
  p2.style.color = '#7e93b0';
  p2.textContent = 'MOONSHOT needs WebGPU (Chrome/Edge 113+, Safari 26+) or WebGL2 fallback.';
  const inner = document.createElement('div');
  inner.append(h2, p1, p2);
  div.appendChild(inner);
  document.body.appendChild(div);
});
