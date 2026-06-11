import { Vector3 } from 'three';

export const G0 = 9.80665;

// KSP-scale system. Kerbin is the inertial root frame (non-rotating, v1).
export const BODIES = {
  kerbin: {
    name: 'Kerbin',
    radius: 600_000,
    mu: 3.5316e12,
    atmoHeight: 70_000,
    rho0: 1.225,          // sea-level density kg/m^3
    scaleHeight: 5600,    // m
    soi: 84_159_286,
    surfaceGravity: 3.5316e12 / 600_000 ** 2, // 9.81
  },
  mun: {
    name: 'the Mun',
    radius: 200_000,
    mu: 6.5138e10,
    atmoHeight: 0,
    rho0: 0,
    scaleHeight: 1,
    soi: 2_429_559,
    orbitRadius: 12_000_000,
    parent: 'kerbin',
    surfaceGravity: 6.5138e10 / 200_000 ** 2, // 1.63
  },
};

// Mun circular orbit angular rate (rad/s); h points +Y so an eastward
// (-Z at the pad) launch is prograde relative to the Mun.
export const MUN_OMEGA = Math.sqrt(BODIES.kerbin.mu / BODIES.mun.orbitRadius ** 3);
export const MUN_PHASE0 = 1.7; // starting angle, radians

// Launch site: equator, +X direction. East is -Z there.
export const PAD_DIR = new Vector3(1, 0, 0);
export const PAD_ALTITUDE = 50; // terrain is flattened to this height around the pad

/** Position/velocity of a body in Kerbin-centred inertial coords at sim time t. */
export function getBodyState(name, t) {
  if (name === 'kerbin') {
    return { pos: new Vector3(), vel: new Vector3() };
  }
  const a = BODIES.mun.orbitRadius;
  const th = MUN_PHASE0 + MUN_OMEGA * t;
  // r x v = +Y with this parameterisation
  return {
    pos: new Vector3(a * Math.cos(th), 0, -a * Math.sin(th)),
    vel: new Vector3(-a * MUN_OMEGA * Math.sin(th), 0, -a * MUN_OMEGA * Math.cos(th)),
  };
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}`;
}

export function fmtDist(m) {
  const neg = m < 0 ? '-' : '';
  m = Math.abs(m);
  if (m >= 1e6) return `${neg}${(m / 1e6).toFixed(2)} Mm`;
  if (m >= 1e4) return `${neg}${(m / 1e3).toFixed(1)} km`;
  if (m >= 1e3) return `${neg}${(m / 1e3).toFixed(2)} km`;
  return `${neg}${m.toFixed(0)} m`;
}
