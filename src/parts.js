// Part catalog. Masses in kg, lengths in m, thrust in N, sizes are stack diameters.
// dragArea is an effective Cd*A contribution in m^2.

import { G0 } from './constants.js';

export const PARTS = {
  // ---- Pods ----
  'pod-mk1': {
    name: 'Mk1 Command Pod', category: 'Pods', size: 1.25, mass: 800, length: 1.1,
    pod: { torque: 6000 }, dragArea: 0.6, maxTemp: 2200, shape: 'pod',
    desc: 'One brave pilot. Built-in reaction wheels and a reentry-rated hull.',
  },
  'pod-mk2': {
    name: 'Mk2 Command Module', category: 'Pods', size: 2.5, mass: 2700, length: 1.6,
    pod: { torque: 16000 }, dragArea: 1.8, maxTemp: 2200, shape: 'pod',
    desc: 'Roomy three-seater. Stronger reaction wheels.',
  },

  // ---- Fuel tanks ----
  'tank-s': {
    name: 'FT-100 Tank', category: 'Tanks', size: 1.25, mass: 60, fuel: 500, length: 0.9,
    dragArea: 0.4, maxTemp: 1200, shape: 'tank',
    desc: 'A small can of rocket juice.',
  },
  'tank-m': {
    name: 'FT-400 Tank', category: 'Tanks', size: 1.25, mass: 250, fuel: 2000, length: 1.9,
    dragArea: 0.5, maxTemp: 1200, shape: 'tank',
    desc: 'The dependable mid-size tank.',
  },
  'tank-l': {
    name: 'FT-800 Tank', category: 'Tanks', size: 1.25, mass: 500, fuel: 4000, length: 3.4,
    dragArea: 0.6, maxTemp: 1200, shape: 'tank',
    desc: 'Tall boy. Most of your rocket is this.',
  },
  'tank-xl': {
    name: 'FT-3200 Tank', category: 'Tanks', size: 2.5, mass: 2000, fuel: 16000, length: 4.4,
    dragArea: 1.6, maxTemp: 1200, shape: 'tank',
    desc: 'Heavy-lift propellant. Mind the pad.',
  },

  // ---- Engines ----
  'eng-kestrel': {
    name: 'K-1 "Kestrel"', category: 'Engines', size: 1.25, mass: 140, length: 0.6,
    engine: { thrustVac: 24_000, ispVac: 320, ispSL: 95, gimbal: 2, throttleable: true },
    dragArea: 0.3, maxTemp: 2000, shape: 'engine',
    desc: 'Tiny vacuum engine for landers and final stages.',
  },
  'eng-sparrow': {
    name: 'S-7 "Sparrow"', category: 'Engines', size: 1.25, mass: 500, length: 1.0,
    engine: { thrustVac: 60_000, ispVac: 345, ispSL: 85, gimbal: 3, throttleable: true },
    dragArea: 0.3, maxTemp: 2000, shape: 'engine',
    desc: 'Excellent vacuum performance. Hopeless at sea level.',
  },
  'eng-falcon': {
    name: 'F-30 "Falcon"', category: 'Engines', size: 1.25, mass: 1500, length: 1.5,
    engine: { thrustVac: 215_000, ispVac: 310, ispSL: 265, gimbal: 3, throttleable: true },
    dragArea: 0.4, maxTemp: 2200, shape: 'engine',
    desc: 'Gimballed workhorse lifter engine.',
  },
  'eng-titan': {
    name: 'T-900 "Titan"', category: 'Engines', size: 2.5, mass: 6000, length: 2.4,
    engine: { thrustVac: 1_400_000, ispVac: 305, ispSL: 280, gimbal: 2, throttleable: true },
    dragArea: 1.2, maxTemp: 2200, shape: 'engine',
    desc: 'When the rocket absolutely must leave the ground.',
  },
  'srb': {
    name: 'SRB-30 Booster', category: 'Engines', size: 1.0, mass: 750, fuel: 3500, length: 4.2,
    engine: { thrustVac: 220_000, ispVac: 195, ispSL: 170, gimbal: 0, throttleable: false, srb: true },
    radial: true, radialDecouples: true, dragArea: 0.7, maxTemp: 2200, shape: 'srb',
    desc: 'Solid fuel. Lights once, burns ~30 s, cannot be shut down. Radial only.',
  },

  // ---- Coupling ----
  'decoupler-s': {
    name: 'TD-12 Decoupler', category: 'Coupling', size: 1.25, mass: 50, length: 0.3,
    decoupler: true, dragArea: 0.1, maxTemp: 1400, shape: 'decoupler',
    desc: 'Stack separator. Everything below it is jettisoned.',
  },
  'decoupler-l': {
    name: 'TD-25 Decoupler', category: 'Coupling', size: 2.5, mass: 180, length: 0.35,
    decoupler: true, dragArea: 0.3, maxTemp: 1400, shape: 'decoupler',
    desc: 'Big stack separator.',
  },
  'adapter': {
    name: 'C-125 Adapter', category: 'Coupling', size: 2.5, mass: 200, length: 1.0,
    dragArea: 0.5, maxTemp: 1400, shape: 'adapter',
    desc: 'Tapers a 2.5 m stack to 1.25 m.',
  },

  // ---- Aero & utility ----
  'nose-cone': {
    name: 'Aerodynamic Nose Cone', category: 'Aero', size: 1.25, mass: 50, length: 0.8,
    dragArea: 0.05, noseBonus: 0.5, maxTemp: 1600, shape: 'nose',
    desc: 'Pointy end up. Reduces total drag.',
  },
  'fins': {
    name: 'Stabilizer Fins ×4', category: 'Aero', size: 1.25, mass: 80, length: 0.9,
    fins: { area: 4.8 }, radial: true, dragArea: 0.3, maxTemp: 1400, shape: 'fins',
    desc: 'Keeps the pointy end forward in atmosphere. Radial attach.',
  },
  'chute': {
    name: 'Mk2 Parachute', category: 'Utility', size: 1.25, mass: 100, length: 0.35,
    chute: { dragArea: 280 }, dragArea: 0.15, maxTemp: 1100, shape: 'chute',
    desc: 'Deploys below 2.5 km and under 300 m/s. Pack it on top.',
  },
  'legs': {
    name: 'LT-2 Landing Legs ×4', category: 'Utility', size: 1.25, mass: 150, length: 1.6,
    legs: { safeSpeed: 12 }, radial: true, dragArea: 0.2, maxTemp: 1400, shape: 'legs',
    desc: 'Touch down at up to 12 m/s. Radial attach, toggle with G.',
  },
  'heat-shield': {
    name: 'AB-1 Heat Shield', category: 'Utility', size: 1.25, mass: 300, length: 0.3,
    shield: { ablator: 200 }, dragArea: 0.7, maxTemp: 3400, shape: 'shield',
    desc: 'Ablative shield for reentry. Goes under the pod, blunt end first.',
  },
};

export const CATEGORIES = ['Pods', 'Tanks', 'Engines', 'Coupling', 'Aero', 'Utility'];

export const RADIAL_PARTS = Object.keys(PARTS).filter((id) => PARTS[id].radial);

export function partWetMass(def) { return def.mass + (def.fuel ?? 0); }

export function engineMdot(def) {
  return def.engine.thrustVac / (def.engine.ispVac * G0);
}

/** Thrust at ambient pressure (atm, 1 = Kerbin sea level), fixed mass flow. */
export function engineThrust(def, pressureAtm) {
  const e = def.engine;
  const isp = e.ispVac + (e.ispSL - e.ispVac) * Math.min(1, pressureAtm);
  return engineMdot(def) * isp * G0;
}

export function partInfoHTML(def) {
  const rows = [
    `mass ${(partWetMass(def) / 1000).toFixed(2)} t` + (def.fuel ? ` (${def.fuel} kg fuel)` : ''),
    `${def.size} m · maxT ${def.maxTemp} K`,
  ];
  if (def.engine) {
    rows.push(`thrust ${(def.engine.thrustVac / 1000).toFixed(0)} kN vac`);
    rows.push(`Isp ${def.engine.ispVac}s vac / ${def.engine.ispSL}s SL`);
  }
  return `<b>${def.name}</b><br>${rows.join('<br>')}<br><i>${def.desc}</i>`;
}
