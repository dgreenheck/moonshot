// DOM HUD: readouts, stage list, orbit panel, messages, banners, endcard.

import { fmtTime, fmtDist, BODIES } from './constants.js';
import { PARTS } from './parts.js';
import { feedTanks } from './vessel.js';

const $ = (id) => document.getElementById(id);

export const HUD = {
  setMET(t) { $('met').textContent = `T+ ${fmtTime(t)}`; },

  setSituation(text) { $('situation').textContent = text; },

  setWarp(w, rails) {
    $('warp-display').textContent = `WARP ${w}×${rails ? ' (rails)' : ''}`;
    $('warp-display').style.color = w > 1 ? '#ffd479' : '#7e93b0';
  },

  setThrottle(t) { $('throttle-fill').style.height = `${(t * 100).toFixed(0)}%`; },

  setSAS(on, mode) {
    $('sas-ind').classList.toggle('on', on);
    $('sas-mode-ind').textContent = { hold: 'HOLD', prograde: 'PRO ▲', retrograde: 'RETRO ▼' }[mode] ?? '';
  },

  readouts(info, st, vspeed) {
    $('ro-alt').textContent = `ALT ${fmtDist(Math.max(0, info.alt))}`;
    $('ro-agl').textContent = `AGL ${fmtDist(Math.max(0, info.agl))}`;
    $('ro-vspeed').textContent = `VSPD ${vspeed >= 0 ? '+' : ''}${vspeed.toFixed(1)} m/s`;
    $('ro-accel').textContent = `ACC ${info.accelG.toFixed(1)} g`;
    $('ro-speed').textContent = `${info.alt > 60_000 ? 'ORB' : 'SRF'} ${info.speed.toFixed(info.speed < 100 ? 1 : 0)} m/s`;
    $('ro-mode').textContent = info.alt > 60_000 ? 'orbital velocity' : 'surface velocity';
    $('ro-mass').textContent = `MASS ${(st.massProps.m / 1000).toFixed(2)} t`;
    const tf = info.maxTempFrac;
    const el = $('ro-temp');
    if (tf > 0.85) { el.textContent = 'TEMP CRITICAL'; el.style.color = '#ff5040'; }
    else if (tf > 0.6) { el.textContent = 'TEMP HIGH'; el.style.color = '#ffae42'; }
    else { el.textContent = 'TEMP OK'; el.style.color = '#5d7088'; }
  },

  /** Stage list + fuel bars. */
  stages(plan, stageIndex, parts, sections) {
    const list = $('stage-list');
    list.innerHTML = plan.map((ev, i) => {
      const cls = i < stageIndex ? 'spent' : i === stageIndex ? 'current' : '';
      const names = [
        ...ev.ignite.map((k) => parts.find((p) => p.key === k)?.def.name).filter(Boolean),
        ev.decouple !== null ? 'decouple' : null,
        ev.dropRadials.length ? 'drop boosters' : null,
        ev.chutes ? 'parachutes' : null,
      ].filter(Boolean).join(', ');
      return `<div class="stage-block ${cls}"><span class="sname">S${plan.length - 1 - i}</span> ${names || ev.label}</div>`;
    }).join('');

    // one gauge per tank, top-to-bottom; tanks feeding a lit engine highlighted
    const litSections = new Set();
    for (const ep of parts) {
      if (ep.alive && ep.ignited && ep.def.engine && !ep.def.engine.srb) {
        for (const t of feedTanks(parts, sections, ep)) litSections.add(t.key);
      }
    }
    const tanks = parts
      .filter((p) => p.alive && p.def.fuel)
      .sort((a, b) => a.stackIndex - b.stackIndex);
    $('resource-bars').innerHTML = tanks.map((t) => {
      const cap = t.def.fuel * t.sym;
      const active = litSections.has(t.key) || (t.def.engine?.srb && t.ignited && t.fuel > 0);
      const label = t.def.engine?.srb ? `${t.def.name} ×${t.sym}` : t.def.name;
      return `
      <div class="bar-row${active ? '' : ' inactive'}">
        <div class="bar-label"><span>${active ? '▶ ' : ''}${label}</span><span>${t.fuel.toFixed(0)} kg</span></div>
        <div class="bar-track"><div class="bar-fill ${t.def.engine?.srb ? '' : 'fuel'}" style="width:${(100 * t.fuel / Math.max(1, cap)).toFixed(1)}%"></div></div>
      </div>`;
    }).join('');
  },

  orbit(st, els, extra) {
    $('orbit-title').textContent = `ORBIT — ${BODIES[st.body].name.toUpperCase()}`;
    const R = BODIES[st.body].radius;
    const rows = [];
    const row = (k, v) => rows.push(`<div><span class="k">${k}</span>${v}</div>`);
    if (els) {
      row('Apoapsis', els.a > 0 ? fmtDist(els.ra - R) : '—');
      row('Periapsis', fmtDist(els.rp - R));
      if (extra.tAp !== null && isFinite(extra.tAp)) row('Time to Ap', fmtTime(extra.tAp));
      if (isFinite(extra.tPe)) row('Time to Pe', fmtTime(extra.tPe));
      row('Eccentricity', els.e.toFixed(3));
      if (els.period) row('Period', fmtTime(els.period));
      row('Inclination', `${(Math.acos(Math.min(1, Math.abs(els.what.y))) * 180 / Math.PI).toFixed(1)}°`);
    }
    if (extra.phase !== null) {
      row('Mun phase ∠', `${extra.phase.toFixed(1)}° <span class="dim">(burn at ${extra.transferPhase.toFixed(0)}°)</span>`);
    }
    if (extra.encounter) {
      row('— MUN ENCOUNTER —', '');
      row('SOI entry in', fmtTime(extra.encounter.tEnter - st.t));
      row('Mun periapsis', fmtDist(extra.encounter.munPeriapsis));
    }
    $('orbit-data').innerHTML = rows.join('');
  },

  msg(text, cls = '') {
    const log = $('msglog');
    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    div.textContent = text;
    log.appendChild(div);
    while (log.children.length > 6) log.removeChild(log.firstChild);
    setTimeout(() => div.classList.add('fade'), 3500);
    setTimeout(() => div.remove(), 5000);
  },

  banner(text, ms = 4200) {
    const b = $('banner');
    b.textContent = text;
    b.classList.remove('hidden');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.add('hidden'), ms);
  },

  endcard(title, text, good = false) {
    $('endcard-title').textContent = title;
    $('endcard-title').className = good ? 'good' : '';
    $('endcard-text').innerHTML = text;
    $('endcard').classList.remove('hidden');
  },

  hideEndcard() { $('endcard').classList.add('hidden'); },

  toggleHelp(force) {
    const h = $('help');
    const show = force ?? h.classList.contains('hidden');
    h.classList.toggle('hidden', !show);
  },
};
