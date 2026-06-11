// Flight director: owns the flight scene, state, time warp, staging,
// camera, HUD wiring, map view, debris, milestones.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  BODIES, getBodyState, PAD_DIR, PAD_ALTITUDE, fmtDist,
} from './constants.js';
import { density, pressureAtm } from './aero.js';
import {
  elementsFromState, propagate, timeToApoapsis, timeToPeriapsis,
  findMunEncounter, munTransferPhase,
} from './orbits.js';
import { physicsStep, checkSOI, stepDebris } from './physics.js';
import { buildVesselParts, buildStagePlan, stackGeometry, computeSections, massProps, partY } from './vessel.js';
import { buildVesselGroup, buildPartMesh, setLegs, setCanopies } from './vesselviz.js';
import { TerrainPatch, makePlanetTexture, heightAt } from './terrain.js';
import {
  makePlume, updatePlume, makeAtmosphere, makeSun, makeStars, makePlasma, ExplosionPool,
} from './effects.js';
import { HUD } from './hud.js';
import { MapView } from './map.js';
import { Navball } from './navball.js';
import { SoundFX } from './sound.js';

const WARP_LEVELS = [1, 2, 3, 4, 10, 100, 1000, 10000, 100000];
const PHYS_DT = 0.02;
const SUNDIR = new THREE.Vector3(1, 0.25, 0.45).normalize();
const $ = (id) => document.getElementById(id);

export class Flight {
  constructor({ renderer, onRevert }) {
    this.renderer = renderer;
    this.onRevert = onRevert;
    this.active = false;
    this.sound = new SoundFX();
  }

  async init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 4e9);
    this.camCtl = { az: 0.5, el: 0.25, dist: 28 };

    this.scene.add(new THREE.AmbientLight(0x445566, 0.5));
    this.sunLight = new THREE.DirectionalLight(0xfff3e0, 2.8);
    this.sunLight.position.copy(SUNDIR);
    this.scene.add(this.sunLight);

    this.planetTex = {
      kerbin: makePlanetTexture('kerbin', 1024, 512),
      mun: makePlanetTexture('mun', 1024, 512),
    };

    this.kerbinMesh = new THREE.Mesh(
      // slightly under datum so the local terrain patch always wins up close
      new THREE.SphereGeometry(BODIES.kerbin.radius - 400, 128, 64),
      new THREE.MeshStandardNodeMaterial({ map: this.planetTex.kerbin, roughness: 0.9 }),
    );
    this.munMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BODIES.mun.radius - 250, 96, 48),
      new THREE.MeshStandardNodeMaterial({ map: this.planetTex.mun, roughness: 1 }),
    );
    this.scene.add(this.kerbinMesh, this.munMesh);

    this.sunDirU = uniform(SUNDIR.clone());
    this.atmoCenterU = uniform(new THREE.Vector3());
    this.atmoMesh = makeAtmosphere(BODIES.kerbin.radius, this.sunDirU, this.atmoCenterU);
    this.scene.add(this.atmoMesh);

    this.sunSprite = makeSun();
    this.scene.add(this.sunSprite);
    const stars = makeStars();
    this.stars = stars.points;
    this.starsFade = stars.fadeU;
    this.stars.scale.setScalar(2e9);
    this.scene.add(this.stars);

    // launch pad
    this.pad = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 16, 0.5, 8),
      new THREE.MeshStandardNodeMaterial({ color: 0x55585e, roughness: 0.9 }),
    );
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 26, 1.2),
      new THREE.MeshStandardNodeMaterial({ color: 0x8a2e2e, roughness: 0.8 }),
    );
    tower.position.set(8, 13, 0);
    this.pad.add(slab, tower);
    this.pad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), PAD_DIR);
    this.scene.add(this.pad);

    this.patch = new TerrainPatch();
    this.boom = new ExplosionPool(this.scene);
    this.plasma = makePlasma();
    this.scene.add(this.plasma.mesh);

    this.map = new MapView(this.planetTex);
    this.navball = new Navball($('navball-slot'));
    await this.navball.init();

    this.bindUI();
    this.bindInput();
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  start(design) {
    this.design = design;
    this.cleanupVessel();
    this.debris?.forEach((d) => this.scene.remove(d.group));
    this.debris = [];
    HUD.hideEndcard();

    const parts = buildVesselParts(design);
    const geom = stackGeometry(parts);
    const mp = massProps(parts, geom);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), PAD_DIR);

    this.st = {
      t: 0, met: 0, body: 'kerbin',
      pos: PAD_DIR.clone().multiplyScalar(BODIES.kerbin.radius + PAD_ALTITUDE + 0.7 + mp.comY),
      vel: new THREE.Vector3(),
      quat, angVel: new THREE.Vector3(),
      throttle: 0, landed: true, dead: false,
      parts, geom, sections: computeSections(parts), massProps: mp,
      controls: { pitch: 0, yaw: 0, roll: 0 },
      sas: true, sasMode: 'hold', sasTarget: quat.clone(),
      elements: null,
    };
    this.plan = buildStagePlan(parts);
    this.stageIndex = 0;
    this.flags = { liftoff: false, space: false, orbit: false, munSoi: false, munLanded: false };
    this.warpIdx = 0;
    this.rails = false;
    this.mapOpen = false;
    this.legsDeployed = false;
    this.lastInfo = null;
    this.encounter = null;
    this.encTimer = 0;
    this.hudTimer = 0;
    this.camCtl.dist = Math.max(20, this.st.geom.totalLength * 2.2);

    this.refreshViz();
    this.active = true;
    $('flight-ui').classList.remove('hidden');
    HUD.msg(`${design.name} on the pad. SPACE to ignite. H for controls.`);
    HUD.setSituation('PRELAUNCH — KERBIN');
    HUD.stages(this.plan, 0, this.st.parts, this.st.sections);
  }

  stop() {
    this.active = false;
    this.cleanupVessel();
    this.debris?.forEach((d) => this.scene.remove(d.group));
    this.debris = [];
    $('flight-ui').classList.add('hidden');
  }

  cleanupVessel() {
    if (this.vGroup) { this.scene.remove(this.vGroup); this.vGroup = null; }
  }

  refreshViz() {
    this.cleanupVessel();
    const { group, meshByKey, plumeAnchors } = buildVesselGroup(this.st.parts);
    this.vGroup = group;
    this.meshByKey = meshByKey;
    this.plumes = [];
    for (const anchor of plumeAnchors) {
      for (const pos of anchor.positions) {
        const plume = makePlume(anchor.radius);
        plume.mesh.position.copy(pos);
        group.add(plume.mesh);
        this.plumes.push({ ...plume, key: anchor.key });
      }
    }
    setLegs(meshByKey, this.st.parts, this.legsDeployed);
    setCanopies(meshByKey, this.st.parts);
    this.scene.add(group);
  }

  // -------------------------------------------------------------------------
  // input + UI
  // -------------------------------------------------------------------------

  bindUI() {
    $('btn-revert').onclick = () => { this.stop(); this.onRevert(); };
    $('btn-end-revert').onclick = () => { this.stop(); this.onRevert(); };
    $('btn-end-relaunch').onclick = () => this.start(this.design);
    $('btn-map').onclick = () => this.toggleMap();
    $('btn-help').onclick = () => HUD.toggleHelp();
    $('btn-help-close').onclick = () => HUD.toggleHelp(false);
    $('btn-warp-up').onclick = () => this.setWarp(this.warpIdx + 1);
    $('btn-warp-down').onclick = () => this.setWarp(this.warpIdx - 1);
  }

  bindInput() {
    this.keys = {};
    addEventListener('keydown', (e) => {
      if (!this.active || e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.stage(); break;
        case 'KeyT': this.st.sas = !this.st.sas; this.st.sasTarget.copy(this.st.quat); break;
        case 'Digit1': this.st.sasMode = 'hold'; this.st.sasTarget.copy(this.st.quat); break;
        case 'Digit2': this.st.sasMode = 'prograde'; break;
        case 'Digit3': this.st.sasMode = 'retrograde'; break;
        case 'KeyZ': this.setThrottle(1); break;
        case 'KeyX': this.setThrottle(0); break;
        case 'KeyG':
          this.legsDeployed = !this.legsDeployed;
          for (const p of this.st.parts) if (p.def.legs) p.legsDown = this.legsDeployed;
          setLegs(this.meshByKey, this.st.parts, this.legsDeployed);
          HUD.msg(`Landing legs ${this.legsDeployed ? 'deployed' : 'stowed'}`);
          break;
        case 'KeyP':
          for (const p of this.st.parts) {
            if (p.alive && p.def.chute && p.chuteState === 'stowed') p.chuteState = 'armed';
          }
          HUD.msg('Parachutes armed');
          break;
        case 'KeyM': this.toggleMap(); break;
        case 'KeyH': HUD.toggleHelp(); break;
        case 'Comma': this.setWarp(this.warpIdx - 1); break;
        case 'Period': this.setWarp(this.warpIdx + 1); break;
      }
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    const dom = this.renderer.domElement;
    let dragging = false, lx = 0, ly = 0;
    dom.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    addEventListener('pointerup', () => { dragging = false; });
    addEventListener('pointermove', (e) => {
      if (!dragging || !this.active) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (this.mapOpen) this.map.drag(dx, dy);
      else {
        this.camCtl.az += dx * 0.006;
        this.camCtl.el = THREE.MathUtils.clamp(this.camCtl.el + dy * 0.006, -1.35, 1.35);
      }
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.active) return;
      const f = Math.pow(1.0015, e.deltaY);
      if (this.mapOpen) this.map.zoom(f);
      else this.camCtl.dist = THREE.MathUtils.clamp(this.camCtl.dist * f, 6, 2500);
    }, { passive: true });
  }

  setThrottle(v) {
    this.st.throttle = THREE.MathUtils.clamp(v, 0, 1);
    if (this.rails && v > 0) { this.setWarp(0); HUD.msg('Dropped out of warp: throttle input', 'warn'); }
  }

  handleHeldKeys(dt) {
    const st = this.st;
    if (this.keys.ShiftLeft || this.keys.ShiftRight) this.setThrottle(st.throttle + dt * 0.6);
    if (this.keys.ControlLeft || this.keys.ControlRight) this.setThrottle(st.throttle - dt * 0.6);
    st.controls.pitch = (this.keys.KeyW ? -1 : 0) + (this.keys.KeyS ? 1 : 0);
    st.controls.yaw = (this.keys.KeyA ? -1 : 0) + (this.keys.KeyD ? 1 : 0);
    st.controls.roll = (this.keys.KeyQ ? -1 : 0) + (this.keys.KeyE ? 1 : 0);
  }

  toggleMap() {
    this.mapOpen = !this.mapOpen;
    if (this.mapOpen) this.refreshMapNow();
    this.navball.setVisible(!this.mapOpen);
  }

  // -------------------------------------------------------------------------
  // time warp
  // -------------------------------------------------------------------------

  enginesLit() {
    return this.st.throttle > 0.001 &&
      this.st.parts.some((p) => p.alive && p.ignited && p.def.engine && !p.def.engine.srb) ||
      this.st.parts.some((p) => p.alive && p.ignited && p.def.engine?.srb && p.fuel > 0);
  }

  setWarp(idx) {
    idx = THREE.MathUtils.clamp(idx, 0, WARP_LEVELS.length - 1);
    const st = this.st;
    if (idx > 3) {
      const inAtmo = st.body === 'kerbin' &&
        st.pos.length() - BODIES.kerbin.radius < BODIES.kerbin.atmoHeight + 2000;
      if (!st.landed && (inAtmo || this.enginesLit())) {
        HUD.msg('Rails warp needs engines off and clear of the atmosphere', 'warn');
        idx = Math.min(idx, 3);
      }
    }
    this.warpIdx = idx;
    const goRails = idx > 3;
    if (goRails && !this.rails && !st.landed) {
      st.elements = elementsFromState(st.pos, st.vel, BODIES[st.body].mu, st.t);
    }
    this.rails = goRails;
    HUD.setWarp(WARP_LEVELS[idx], this.rails);
  }

  // -------------------------------------------------------------------------
  // staging
  // -------------------------------------------------------------------------

  stage() {
    if (this.st.dead) return;
    this.sound.ensure();
    if (this.stageIndex >= this.plan.length) { HUD.msg('No more stages', 'warn'); return; }
    if (this.rails) { this.setWarp(0); }
    const ev = this.plan[this.stageIndex++];
    const st = this.st;

    const structuralChange = ev.decouple !== null || ev.dropRadials.length > 0;
    if (ev.decouple !== null) this.jettisonStack(ev.decouple);
    if (ev.dropRadials.length) this.jettisonRadials(ev.dropRadials);

    for (const key of ev.ignite) {
      const p = st.parts.find((q) => q.key === key);
      if (p?.alive) p.ignited = true;
    }
    if (ev.ignite.length) {
      if (st.landed && st.throttle === 0) this.setThrottle(1);
      HUD.msg(ev.decouple !== null ? 'Stage separation — ignition!' : 'Ignition!');
    }
    if (ev.chutes) {
      for (const p of st.parts) {
        if (p.alive && p.def.chute && p.chuteState === 'stowed') p.chuteState = 'armed';
      }
      HUD.msg('Parachutes armed');
    }
    this.sound.stage();
    st.geom = stackGeometry(st.parts);
    st.sections = computeSections(st.parts);
    if (structuralChange) this.refreshViz(); // rebuild meshes without the jettisoned parts
    HUD.stages(this.plan, this.stageIndex, st.parts, st.sections);
  }

  nose() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.st.quat); }

  /** World position (render space, origin = vessel CoM) of a vessel-local point. */
  localToRender(local) {
    return local.clone().sub(new THREE.Vector3(0, this.st.massProps.comY, 0)).applyQuaternion(this.st.quat);
  }

  jettisonStack(idx) {
    const st = this.st;
    const removed = st.parts.filter((p) => p.stackIndex >= idx);
    if (!removed.length) return;
    st.parts = st.parts.filter((p) => p.stackIndex < idx);

    const sub = buildVesselGroup(removed);
    const len = sub.group.userData.geom.totalLength;
    const nose = this.nose();
    // removed chunk was the bottom of the stack: its centre sits len/2 above the old bottom
    const centerLocalY = len / 2;
    const d = {
      body: st.body,
      pos: st.pos.clone().addScaledVector(nose, centerLocalY - st.massProps.comY),
      vel: st.vel.clone().addScaledVector(nose, -2.5),
      mass: removed.reduce((s, p) => s + p.def.mass * p.sym + p.fuel, 0),
      cda: 2, spin: 0, dead: false,
      group: sub.group, quat: st.quat.clone(),
      axis: new THREE.Vector3().randomDirection(),
      comOffset: centerLocalY,
    };
    this.scene.add(d.group);
    this.debris.push(d);
    this.trimDebris();
  }

  jettisonRadials(keys) {
    const st = this.st;
    const nose = this.nose();
    for (const key of keys) {
      const p = st.parts.find((q) => q.key === key);
      if (!p) continue;
      st.parts = st.parts.filter((q) => q !== p);
      const host = st.parts.find((q) => q.kind === 'stack' && q.stackIndex === p.stackIndex);
      const hostR = host ? host.def.size / 2 : 0.625;
      const y = partY(st.geom, p);
      for (let i = 0; i < p.sym; i++) {
        const a = (i / p.sym) * Math.PI * 2;
        const offset = hostR + p.def.size / 2;
        const local = new THREE.Vector3(Math.cos(a) * offset, y, Math.sin(a) * offset);
        const outDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(st.quat);
        const single = { ...p, sym: 1 };
        const mesh = buildPartMesh(single);
        const d = {
          body: st.body,
          pos: st.pos.clone().add(this.localToRender(local)),
          vel: st.vel.clone().addScaledVector(outDir, 7).addScaledVector(nose, -1),
          mass: p.def.mass + p.fuel / p.sym,
          cda: 0.8, spin: 0, dead: false,
          group: mesh, quat: st.quat.clone(),
          axis: outDir.clone(),
          comOffset: 0,
        };
        this.scene.add(d.group);
        this.debris.push(d);
      }
    }
    this.trimDebris();
  }

  trimDebris() {
    while (this.debris.length > 14) {
      const d = this.debris.shift();
      this.scene.remove(d.group);
    }
  }

  // -------------------------------------------------------------------------
  // per-frame
  // -------------------------------------------------------------------------

  frame(dt) {
    if (!this.active) return;
    dt = Math.min(dt, 0.1);
    this.handleHeldKeys(dt);
    const st = this.st;

    if (!st.dead) {
      if (this.rails) this.railsStep(dt);
      else this.physStep(dt);
    }

    this.updateScene(dt);
    this.hudTick(dt);

    if (this.mapOpen) {
      this.map.update(st);
      this.renderer.render(this.map.scene, this.map.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
      const up = st.pos.clone().normalize();
      this.navball.update(up, st.quat, st.vel);
    }
  }

  physStep(dt) {
    const st = this.st;
    const warp = WARP_LEVELS[this.warpIdx];
    const total = dt * warp;
    const n = Math.min(80, Math.ceil(total / PHYS_DT));
    const h = total / n;
    const events = [];
    for (let i = 0; i < n; i++) {
      this.lastInfo = physicsStep(st, h, events);
      st.t += h;
      if (this.flags.liftoff) st.met += h;
      for (const d of this.debris) if (!d.dead && d.body === st.body) stepDebris(d, h);
      if (st.dead) break;
    }
    this.debris = this.debris.filter((d) => {
      if (d.dead) this.scene.remove(d.group);
      return !d.dead;
    });
    this.processEvents(events);
    this.milestones();
  }

  railsStep(dt) {
    const st = this.st;
    const warp = WARP_LEVELS[this.warpIdx];
    st.t += dt * warp;
    if (this.flags.liftoff) st.met += dt * warp;
    if (!st.landed && st.elements) {
      const { pos, vel } = propagate(st.elements, st.t);
      st.pos.copy(pos); st.vel.copy(vel);
      const events = [];
      checkSOI(st, events);
      if (events.length) {
        st.elements = elementsFromState(st.pos, st.vel, BODIES[st.body].mu, st.t);
        this.processEvents(events);
      }
      const alt = st.pos.length() - BODIES[st.body].radius;
      if (st.body === 'kerbin' && alt < BODIES.kerbin.atmoHeight + 1000) {
        this.setWarp(0);
        HUD.msg('Atmosphere ahead — dropping out of warp', 'warn');
      }
      this.lastInfo = {
        alt, agl: alt, speed: st.vel.length(), accelG: 0, maxTempFrac: 0,
        thrust: 0, perEngine: new Map(), rho: 0, press: 0, qDyn: 0, flux: 0, plasma: 0,
        terrainH: 0,
      };
      // gentle cooldown on rails
      for (const p of st.parts) p.temp = Math.max(4, p.temp - 5 * dt * Math.min(warp, 100));
    }
    this.milestones();
  }

  processEvents(events) {
    const st = this.st;
    for (const ev of events) {
      switch (ev.type) {
        case 'liftoff':
          if (!this.flags.liftoff) {
            this.flags.liftoff = true;
            HUD.banner('LIFTOFF!');
            HUD.msg('Liftoff!');
          }
          break;
        case 'landed': {
          const where = BODIES[st.body].name;
          if (st.body === 'mun' && !this.flags.munLanded) {
            this.flags.munLanded = true;
            HUD.banner('🌕 YOU LANDED ON THE MUN!', 6000);
            HUD.msg(`Touchdown at ${ev.speed.toFixed(1)} m/s. Flag-planting optional.`);
          } else if (st.body === 'kerbin' && this.flags.liftoff) {
            const verb = ev.water ? 'Splashdown' : 'Touchdown';
            HUD.msg(`${verb} at ${ev.speed.toFixed(1)} m/s`);
            if (this.flags.munLanded) {
              HUD.banner('🏆 MUN ROUND TRIP COMPLETE');
              HUD.endcard('MISSION COMPLETE', `${verb} on Kerbin after a successful Mun landing.<br>The space program is very proud.`, true);
            } else if (this.flags.space || this.flags.orbit) {
              HUD.endcard('SAFE RECOVERY', `${verb} on ${where}. Crew recovered.`, true);
            }
          } else {
            HUD.msg(`Landed at ${ev.speed.toFixed(1)} m/s`);
          }
          break;
        }
        case 'crashed': {
          st.dead = true;
          this.sound.explosion();
          this.boom.spawn(new THREE.Vector3(0, 0, 0), 14);
          if (this.vGroup) this.vGroup.visible = false;
          HUD.endcard('RAPID UNSCHEDULED DISASSEMBLY',
            `Impact at ${ev.speed.toFixed(0)} m/s on ${BODIES[st.body].name}.<br>` +
            (ev.speed < 20 ? 'So close — landing legs and less speed next time.' : 'The crater is impressive, at least.'));
          break;
        }
        case 'overheat': {
          this.sound.explosion();
          const mesh = this.meshByKey?.get(ev.part.key);
          if (mesh) {
            mesh.visible = false;
            this.boom.spawn(mesh.getWorldPosition(new THREE.Vector3()).sub(this.vGroupWorldShift()), 5);
          }
          HUD.msg(`${ev.part.def.name} destroyed by overheating!`, 'bad');
          if (ev.part.def.pod) {
            st.dead = true;
            HUD.endcard('BURNED UP ON REENTRY',
              'The pod overheated. Try a shallower reentry (periapsis 30–45 km), keep the heat shield pointed retrograde.');
          }
          break;
        }
        case 'chute':
          this.sound.chute();
          HUD.msg('Parachute deployed!');
          setCanopies(this.meshByKey, st.parts);
          break;
        case 'chute-torn':
          HUD.msg('Parachute torn off — too fast!', 'bad');
          this.sound.warn();
          setCanopies(this.meshByKey, st.parts);
          break;
        case 'soi':
          if (ev.body === 'mun') {
            this.flags.munSoi = true;
            HUD.banner('ENTERING MUN SPHERE OF INFLUENCE');
          } else {
            HUD.msg('Back in Kerbin space');
          }
          this.encounter = null;
          if (this.mapOpen) this.refreshMapNow();
          break;
      }
    }
  }

  vGroupWorldShift() { return new THREE.Vector3(); } // explosions are near origin anyway

  milestones() {
    const st = this.st;
    const alt = st.pos.length() - BODIES[st.body].radius;
    if (!this.flags.space && st.body === 'kerbin' && alt > BODIES.kerbin.atmoHeight) {
      this.flags.space = true;
      HUD.banner('SPACE REACHED — 70 km');
    }
    if (!this.flags.orbit && st.body === 'kerbin' && this.curEls) {
      const els = this.curEls;
      if (els.a > 0 && els.rp > BODIES.kerbin.radius + BODIES.kerbin.atmoHeight) {
        this.flags.orbit = true;
        HUD.banner('STABLE ORBIT ACHIEVED');
      }
    }
  }

  // -------------------------------------------------------------------------
  // rendering
  // -------------------------------------------------------------------------

  updateScene(dt) {
    const st = this.st;
    const origin = st.pos;
    const munPos = getBodyState('mun', st.t).pos;
    const kc = st.body === 'kerbin' ? new THREE.Vector3() : munPos.clone().negate();
    const mc = st.body === 'kerbin' ? munPos.clone() : new THREE.Vector3();

    this.kerbinMesh.position.copy(kc).sub(origin);
    this.atmoMesh.position.copy(this.kerbinMesh.position);
    this.atmoCenterU.value.copy(this.atmoMesh.position);
    this.munMesh.position.copy(mc).sub(origin);

    const padPos = PAD_DIR.clone().multiplyScalar(BODIES.kerbin.radius + PAD_ALTITUDE + 0.25).add(kc).sub(origin);
    this.pad.position.copy(padPos);
    this.pad.visible = padPos.length() < 2.5e5;

    // vessel
    if (this.vGroup && !st.dead) {
      const mp = st.massProps ?? massProps(st.parts, st.geom);
      this.vGroup.quaternion.copy(st.quat);
      this.vGroup.position.copy(new THREE.Vector3(0, mp.comY, 0).applyQuaternion(st.quat).negate());
    }

    // terrain patch
    const alt = st.pos.length() - BODIES[st.body].radius;
    this.patch.update(st.body, st.pos, this.lastInfo?.agl ?? alt, this.scene);
    this.patch.place(origin);

    // camera (ENU orbit around vessel)
    const up = st.pos.clone().normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-8) east.set(0, 0, -1);
    east.normalize();
    const north = up.clone().cross(east).normalize();
    const { az, el, dist } = this.camCtl;
    const offset = east.clone().multiplyScalar(Math.cos(el) * Math.cos(az))
      .addScaledVector(north, Math.cos(el) * Math.sin(az))
      .addScaledVector(up, Math.sin(el))
      .multiplyScalar(dist);
    this.camera.position.copy(offset);
    this.camera.up.copy(up);
    this.camera.lookAt(0, 0, 0);

    // sky, stars, sun
    const rho = density(st.body, alt);
    let skyF = Math.min(1, Math.pow(rho / 1.225, 0.4));
    skyF *= THREE.MathUtils.clamp(up.dot(SUNDIR) + 0.35, 0, 1);
    const sky = new THREE.Color(0x020308).lerp(new THREE.Color(0x77b4e8), skyF);
    this.renderer.setClearColor(sky);
    this.starsFade.value = 1 - skyF;
    this.stars.position.copy(this.camera.position);
    this.sunSprite.position.copy(this.camera.position).addScaledVector(SUNDIR, 2e6);
    this.sunSprite.scale.setScalar(1.4e5);

    // plumes
    const press = this.lastInfo?.press ?? 0;
    for (const plume of this.plumes ?? []) {
      const f = this.lastInfo?.perEngine?.get(plume.key) ?? 0;
      const part = st.parts.find((p) => p.key === plume.key);
      const full = part ? (part.def.engine.throttleable ? st.throttle : 1) : 0;
      const lit = f > 0 ? Math.max(0.25, full) : 0;
      updatePlume(plume, lit, 1 - Math.min(1, press), (3 + (1 - press) * 5) * (part?.def.size ?? 1) * 1.6);
    }

    // plasma
    const plasmaI = this.lastInfo?.plasma ?? 0;
    this.plasma.intensityU.value = plasmaI;
    this.plasma.mesh.visible = plasmaI > 0.03;
    if (this.plasma.mesh.visible && st.vel.lengthSq() > 1) {
      const back = st.vel.clone().normalize().negate();
      this.plasma.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), back);
    }

    // debris
    for (const d of this.debris) {
      let rel;
      if (d.body === st.body) rel = d.pos.clone().sub(origin);
      else if (d.body === 'kerbin' && st.body === 'mun') rel = d.pos.clone().sub(munPos).sub(origin);
      else rel = d.pos.clone().add(munPos).sub(origin);
      d.group.position.copy(rel).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(d.quat), -d.comOffset);
      d.group.quaternion.copy(d.quat);
      d.group.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(d.axis, d.spin * 0.6));
      d.group.visible = rel.length() < 3e5;
    }

    this.boom.update(dt);

    // sound
    this.sound.setEngine(
      (this.lastInfo?.thrust ?? 0) > 1 ? Math.max(0.3, st.throttle) : 0,
      Math.min(1, press * 2 + 0.15),
    );
    this.sound.setWind(this.lastInfo?.qDyn ?? 0);
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  hudTick(dt) {
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.12;
    const st = this.st;
    const info = this.lastInfo;
    if (!info) return;

    HUD.setMET(st.met);
    HUD.setThrottle(st.throttle);
    HUD.setSAS(st.sas, st.sasMode);
    HUD.setWarp(WARP_LEVELS[this.warpIdx], this.rails);

    const up = st.pos.clone().normalize();
    const vspeed = st.vel.dot(up);
    HUD.readouts(info, st, vspeed);

    // situation line
    const bodyName = BODIES[st.body].name.toUpperCase();
    let sit = 'FLYING';
    if (st.dead) sit = 'DESTROYED';
    else if (st.landed) sit = this.flags.liftoff ? 'LANDED' : 'PRELAUNCH';
    else if (info.alt > (BODIES[st.body].atmoHeight || 4000) && this.curEls) {
      const atmoTop = BODIES[st.body].radius + (BODIES[st.body].atmoHeight || 0);
      if (this.curEls.a <= 0) sit = 'ESCAPING';
      else if (this.curEls.rp > atmoTop) sit = 'ORBITING';
      else sit = 'SUB-ORBITAL';
    }
    HUD.setSituation(`${sit} — ${bodyName}`);

    // orbital elements (recompute when not on rails)
    if (!st.landed) {
      this.curEls = this.rails && st.elements
        ? st.elements
        : elementsFromState(st.pos, st.vel, BODIES[st.body].mu, st.t);
    } else this.curEls = null;

    // encounter search + map refresh, ~1 Hz
    this.encTimer -= dt + 0.12;
    if (this.encTimer <= 0) {
      this.encTimer = 1;
      if (this.curEls && st.body === 'kerbin' && this.curEls.a > 0 &&
          this.curEls.ra > BODIES.mun.orbitRadius - BODIES.mun.soi &&
          !st.landed) {
        this.encounter = findMunEncounter(this.curEls, st.t, this.curEls.period ?? 200000);
      } else if (st.body === 'mun') {
        this.encounter = null;
      } else {
        this.encounter = null;
      }
      if (this.mapOpen) this.refreshMapNow();
      HUD.stages(this.plan, this.stageIndex, st.parts, st.sections ?? computeSections(st.parts));
    }

    // orbit panel
    let phase = null, transferPhase = 0;
    if (st.body === 'kerbin') {
      const munPos = getBodyState('mun', st.t).pos;
      const rv = st.pos.clone().normalize(), rm = munPos.clone().normalize();
      const cross = new THREE.Vector3().crossVectors(rv, rm);
      let a = Math.atan2(cross.y, rv.dot(rm)) * 180 / Math.PI;
      if (a < 0) a += 360;
      phase = a;
      transferPhase = munTransferPhase(st.pos.length());
    }
    HUD.orbit(st, this.curEls, {
      tAp: this.curEls ? timeToApoapsis(this.curEls, st.t) : null,
      tPe: this.curEls ? timeToPeriapsis(this.curEls, st.t) : Infinity,
      phase, transferPhase,
      encounter: this.encounter,
    });
  }

  refreshMapNow() {
    this.map.refresh(this.st, this.curEls, this.encounter);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.map?.resize(w, h);
  }
}
