// Full-mission integration test: a crude autopilot flies the stock
// "Mun Express" from the pad to a soft Mun landing using the real physics
// engine. Attitude is cheated (quat set directly); translation, fuel flow,
// staging, drag, SOI transitions and ground contact are the real code paths.

import { writeFileSync } from 'node:fs';
import { Vector3, Quaternion } from 'three';
import { STOCK } from '../src/stock.js';
import { BODIES, getBodyState, PAD_DIR, PAD_ALTITUDE, fmtTime, fmtDist } from '../src/constants.js';
import { buildVesselParts, buildStagePlan, stackGeometry, computeSections, massProps } from '../src/vessel.js';
import { physicsStep } from '../src/physics.js';
import { elementsFromState, propagate, timeToPeriapsis, timeToApoapsis, findMunEncounter, munTransferPhase } from '../src/orbits.js';
import { heightAt } from '../src/terrain.js';

const Y = new Vector3(0, 1, 0);
let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
};
const log = (s) => console.log(`      ${s}`);

// ---- build vessel on the pad ----
const design = structuredClone(STOCK['Mun Express']);
const parts = buildVesselParts(design);
const geom0 = stackGeometry(parts);
const mp0 = massProps(parts, geom0);
const quat0 = new Quaternion().setFromUnitVectors(Y, PAD_DIR);

const st = {
  t: 0, body: 'kerbin',
  pos: PAD_DIR.clone().multiplyScalar(BODIES.kerbin.radius + PAD_ALTITUDE + 0.7 + mp0.comY),
  vel: new Vector3(),
  quat: quat0.clone(), angVel: new Vector3(),
  throttle: 0, landed: true, dead: false,
  parts, geom: geom0, sections: computeSections(parts), massProps: mp0,
  controls: { pitch: 0, yaw: 0, roll: 0 },
  sas: false, sasMode: 'hold', sasTarget: quat0.clone(),
};

const plan = buildStagePlan(parts);
let stageIdx = 0;
const events = [];
function stage() {
  const ev = plan[stageIdx++];
  if (!ev) return;
  if (ev.decouple !== null) st.parts = st.parts.filter((p) => p.stackIndex < ev.decouple);
  for (const k of ev.dropRadials) st.parts = st.parts.filter((p) => p.key !== k);
  for (const k of ev.ignite) {
    const p = st.parts.find((q) => q.key === k);
    if (p) p.ignited = true;
  }
  if (ev.chutes) for (const p of st.parts) if (p.def.chute) p.chuteState = 'armed';
  log(`STAGE ${stageIdx}: ${ev.label} (t=${st.t.toFixed(0)}s)`);
  const names = ev.ignite
    .map((k) => st.parts.find((p) => p.key === k)?.def.name).filter(Boolean).join(' + ');
  evt(`STAGE ${stageIdx}`, `${ev.label}${names ? ` — ignite ${names}` : ''}` +
    (ev.decouple !== null ? ' (lower stack jettisoned)' : '') +
    (ev.dropRadials.length ? ' (boosters away)' : ''));
}

const up = () => st.pos.clone().normalize();
const east = () => new Vector3(0, 1, 0).cross(up()).normalize();
const alt = () => st.pos.length() - BODIES[st.body].radius;
const els = () => elementsFromState(st.pos, st.vel, BODIES[st.body].mu, st.t);
const fuelLeft = () => st.parts.filter((p) => p.fuel > 0 && !p.def.engine?.srb).reduce((s, p) => s + p.fuel, 0);

// ---------------------------------------------------------------------------
// Flight recorder: events + adaptive telemetry, written to FLIGHT_LOG.md
// ---------------------------------------------------------------------------
const LOG = [];
let lastSample = -1e9;
function snap() {
  const mp = massProps(st.parts, stackGeometry(st.parts));
  return {
    t: st.t, body: st.body, alt: alt(), v: st.vel.length(),
    m: mp.m, fuel: fuelLeft(), thr: st.throttle,
  };
}
function evt(tag, msg) { LOG.push({ kind: 'evt', tag, msg, ...snap() }); }
function sample(force = false) {
  const interval = st.throttle > 0 ? 15 : 900; // dense during burns, sparse on coasts
  if (force || st.t - lastSample >= interval) {
    lastSample = st.t;
    LOG.push({ kind: 'tlm', ...snap() });
  }
}

function point(dir) {
  st.quat.setFromUnitVectors(Y, dir.clone().normalize());
  st.angVel.set(0, 0, 0);
}

let lastEvents = [];
function step(dt = 0.05) {
  physicsStep(st, dt, events);
  st.t += dt;
  for (const ev of events) {
    if (ev.type === 'crashed') throw new Error(`CRASHED at ${ev.speed.toFixed(1)} m/s, t=${st.t.toFixed(0)}s, alt=${alt().toFixed(0)}`);
    if (ev.type === 'overheat' && ev.part.def.pod) throw new Error(`pod overheated at t=${st.t.toFixed(0)}s`);
    if (ev.type === 'liftoff') evt('LIFTOFF', 'Vehicle has cleared the pad');
    if (ev.type === 'overheat') evt('OVERHEAT', `${ev.part.def.name} destroyed by heating`);
    if (ev.type === 'soi') evt('SOI', `Entered ${BODIES[ev.body].name} sphere of influence`);
    if (ev.type === 'landed') evt('TOUCHDOWN', `Contact at ${ev.speed.toFixed(2)} m/s — ${BODIES[st.body].name}`);
  }
  sample();
  lastEvents = events.splice(0, events.length);
}

/** Coast on rails until cond(t) or timeout; preserves SOI checks coarsely. */
function coast(until, maxT, dt = 10) {
  let el = els();
  const t0 = st.t;
  while (st.t - t0 < maxT) {
    st.t += dt;
    const { pos, vel } = propagate(el, st.t);
    if (pos.length() - BODIES[st.body].radius < 22_000) return until(); // never rail into terrain
    st.pos.copy(pos); st.vel.copy(vel);
    sample();
    // manual SOI check (same math as physics.checkSOI)
    if (st.body === 'kerbin') {
      const mun = getBodyState('mun', st.t);
      if (st.pos.distanceTo(mun.pos) < BODIES.mun.soi) {
        st.pos.sub(mun.pos); st.vel.sub(mun.vel); st.body = 'mun';
        el = els();
        log(`entered Mun SOI at t=${(st.t / 3600).toFixed(2)} h`);
        evt('SOI', 'Entered Mun sphere of influence (on-rails coast)');
      }
    }
    if (until()) return true;
  }
  return until();
}

// ---------------------------------------------------------------------------
// 1. ASCENT
// ---------------------------------------------------------------------------
log(`liftoff mass ${(mp0.m / 1000).toFixed(1)} t`);
evt('PRELAUNCH', `${design.name ?? 'Mun Express'} on the pad — liftoff mass ${(mp0.m / 1000).toFixed(2)} t, ${plan.length} stages`);
st.throttle = 1;
stage(); // ignition: falcon + SRBs

// Closed-loop ascent guidance: gravity turn until Ap ~ 83 km, then hold
// time-to-apoapsis ~35 s with horizontal thrust until Pe clears the
// atmosphere. One continuous burn — robust with low-TWR upper stages.
let srbsDropped = false;
let orbitDone = false;
for (let i = 0; i < 400_000; i++) {
  const sp = st.vel.length();
  const u = up();
  const vUp = st.vel.dot(u);
  const e = els();
  const apAlt = (e.a > 0 ? e.ra : 1e12) - BODIES.kerbin.radius;
  const peAlt = e.rp - BODIES.kerbin.radius;

  if (e.a > 0 && peAlt > 71_500) { st.throttle = 0; orbitDone = true; break; }

  if (apAlt < 83_000) {
    const k = Math.min(0.92, Math.pow(Math.max(0, (sp - 80) / 2200), 0.8));
    point(u.clone().multiplyScalar(1 - k).addScaledVector(east(), k));
  } else {
    const tAp = timeToApoapsis(e, st.t);
    const hdir = st.vel.clone().addScaledVector(u, -vUp).normalize();
    const bias = Math.max(-0.15, Math.min(0.55, (35 - tAp) / 50));
    point(hdir.addScaledVector(u, bias));
  }
  st.throttle = 1;
  step(0.05);

  // drop SRBs when dry
  if (!srbsDropped) {
    const srb = st.parts.find((p) => p.def.engine?.srb);
    if (srb && srb.fuel <= 1) { stage(); srbsDropped = true; }
  }
  // stage when the current section runs dry
  const lit = st.parts.find((p) => p.ignited && p.alive && p.def.engine && !p.def.engine.srb);
  if (lit) {
    const secs = computeSections(st.parts);
    if (!st.parts.some((p) => p.def.fuel && !p.def.engine && p.fuel > 0.5 &&
        secs.get(p.stackIndex) === secs.get(lit.stackIndex))) stage();
  }
  if (i % 2400 === 0 && i > 0) {
    log(`ascent t=${st.t.toFixed(0)}s alt=${(alt() / 1000).toFixed(1)}km v=${sp.toFixed(0)} Ap=${(apAlt / 1000).toFixed(0)}km Pe=${(peAlt / 1000).toFixed(0)}km`);
  }
}
{
  const e = els();
  log(`orbit: ${((e.rp - BODIES.kerbin.radius) / 1000).toFixed(0)} × ${((e.ra - BODIES.kerbin.radius) / 1000).toFixed(0)} km at t=${st.t.toFixed(0)}s, fuel ${fuelLeft().toFixed(0)} kg`);
  check('reached stable orbit', orbitDone && e.rp > BODIES.kerbin.radius + 70_000,
    `pe alt=${((e.rp - BODIES.kerbin.radius) / 1000).toFixed(1)} km`);
  evt('MECO / ORBIT', `Stable orbit ${((e.rp - BODIES.kerbin.radius) / 1000).toFixed(0)} × ${((e.ra - BODIES.kerbin.radius) / 1000).toFixed(0)} km`);
}

// drop the launch stage if it's dry, light the sparrow for the trip
{
  const spentTanks = !st.parts.some((p) => p.def.fuel && !p.def.engine && p.fuel > 0.5 &&
    computeSections(st.parts).get(p.stackIndex) === 0);
  const falcon = st.parts.find((p) => p.def.name.includes('Falcon'));
  if (falcon && spentTanks) stage();
}

// ---------------------------------------------------------------------------
// 3. WAIT for transfer phase angle, then BURN
// ---------------------------------------------------------------------------
{
  const target = munTransferPhase(st.pos.length());
  const phaseNow = () => {
    const mun = getBodyState('mun', st.t).pos;
    const rv = st.pos.clone().normalize(), rm = mun.clone().normalize();
    const cr = new Vector3().crossVectors(rv, rm);
    let a = Math.atan2(cr.y, rv.dot(rm)) * 180 / Math.PI;
    if (a < 0) a += 360;
    return a;
  };
  const ok = coast(() => Math.abs(phaseNow() - target) < 0.8, 4 * 32_000, 2);
  check('reached transfer window', ok, `phase=${phaseNow().toFixed(1)} target=${target.toFixed(1)}`);
  log(`transfer burn at phase ${phaseNow().toFixed(1)}° (target ${target.toFixed(1)}°), t=${(st.t / 3600).toFixed(2)} h`);
  evt('XFER WINDOW', `Mun phase angle ${phaseNow().toFixed(1)}° (target ${target.toFixed(1)}°) — TLI burn start`);

  st.throttle = 1;
  let enc = null;
  for (let i = 0; i < 60_000; i++) {
    point(st.vel);
    step(0.05);
    const e = els();
    if (e.ra > BODIES.mun.orbitRadius - BODIES.mun.soi * 0.6) {
      st.throttle = 0;
      enc = findMunEncounter(e, st.t, e.period ?? 90_000);
      if (enc) break;
      // nudge a touch higher and re-check
      st.throttle = 1;
      for (let j = 0; j < 60; j++) { point(st.vel); step(0.05); }
      st.throttle = 0;
      enc = findMunEncounter(els(), st.t, els().period ?? 90_000);
      break;
    }
  }
  check('Mun encounter predicted', !!enc, 'no SOI intersection found');
  if (enc) log(`predicted Mun periapsis ${(enc.munPeriapsis / 1000).toFixed(0)} km`);
  log(`fuel after transfer burn: ${fuelLeft().toFixed(0)} kg`);
  evt('TLI CUTOFF', `Trans-Munar injection complete${enc ? ` — predicted Mun periapsis ${(enc.munPeriapsis / 1000).toFixed(0)} km` : ''}`);
}

// ---------------------------------------------------------------------------
// 4. COAST to Mun SOI, capture + deorbit at periapsis
// ---------------------------------------------------------------------------
{
  const got = coast(() => st.body === 'mun', 90_000, 5);
  check('crossed into Mun SOI', got);

  // coast to periapsis
  let el = els();
  const tPe = timeToPeriapsis(el, st.t);
  log(`Mun periapsis in ${(tPe / 60).toFixed(1)} min, alt ${(el.rp - BODIES.mun.radius) / 1000 | 0} km`);
  coast(() => false, Math.max(0, tPe - 20), 2);

  // capture burn at periapsis: lower the far side of the orbit to ~25 km —
  // landing from low orbit is far cheaper than dropping from altitude
  st.throttle = 1;
  for (let i = 0; i < 80_000; i++) {
    point(st.vel.clone().negate());
    step(0.05);
    const e = els();
    // rp is the orbit's low point: capture circularizes first, then the far
    // side descends — stop when it reaches the 25-35 km band. (a > 0 inside
    // the SOI means bound to the Mun.)
    if (e.a > 0 && e.rp - BODIES.mun.radius < 32_000) break;
    if (alt() < 25_000) break; // already arrived low
  }
  st.throttle = 0;
  const e = els();
  check('captured by the Mun', e.a > 0 && e.ra < BODIES.mun.soi,
    `a=${e.a.toFixed(0)} ra=${e.ra.toFixed(0)}`);
  log(`fuel after capture: ${fuelLeft().toFixed(0)} kg, orbit ${((e.rp - BODIES.mun.radius) / 1000).toFixed(0)} × ${((e.ra - BODIES.mun.radius) / 1000).toFixed(0)} km`);
  evt('MOI', `Mun orbit insertion — ${((e.rp - BODIES.mun.radius) / 1000).toFixed(0)} × ${((e.ra - BODIES.mun.radius) / 1000).toFixed(0)} km`);

  // coast to the new low point
  const tPe2 = timeToPeriapsis(els(), st.t);
  if (isFinite(tPe2) && tPe2 > 30) coast(() => false, tPe2 - 15, 2);
  log(`descent start: alt ${(alt() / 1000).toFixed(1)} km, speed ${st.vel.length().toFixed(0)} m/s`);
  evt('PDI', `Powered descent initiation — alt ${(alt() / 1000).toFixed(1)} km, velocity ${st.vel.length().toFixed(0)} m/s`);
}

// ---------------------------------------------------------------------------
// 5. POWERED DESCENT
// ---------------------------------------------------------------------------
{
  for (const p of st.parts) if (p.def.legs) p.legsDown = true;

  let landedEv = null;
  for (let i = 0; i < 400_000 && !landedEv; i++) {
    const u = up();
    const r = st.pos.length();
    const aglNow = r - BODIES.mun.radius - heightAt('mun', u) - st.massProps.comY;
    const vUp = st.vel.dot(u);
    const vH = st.vel.clone().addScaledVector(u, -vUp);
    const speed = st.vel.length();

    // staging: if the sparrow runs dry, drop to the kestrel lander stage
    const secs = computeSections(st.parts);
    const sparrow = st.parts.find((p) => p.def.name.includes('Sparrow'));
    if (sparrow?.ignited) {
      const feed = st.parts.filter((p) => p.def.fuel && !p.def.engine && p.fuel > 0.5 &&
        secs.get(p.stackIndex) === secs.get(sparrow.stackIndex));
      if (!feed.length) stage();
    }

    const mp = st.massProps ?? massProps(st.parts, stackGeometry(st.parts));
    const g = BODIES.mun.mu / (r * r);
    const maxThrust = st.parts
      .filter((p) => p.alive && p.ignited && p.def.engine)
      .reduce((s, p) => s + p.def.engine.thrustVac * p.sym, 0) || 24_000;
    const maxAcc = maxThrust / mp.m;
    const brake = Math.max(0.1, 0.62 * (maxAcc - g));
    const vAllow = Math.sqrt(Math.max(0, 2 * brake * Math.max(0, aglNow - 8))) + 4;

    if (vH.length() > 4 && aglNow > 2000) {
      // kill horizontal velocity first, slight up-bias
      point(vH.clone().negate().addScaledVector(u, vH.length() * 0.25));
      st.throttle = 1;
    } else if (speed > vAllow) {
      point(st.vel.clone().negate());
      st.throttle = 1;
    } else {
      point(u);
      st.throttle = 0;
    }
    step(0.04);
    landedEv = lastEvents.find((ev) => ev.type === 'landed');
    if (i % 25_000 === 0) log(`descent: agl ${(aglNow / 1000).toFixed(1)} km, v ${speed.toFixed(0)} m/s, fuel ${fuelLeft().toFixed(0)} kg`);
  }

  check('LANDED ON THE MUN', !!landedEv && st.landed && st.body === 'mun',
    `landed=${st.landed} body=${st.body}`);
  if (landedEv) log(`touchdown at ${landedEv.speed.toFixed(2)} m/s, t=${(st.t / 3600).toFixed(2)} h MET`);
  check('pod survived', st.parts.some((p) => p.alive && p.def.pod));
  const remaining = fuelLeft();
  log(`fuel remaining after landing: ${remaining.toFixed(0)} kg`);
  check('fuel margin for the trip home', remaining > 250, `${remaining.toFixed(0)} kg`);
  evt('MISSION END', `The Mun. Pod intact, ${remaining.toFixed(0)} kg of liquid fuel in reserve for the trip home.`);
}

// ---------------------------------------------------------------------------
// Write FLIGHT_LOG.md
// ---------------------------------------------------------------------------
{
  const met = (t) => 'T+' + fmtTime(t);
  const lines = [];
  lines.push('# MOONSHOT — Mission Flight Log');
  lines.push('');
  lines.push('**Craft:** Mun Express (stock) · **Pilot:** autopilot (`tests/mission.test.mjs`) · ' +
    '**Physics:** live game engine, headless');
  lines.push(`**Result:** ${failures === 0 ? '🌕 mission complete — soft landing on the Mun' : `${failures} check(s) failed`}`);
  lines.push('');
  lines.push('## Events');
  lines.push('');
  lines.push('```text');
  for (const e of LOG) {
    if (e.kind !== 'evt') continue;
    lines.push(`${met(e.t).padEnd(12)} ${e.tag.padEnd(13)} ${e.msg}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('## Telemetry');
  lines.push('');
  lines.push('Sampled every 15 s under thrust, every 15 min on coasts.');
  lines.push('');
  lines.push('| MET | Body | Altitude | Velocity | Mass | Liquid fuel | Throttle |');
  lines.push('|---|---|--:|--:|--:|--:|--:|');
  for (const e of LOG) {
    if (e.kind !== 'tlm') continue;
    lines.push(`| ${met(e.t)} | ${BODIES[e.body].name} | ${fmtDist(Math.max(0, e.alt))} | ` +
      `${e.v.toFixed(0)} m/s | ${(e.m / 1000).toFixed(2)} t | ${e.fuel.toFixed(0)} kg | ` +
      `${(e.thr * 100).toFixed(0)}% |`);
  }
  lines.push('');
  writeFileSync(new URL('../FLIGHT_LOG.md', import.meta.url), lines.join('\n'));
  console.log(`\nflight log written: FLIGHT_LOG.md (${LOG.filter((e) => e.kind === 'evt').length} events, ` +
    `${LOG.filter((e) => e.kind === 'tlm').length} telemetry rows)`);
}

console.log(failures === 0 ? '\n🌕 MISSION COMPLETE — stock craft can land on the Mun.' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
