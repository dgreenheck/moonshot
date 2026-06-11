// Flight physics: forces, attitude dynamics + SAS, RK4 translation, heating,
// parachutes, ground contact, and SOI transitions. Operates on the mutable
// flight state owned by flight.js.

import * as THREE from 'three/webgpu';
import { BODIES, getBodyState } from './constants.js';
import { density, pressureAtm, heatingFlux, coolingRate } from './aero.js';
import { heightAt } from './terrain.js';
import {
  stackGeometry, computeSections, massProps, centerOfPressure, burn, partY,
} from './vessel.js';

const Y = new THREE.Vector3(0, 1, 0);
const tmp1 = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

export function gravityAccel(body, pos, out) {
  const r = pos.length();
  return out.copy(pos).multiplyScalar(-BODIES[body].mu / (r * r * r));
}

/** One physics substep. Returns an info object for HUD/VFX; pushes events. */
export function physicsStep(st, dt, events) {
  const body = BODIES[st.body];
  const rmag = st.pos.length();
  const up = tmp1.copy(st.pos).divideScalar(rmag);
  const alt = rmag - body.radius;
  const terrainH = alt < 95_000 ? heightAt(st.body, up) : 0;

  st.geom = stackGeometry(st.parts);
  st.sections = computeSections(st.parts);
  const mp = massProps(st.parts, st.geom);
  const copY = centerOfPressure(st.parts, st.geom);
  st.massProps = mp;

  const noseWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(st.quat);
  const clearance = mp.comY * THREE.MathUtils.clamp(noseWorld.dot(up), 0.25, 1);
  const agl = alt - terrainH - clearance;

  const rho = density(st.body, alt);
  const press = pressureAtm(st.body, alt);
  const speed = st.vel.length();
  const qDyn = 0.5 * rho * speed * speed;

  // ---- engines ----
  const { thrust, perEngine } = burn(st.parts, st.sections, dt, st.throttle, press);
  const thrustAcc = new THREE.Vector3().copy(noseWorld).multiplyScalar(thrust / Math.max(1, mp.m));

  // ---- drag ----
  const dragF = new THREE.Vector3();
  if (rho > 0 && speed > 0.01) {
    const cda = (mp.dragArea * 0.8 + mp.chuteArea);
    dragF.copy(st.vel).multiplyScalar(-qDyn * cda / speed);
  }
  const extAcc = new THREE.Vector3().copy(thrustAcc).addScaledVector(dragF, 1 / Math.max(1, mp.m));

  // ---- attitude ----
  if (!st.landed) {
    stepAttitude(st, dt, { mp, copY, qDyn, press, thrust, perEngine, dragF, noseWorld, up });
  }

  // ---- translation ----
  let crashed = null;
  if (!st.landed) {
    rk4(st.pos, st.vel, body.mu, extAcc, dt);

    // ground contact
    const r2 = st.pos.length();
    const up2 = tmp2.copy(st.pos).divideScalar(r2);
    const th2 = (r2 - body.radius) < 95_000 ? heightAt(st.body, up2) : 0;
    if (r2 - body.radius - th2 - clearance <= 0 && st.vel.dot(up2) <= 0) {
      const impact = st.vel.length();
      const legsOK = st.parts.some((p) => p.alive && p.def.legs && p.legsDown);
      const limit = legsOK ? 12 : 6;
      st.pos.copy(up2).multiplyScalar(body.radius + th2 + clearance);
      st.vel.set(0, 0, 0);
      st.angVel.set(0, 0, 0);
      if (impact <= limit) {
        st.landed = true;
        events.push({ type: 'landed', speed: impact, water: st.body === 'kerbin' && th2 <= 1 });
      } else {
        crashed = impact;
      }
    }
  } else {
    // sitting on the ground: lift off if thrust beats gravity
    const g = body.mu / (rmag * rmag);
    if (thrustAcc.dot(up) > g * 1.005) {
      st.landed = false;
      st.vel.copy(up).multiplyScalar(0.5);
      events.push({ type: 'liftoff' });
    }
  }

  // ---- heating ----
  const flux = heatingFlux(rho, speed);
  let maxTempFrac = 0;
  if (st.parts.length) {
    // windward extremity: travelling nose-first heats the top, tail-first the bottom
    const velDir = speed > 1 ? tmp3.copy(st.vel).divideScalar(speed) : tmp3.set(0, 0, 0);
    const noseFirst = velDir.dot(noseWorld) > 0;
    const stackAlive = st.parts.filter((p) => p.alive && p.kind === 'stack');
    let windward = null;
    if (stackAlive.length) {
      windward = stackAlive.reduce((a, b) =>
        (noseFirst ? partY(st.geom, a) > partY(st.geom, b) : partY(st.geom, a) < partY(st.geom, b)) ? a : b);
    }
    for (const p of st.parts) {
      if (!p.alive) continue;
      const exposure = p === windward ? 1.0 : 0.12;
      const thermalMass = Math.max(50, p.def.mass * p.sym + p.fuel * 0.5);
      let rate = (flux * exposure * 5) / thermalMass - coolingRate(p.temp, rho);
      p.temp += rate * dt;
      if (p.temp < 4) p.temp = 4;
      // ablative shield holds 1600 K while ablator lasts
      if (p.def.shield && p.ablator > 0 && p.temp > 1600) {
        p.ablator = Math.max(0, p.ablator - flux * 2e-4 * dt);
        p.temp = 1600;
      }
      maxTempFrac = Math.max(maxTempFrac, p.temp / p.def.maxTemp);
      if (p.temp > p.def.maxTemp) {
        p.alive = false;
        events.push({ type: 'overheat', part: p });
        if (p.def.pod) crashed = crashed ?? speed;
      }
    }
  }

  // ---- parachutes ----
  for (const p of st.parts) {
    if (!p.alive || !p.def.chute) continue;
    if (p.chuteState === 'armed' && press > 0.05 && agl < 2500 && speed < 300) {
      p.chuteState = 'deployed';
      events.push({ type: 'chute', part: p });
    }
    if (p.chuteState === 'deployed' && speed > 330) {
      p.chuteState = 'cut'; p.alive = false;
      events.push({ type: 'chute-torn', part: p });
    }
  }

  // ---- SOI transitions ----
  if (!st.landed) checkSOI(st, events);

  if (crashed !== null) events.push({ type: 'crashed', speed: crashed });

  return {
    thrust, perEngine, rho, press, qDyn, alt, agl, terrainH,
    speed, flux, maxTempFrac,
    accelG: extAcc.length() / 9.81,
    plasma: Math.min(1, flux / 800),
  };
}

function stepAttitude(st, dt, env) {
  const { mp, copY, qDyn, thrust, noseWorld } = env;

  // control authority (N*m): reaction wheels + engine gimbal + fins
  let gimbalT = 0;
  for (const p of st.parts) {
    if (!p.alive || !p.def.engine || !p.def.engine.gimbal) continue;
    const f = env.perEngine.get(p.key) ?? 0;
    gimbalT += f * Math.sin((p.def.engine.gimbal * Math.PI) / 180) * Math.abs(partY(st.geom, p) - mp.comY);
  }
  const finT = mp.finArea * qDyn * 0.012 * Math.max(1, mp.comY * 0.6);
  const avail = mp.podTorque + gimbalT + finT;

  const torque = new THREE.Vector3();

  // pilot input (body axes: x pitch, z yaw... we use world-projected ship axes)
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(st.quat);
  const fwdRoll = noseWorld;
  const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(st.quat);
  const c = st.controls;
  const hasInput = c.pitch !== 0 || c.yaw !== 0 || c.roll !== 0;
  if (hasInput) {
    torque.addScaledVector(right, c.pitch * avail);
    torque.addScaledVector(zAxis, c.yaw * avail);
    torque.addScaledVector(fwdRoll, c.roll * avail * 0.4);
    st.sasTarget.copy(st.quat); // retarget while steering
  } else if (st.sas) {
    sasTorque(st, avail, mp, torque, noseWorld);
  }

  // aerodynamic restoring torque: drag acts at the centre of pressure
  if (qDyn > 1) {
    const lever = tmp2.copy(noseWorld).multiplyScalar(copY - mp.comY);
    torque.add(tmp3.crossVectors(lever, env.dragF));
  }

  st.angVel.addScaledVector(torque, dt / mp.iTrans);
  // damping: structural + aero
  const damp = Math.min(0.95, (0.4 + qDyn * 2e-4) * dt);
  st.angVel.multiplyScalar(1 - damp);

  const w = st.angVel.length();
  if (w > 1e-7) {
    const dq = new THREE.Quaternion().setFromAxisAngle(tmp2.copy(st.angVel).divideScalar(w), w * dt);
    st.quat.premultiply(dq).normalize();
  }
}

function sasTorque(st, avail, mp, torque, noseWorld) {
  let targetQ = st.sasTarget;
  if (st.sasMode === 'prograde' || st.sasMode === 'retrograde') {
    const dir = st.vel.clone();
    if (dir.lengthSq() < 4) return;
    dir.normalize();
    if (st.sasMode === 'retrograde') dir.negate();
    const dq = new THREE.Quaternion().setFromUnitVectors(noseWorld, dir);
    targetQ = dq.multiply(st.quat); // minimal rotation aligning nose to dir
  }
  // error quaternion -> axis-angle PD
  const err = targetQ.clone().multiply(st.quat.clone().invert());
  let angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(err.w), -1, 1));
  if (angle < 1e-5) {
    torque.addScaledVector(st.angVel, -2.5 * mp.iTrans);
    return;
  }
  const axis = new THREE.Vector3(err.x, err.y, err.z);
  if (err.w < 0) axis.negate();
  axis.normalize();
  const cmd = axis.multiplyScalar(angle * 1.4 * mp.iTrans)
    .addScaledVector(st.angVel, -2.4 * mp.iTrans);
  cmd.clampLength(0, avail);
  torque.add(cmd);
}

function rk4(pos, vel, mu, aExt, dt) {
  const acc = (p, out) => out.copy(p).multiplyScalar(-mu / Math.pow(p.length(), 3)).add(aExt);
  const k1v = acc(pos, new THREE.Vector3());
  const k1r = vel.clone();
  const k2v = acc(tmp1.copy(pos).addScaledVector(k1r, dt / 2), new THREE.Vector3());
  const k2r = vel.clone().addScaledVector(k1v, dt / 2);
  const k3v = acc(tmp1.copy(pos).addScaledVector(k2r, dt / 2), new THREE.Vector3());
  const k3r = vel.clone().addScaledVector(k2v, dt / 2);
  const k4v = acc(tmp1.copy(pos).addScaledVector(k3r, dt), new THREE.Vector3());
  const k4r = vel.clone().addScaledVector(k3v, dt);
  pos.addScaledVector(k1r.add(k2r.multiplyScalar(2)).add(k3r.multiplyScalar(2)).add(k4r), dt / 6);
  vel.addScaledVector(k1v.add(k2v.multiplyScalar(2)).add(k3v.multiplyScalar(2)).add(k4v), dt / 6);
}

export function checkSOI(st, events) {
  if (st.body === 'kerbin') {
    const mun = getBodyState('mun', st.t);
    if (st.pos.distanceTo(mun.pos) < BODIES.mun.soi) {
      st.pos.sub(mun.pos);
      st.vel.sub(mun.vel);
      st.body = 'mun';
      events.push({ type: 'soi', body: 'mun' });
    }
  } else if (st.body === 'mun') {
    if (st.pos.length() > BODIES.mun.soi) {
      const mun = getBodyState('mun', st.t);
      st.pos.add(mun.pos);
      st.vel.add(mun.vel);
      st.body = 'kerbin';
      events.push({ type: 'soi', body: 'kerbin' });
    }
  }
}

// ---------------------------------------------------------------------------
// Debris: cheap ballistic objects (jettisoned stages, boosters)
// ---------------------------------------------------------------------------

export function stepDebris(d, dt) {
  const body = BODIES[d.body];
  const rho = density(d.body, d.pos.length() - body.radius);
  const sp = d.vel.length();
  const aExt = tmp1.set(0, 0, 0);
  if (rho > 0 && sp > 0.01) {
    aExt.copy(d.vel).multiplyScalar(-0.5 * rho * sp * d.cda / d.mass);
  }
  rk4(d.pos, d.vel, body.mu, aExt, dt);
  d.spin += dt;
  const r = d.pos.length();
  const up = tmp2.copy(d.pos).divideScalar(r);
  const alt = r - body.radius;
  if (alt < 95_000 && alt - heightAt(d.body, up) < 2) d.dead = true;
}
