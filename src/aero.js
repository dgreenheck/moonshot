// Atmosphere model, drag, and a gameplay-tuned heating model.

import { BODIES } from './constants.js';

/** Density (kg/m^3) at altitude above sea level. */
export function density(bodyName, alt) {
  const b = BODIES[bodyName];
  if (!b.atmoHeight || alt > b.atmoHeight) return 0;
  return b.rho0 * Math.exp(-Math.max(0, alt) / b.scaleHeight);
}

/** Static pressure in atmospheres (Kerbin SL = 1). Same exponential profile. */
export function pressureAtm(bodyName, alt) {
  const b = BODIES[bodyName];
  if (!b.atmoHeight || alt > b.atmoHeight) return 0;
  return Math.exp(-Math.max(0, alt) / b.scaleHeight);
}

/**
 * Heating flux applied to the windward part, in K/s per (kg of part mass).
 * Tuned so a 2,200 m/s reentry at 30-45 km heats a bare pod past 1500 K
 * in about a minute, while a normal ascent profile stays cool.
 */
export function heatingFlux(rho, speed) {
  if (rho <= 0 || speed < 250) return 0;
  // Tuned: ascent at ~1,400 m/s is safe, LKO reentry is mild on a bare pod,
  // a steep (sub-30 km periapsis) Mun return without a heat shield is lethal.
  return 1.0e-5 * Math.pow(rho, 0.8) * Math.pow(speed, 3);
}

/** Per-second temperature decay toward ambient (convective + radiative). */
export function coolingRate(temp, rho) {
  const ambient = rho > 1e-6 ? 290 : 4;
  const convective = Math.min(1, rho * 4) * 0.06 * (temp - ambient);
  const radiative = 1.2e-12 * (temp ** 4 - ambient ** 4);
  return convective + radiative;
}
