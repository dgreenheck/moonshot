// Vessel runtime: part instances, stack geometry, fuel-flow sections,
// staging plan, mass properties, and the delta-v calculator (shared with VAB).
//
// A design is { name, stack: [partId...] (index 0 = top), radials: [{ part, sym, host }] }.
// Sections: contiguous stack runs between decouplers; engines drain tanks in
// their own section (radial tanks count with their host's section). SRBs are
// self-contained.

import { PARTS, partWetMass, engineMdot, engineThrust } from './parts.js';
import { G0 } from './constants.js';

let keyCounter = 0;

export function buildVesselParts(design) {
  const parts = [];
  for (let i = 0; i < design.stack.length; i++) {
    const def = PARTS[design.stack[i]];
    parts.push({
      key: `s${keyCounter++}`, def, kind: 'stack', stackIndex: i, sym: 1,
      fuel: def.fuel ?? 0, ablator: def.shield?.ablator ?? 0,
      temp: 290, alive: true, ignited: false,
      chuteState: def.chute ? 'stowed' : null,
      legsDown: def.legs ? false : null,
    });
  }
  for (const r of design.radials ?? []) {
    const def = PARTS[r.part];
    parts.push({
      key: `r${keyCounter++}`, def, kind: 'radial', stackIndex: r.host, sym: r.sym,
      fuel: (def.fuel ?? 0) * r.sym, ablator: 0,
      temp: 290, alive: true, ignited: false,
      chuteState: def.chute ? 'stowed' : null,
      legsDown: def.legs ? false : null,
    });
  }
  return parts;
}

/** Geometry along the stack axis (+Y up). Returns { yCenter: Map, totalLength, bottomY }. */
export function stackGeometry(parts) {
  const stack = parts
    .filter((p) => p.kind === 'stack' && p.alive)
    .sort((a, b) => b.stackIndex - a.stackIndex); // bottom first
  const yCenter = new Map();
  let y = 0;
  for (const p of stack) {
    yCenter.set(p.stackIndex, y + p.def.length / 2);
    y += p.def.length;
  }
  for (const p of parts) {
    if (p.kind === 'radial' && p.alive) {
      const hostY = yCenter.get(p.stackIndex);
      if (hostY !== undefined) yCenter.set('r:' + p.key, hostY);
    }
  }
  return { yCenter, totalLength: y, bottomY: 0 };
}

export function partY(geom, p) {
  return p.kind === 'stack' ? (geom.yCenter.get(p.stackIndex) ?? 0) : (geom.yCenter.get('r:' + p.key) ?? 0);
}

/** Section id per alive stack index: 0 at the bottom, +1 above each decoupler. */
export function computeSections(parts) {
  const stack = parts
    .filter((p) => p.kind === 'stack' && p.alive)
    .sort((a, b) => b.stackIndex - a.stackIndex); // bottom first
  const sec = new Map();
  let s = 0;
  for (const p of stack) {
    sec.set(p.stackIndex, s);
    if (p.def.decoupler) s++; // parts above a decoupler are the next section
  }
  return sec;
}

export function partSection(sections, p) {
  return sections.get(p.stackIndex) ?? -1;
}

/** Tanks an engine part can drain right now. */
export function feedTanks(parts, sections, enginePart) {
  if (enginePart.def.engine?.srb) return enginePart.fuel > 0 ? [enginePart] : [];
  const sec = partSection(sections, enginePart);
  return parts.filter((p) =>
    p.alive && p.fuel > 0 && !p.def.engine?.srb &&
    p.def.fuel && partSection(sections, p) === sec);
}

/**
 * Burn engines for dt. Mutates tank fuel. Returns { thrust, perEngine: Map(key->N) }.
 * throttle in 0..1, pressureAtm ambient.
 */
export function burn(parts, sections, dt, throttle, pressureAtm) {
  let total = 0;
  const perEngine = new Map();
  for (const ep of parts) {
    if (!ep.alive || !ep.ignited || !ep.def.engine) continue;
    const e = ep.def.engine;
    const lever = e.throttleable ? throttle : 1;
    if (lever <= 0) { perEngine.set(ep.key, 0); continue; }
    const tanks = feedTanks(parts, sections, ep);
    const avail = tanks.reduce((s, t) => s + t.fuel, 0);
    const want = engineMdot(ep.def) * ep.sym * lever * dt;
    const got = Math.min(want, avail);
    if (got <= 0) { perEngine.set(ep.key, 0); continue; }
    const frac = got / (avail || 1);
    for (const t of tanks) t.fuel -= t.fuel * frac;
    const thrust = engineThrust(ep.def, pressureAtm) * ep.sym * lever * (got / want);
    total += thrust;
    perEngine.set(ep.key, thrust);
  }
  return { thrust: total, perEngine };
}

/** Mass, CoM height, inertia approximations, control torque, drag area. */
export function massProps(parts, geom) {
  let m = 0, my = 0, torque = 0, dragArea = 0, finArea = 0, maxR = 0.6;
  let chuteArea = 0;
  for (const p of parts) {
    if (!p.alive) continue;
    const pm = p.def.mass * p.sym + p.fuel + (p.ablator || 0);
    const y = partY(geom, p);
    m += pm; my += pm * y;
    if (p.def.pod) torque += p.def.pod.torque;
    dragArea += p.def.dragArea * p.sym;
    if (p.def.noseBonus) dragArea -= p.def.noseBonus;
    if (p.def.fins) finArea += p.def.fins.area;
    if (p.chuteState === 'deployed') chuteArea += p.def.chute.dragArea * p.sym;
    maxR = Math.max(maxR, p.def.size / 2 + (p.kind === 'radial' ? p.def.size : 0));
  }
  dragArea = Math.max(0.3, dragArea);
  const comY = m > 0 ? my / m : 0;
  const L = Math.max(2, geom.totalLength);
  return {
    m, comY, dragArea, finArea, chuteArea, podTorque: torque,
    iTrans: (m * L * L) / 12 + m * maxR * maxR * 0.25,
    iAxial: m * maxR * maxR * 0.5,
  };
}

/** Centre of pressure height: drag-area weighted; fins weigh heavily. */
export function centerOfPressure(parts, geom) {
  let area = 0, ay = 0;
  for (const p of parts) {
    if (!p.alive) continue;
    let a = p.def.dragArea * p.sym;
    if (p.def.fins) a += p.def.fins.area * 1.5;
    area += a; ay += a * partY(geom, p);
  }
  return area > 0 ? ay / area : 0;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/**
 * Auto staging plan, bottom-up. Events:
 *  { label, ignite:[keys], decouple: stackIndex|null, dropRadials:[keys], chutes:bool }
 */
export function buildStagePlan(parts) {
  const sections = computeSections(parts);
  const stack = parts.filter((p) => p.kind === 'stack' && p.alive);
  const maxSec = Math.max(0, ...stack.map((p) => partSection(sections, p)));
  const plan = [];

  for (let s = 0; s <= maxSec; s++) {
    const secStack = stack.filter((p) => partSection(sections, p) === s);
    const engines = secStack.filter((p) => p.def.engine).map((p) => p.key);
    const radials = parts.filter((p) =>
      p.kind === 'radial' && p.alive && (sections.get(p.stackIndex) ?? -1) === s);
    const srbs = radials.filter((p) => p.def.engine?.srb).map((p) => p.key);
    const droppable = radials.filter((p) => p.def.radialDecouples).map((p) => p.key);

    const ev = { label: '', ignite: [...engines, ...srbs], decouple: null, dropRadials: [], chutes: false };
    if (s > 0) {
      // the decoupler at the bottom of this section (largest stackIndex in section is the
      // part just above the previous section's decoupler; the decoupler itself is in s-1...
      // find the alive decoupler separating s-1 and s: it's the decoupler with section s-1
      // and the smallest stackIndex among section s-1 decouplers? Use: max stackIndex of section s, +1.
      const minBelow = Math.max(...secStack.map((p) => p.stackIndex)) + 1;
      ev.decouple = minBelow;
      ev.label = `Decouple + ignite`;
    } else {
      ev.label = 'Ignition';
    }
    if (ev.ignite.length || ev.decouple !== null) plan.push(ev);
    if (droppable.length) {
      plan.push({ label: 'Drop boosters', ignite: [], decouple: null, dropRadials: droppable, chutes: false });
    }
  }

  if (parts.some((p) => p.alive && p.def.chute)) {
    plan.push({ label: 'Parachutes', ignite: [], decouple: null, dropRadials: [], chutes: true });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Delta-v / TWR (vacuum Isp, sea-level TWR for the first stage) — used by VAB & HUD
// ---------------------------------------------------------------------------

export function stagingStats(design) {
  const parts = buildVesselParts(design);
  const plan = buildStagePlan(parts);
  const stats = [];

  // running wet mass of everything still attached
  let mass = parts.reduce((s, p) => s + p.def.mass * p.sym + p.fuel + (p.ablator || 0), 0);
  const sections = computeSections(parts);
  const alive = new Set(parts.map((p) => p.key));
  const byKey = new Map(parts.map((p) => [p.key, p]));

  for (const ev of plan) {
    if (ev.chutes) continue;
    // jettison first (decouple events drop mass before the new engines matter)
    if (ev.decouple !== null) {
      for (const p of parts) {
        if (!alive.has(p.key)) continue;
        const idx = p.kind === 'stack' ? p.stackIndex : p.stackIndex;
        if (idx >= ev.decouple) {
          mass -= p.def.mass * p.sym + p.fuel + (p.ablator || 0);
          alive.delete(p.key);
        }
      }
    }
    for (const k of ev.dropRadials) {
      const p = byKey.get(k);
      if (p && alive.has(k)) { mass -= p.def.mass * p.sym + p.fuel; alive.delete(k); }
    }
    if (!ev.ignite.length) continue;

    const engines = ev.ignite.map((k) => byKey.get(k)).filter((p) => p && alive.has(p.key));
    if (!engines.length) continue;

    // Time-march the burn: each engine drains its own feed pool (SRBs are
    // self-contained and flame out early), so combined SRB+liquid stages get
    // honest numbers instead of a lumped average-Isp estimate.
    const pools = engines.map((ep) => ({
      ep,
      tanks: ep.def.engine.srb ? [ep] : feedTanks(parts, sections, ep).filter((t) => alive.has(t.key)),
      mdot: engineMdot(ep.def) * ep.sym,
      thrustVac: ep.def.engine.thrustVac * ep.sym,
      thrustSL: engineThrust(ep.def, 1) * ep.sym,
    }));
    const poolFuel = () => {
      const seen = new Set(); let s = 0;
      for (const pl of pools) for (const t of pl.tanks) {
        if (!seen.has(t.key)) { seen.add(t.key); s += t.fuel; }
      }
      return s;
    };
    let prop = poolFuel();
    if (prop <= 0) continue;

    const wet = mass;
    const twrSL = pools.reduce((s, p) => s + p.thrustSL, 0) / (wet * 9.81);
    const twrVac = pools.reduce((s, p) => s + p.thrustVac, 0) / (wet * 9.81);

    let dv = 0, burnTime = 0;
    const dt = 0.25;
    for (let iter = 0; iter < 8000; iter++) {
      let thrust = 0, burned = 0;
      for (const pl of pools) {
        const avail = pl.tanks.reduce((s, t) => s + t.fuel, 0);
        if (avail <= 0) continue;
        const want = pl.mdot * dt;
        const got = Math.min(want, avail);
        const frac = got / avail;
        for (const t of pl.tanks) t.fuel -= t.fuel * frac;
        thrust += pl.thrustVac * (got / want);
        burned += got;
      }
      if (burned <= 1e-9) break;
      dv += (thrust / mass) * dt;
      mass -= burned;
      burnTime += dt;
    }

    stats.push({ label: ev.label, dv, twrSL, twrVac, burnTime, prop, wet });
  }
  return stats;
}
