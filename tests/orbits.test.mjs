// Validates analytic Kepler propagation against brute-force RK4 integration.
import { Vector3 } from 'three';
import {
  elementsFromState, propagate, timeToPeriapsis, timeToApoapsis,
  sampleOrbitPoints, findMunEncounter, munTransferPhase,
} from '../src/orbits.js';
import { BODIES, getBodyState, MUN_OMEGA } from '../src/constants.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

function rk4(r0, v0, mu, T, dt) {
  const r = r0.clone(), v = v0.clone();
  const acc = (rr) => rr.clone().multiplyScalar(-mu / Math.pow(rr.length(), 3));
  let t = 0;
  while (t < T) {
    const h = Math.min(dt, T - t);
    const k1v = acc(r), k1r = v;
    const k2v = acc(r.clone().addScaledVector(k1r, h / 2));
    const k2r = v.clone().addScaledVector(k1v, h / 2);
    const k3v = acc(r.clone().addScaledVector(k2r, h / 2));
    const k3r = v.clone().addScaledVector(k2v, h / 2);
    const k4v = acc(r.clone().addScaledVector(k3r, h));
    const k4r = v.clone().addScaledVector(k3v, h);
    r.addScaledVector(k1r.clone().addScaledVector(k2r, 2).addScaledVector(k3r, 2).add(k4r), h / 6);
    v.addScaledVector(k1v.clone().addScaledVector(k2v, 2).addScaledVector(k3v, 2).add(k4v), h / 6);
    t += h;
  }
  return { r, v };
}

const mu = BODIES.kerbin.mu;

// --- 1. Elliptic orbit: 80 km x 250 km, slightly inclined ---
{
  const r0 = new Vector3(680_000, 0, 0);
  const vCirc = Math.sqrt(mu / 680_000);
  const v0 = new Vector3(0, 0.05 * vCirc, -1.04 * vCirc); // eastward-ish + small normal
  const el = elementsFromState(r0, v0, mu, 0);
  check('elliptic: e < 1', el.e < 1, `e=${el.e}`);

  const T = 1234.5;
  const num = rk4(r0, v0, mu, T, 0.05);
  const ana = propagate(el, T);
  const perr = ana.pos.distanceTo(num.r);
  const verr = ana.vel.distanceTo(num.v);
  check('elliptic: position matches RK4', perr < 50, `err=${perr.toFixed(2)} m`);
  check('elliptic: velocity matches RK4', verr < 0.5, `err=${verr.toFixed(4)} m/s`);

  // Round trip after a full period
  const back = propagate(el, el.period);
  check('elliptic: periodic', back.pos.distanceTo(r0) < 1, `err=${back.pos.distanceTo(r0)}`);

  // Ap/Pe radii from samples
  const pts = sampleOrbitPoints(el, 720);
  let rmin = 1e12, rmax = 0;
  for (const p of pts) { rmin = Math.min(rmin, p.length()); rmax = Math.max(rmax, p.length()); }
  check('elliptic: rp sample', Math.abs(rmin - el.rp) / el.rp < 1e-3);
  check('elliptic: ra sample', Math.abs(rmax - el.ra) / el.ra < 1e-3);

  // time to periapsis: propagate there, radius should equal rp
  const tp = timeToPeriapsis(el, 100);
  const atPe = propagate(el, 100 + tp);
  check('elliptic: timeToPeriapsis', Math.abs(atPe.pos.length() - el.rp) < 5,
    `r=${atPe.pos.length()}, rp=${el.rp}`);
  const ta = timeToApoapsis(el, 100);
  const atAp = propagate(el, 100 + ta);
  check('elliptic: timeToApoapsis', Math.abs(atAp.pos.length() - el.ra) < 5);
}

// --- 2. Hyperbolic flyby ---
{
  const r0 = new Vector3(9e5, 2e5, -3e5);
  const vesc = Math.sqrt(2 * mu / r0.length());
  const v0 = new Vector3(-300, 200, -1.25 * vesc);
  const el = elementsFromState(r0, v0, mu, 0);
  check('hyperbolic: e > 1', el.e > 1, `e=${el.e}`);

  const t0check = propagate(el, 0);
  check('hyperbolic: t0 state round-trip pos', t0check.pos.distanceTo(r0) < 5,
    `err=${t0check.pos.distanceTo(r0)}`);
  check('hyperbolic: t0 state round-trip vel', t0check.vel.distanceTo(v0) < 0.05);

  const T = 4000;
  const num = rk4(r0, v0, mu, T, 0.05);
  const ana = propagate(el, T);
  check('hyperbolic: position matches RK4', ana.pos.distanceTo(num.r) < 100,
    `err=${ana.pos.distanceTo(num.r).toFixed(1)} m`);
}

// --- 3. Elliptic state round-trip at t0 ---
{
  const r0 = new Vector3(700_000, 30_000, 10_000);
  const v0 = new Vector3(120, -80, 2250);
  const el = elementsFromState(r0, v0, mu, 777);
  const s = propagate(el, 777);
  check('elliptic: t0 round-trip pos', s.pos.distanceTo(r0) < 2, `err=${s.pos.distanceTo(r0)}`);
  check('elliptic: t0 round-trip vel', s.vel.distanceTo(v0) < 0.02);
}

// --- 4. Mun encounter: a deliberate Hohmann transfer should hit the SOI ---
{
  // Mun is at angle th(t). Place the craft so that a Hohmann transfer
  // started now arrives at the Mun's future position.
  const r1 = 680_000;
  const r2 = BODIES.mun.orbitRadius;
  const aT = (r1 + r2) / 2;
  const tT = Math.PI * Math.sqrt(aT ** 3 / mu);
  const munNow = getBodyState('mun', 0).pos;
  const munTh = Math.atan2(-munNow.z, munNow.x);          // current Mun angle
  const arrivalTh = munTh + MUN_OMEGA * tT;                // where Mun will be
  const burnTh = arrivalTh - Math.PI;                      // start opposite arrival
  const rHat = new Vector3(Math.cos(burnTh), 0, -Math.sin(burnTh));
  const eHat = new Vector3(-Math.sin(burnTh), 0, -Math.cos(burnTh)); // prograde (+Y angular momentum)
  const vPe = Math.sqrt(mu * (2 / r1 - 1 / aT));
  const el = elementsFromState(rHat.clone().multiplyScalar(r1), eHat.clone().multiplyScalar(vPe), mu, 0);
  const enc = findMunEncounter(el, 0, el.period ?? tT * 2.5);
  check('encounter: found', !!enc);
  if (enc) {
    // SOI entry happens well before arrival at the Mun's centre (the SOI is huge)
    check('encounter: time before transfer time, same order', enc.tEnter < tT && enc.tEnter > tT * 0.5,
      `tEnter=${enc.tEnter.toFixed(0)}, tT=${tT.toFixed(0)}`);
    check('encounter: hyperbolic wrt Mun', enc.relElements.e > 1);
    check('encounter: periapsis sane', enc.munPeriapsis < BODIES.mun.soi,
      `pe=${enc.munPeriapsis}`);
  }
  const phase = munTransferPhase(r1);
  check('phase angle plausible (100-130 deg)', phase > 100 && phase < 130, `phase=${phase}`);
}

console.log(failures === 0 ? '\nAll orbit tests passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
