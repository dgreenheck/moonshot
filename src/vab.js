// Vehicle Assembly Building: palette, stack/radial editing, staging stats,
// craft save/load, stock craft, 3D preview.

import * as THREE from 'three/webgpu';
import { PARTS, CATEGORIES, RADIAL_PARTS, partInfoHTML } from './parts.js';
import { buildVesselParts, stagingStats, stackGeometry } from './vessel.js';
import { buildVesselGroup, setLegs } from './vesselviz.js';
import { STOCK } from './stock.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'moonshot-crafts';

export class VAB {
  /** ctx: { scene, camera, onLaunch } — scene/camera owned by main. */
  constructor(ctx) {
    this.ctx = ctx;
    this.design = { name: 'Untitled Craft', stack: [], radials: [] };
    this.selected = -1;       // selected stack index
    this.group = null;
    this.activeCategory = 'Pods';
    this.buildUI();
  }

  buildUI() {
    const tabs = $('palette-tabs');
    for (const cat of CATEGORIES) {
      const b = document.createElement('button');
      b.textContent = cat;
      b.onclick = () => { this.activeCategory = cat; this.renderPalette(); };
      tabs.appendChild(b);
    }
    this.renderPalette();

    const radialSel = $('radial-part');
    for (const id of RADIAL_PARTS) {
      const o = document.createElement('option');
      o.value = id; o.textContent = PARTS[id].name;
      radialSel.appendChild(o);
    }

    $('btn-radial-add').onclick = () => this.addRadial();
    $('btn-clear').onclick = () => { this.design = { name: this.design.name, stack: [], radials: [] }; this.refresh(); };
    $('btn-save').onclick = () => this.save();
    $('load-select').onchange = (e) => { if (e.target.value) this.load(e.target.value); };
    $('btn-stock-hopper').onclick = () => this.loadStock('Suborbital Hopper');
    $('btn-stock-mun').onclick = () => this.loadStock('Mun Express');
    $('btn-launch').onclick = () => this.launch();
    $('craft-name').oninput = (e) => { this.design.name = e.target.value || 'Untitled Craft'; };
    this.refreshLoadList();
  }

  renderPalette() {
    [...$('palette-tabs').children].forEach((b) =>
      b.classList.toggle('active', b.textContent === this.activeCategory));
    const pal = $('palette');
    pal.innerHTML = '';
    for (const [id, def] of Object.entries(PARTS)) {
      if (def.category !== this.activeCategory) continue;
      const b = document.createElement('button');
      b.className = 'part-btn';
      const meta = def.engine
        ? `${(def.engine.thrustVac / 1000).toFixed(0)} kN · Isp ${def.engine.ispVac}s`
        : def.fuel ? `${def.fuel} kg fuel` : `${(def.mass / 1000).toFixed(2)} t`;
      b.innerHTML = `<span class="pname">${def.name}</span><span class="pmeta">${def.size} m · ${meta}</span>`;
      b.onmouseenter = () => { $('part-info').innerHTML = partInfoHTML(def); };
      b.onclick = () => this.addStackPart(id);
      pal.appendChild(b);
    }
  }

  addStackPart(id) {
    if (PARTS[id].radial && !PARTS[id].decoupler) {
      // radial-only parts can't go in the stack (except none currently)
      if (id === 'srb' || id === 'fins' || id === 'legs') {
        $('part-info').innerHTML = `<b>${PARTS[id].name}</b> is radial-attach: select a stack part and use Radial Attach.`;
        return;
      }
    }
    const at = this.selected >= 0 ? this.selected + 1 : this.design.stack.length;
    this.design.stack.splice(at, 0, id);
    // shift radial hosts below the insertion point
    for (const r of this.design.radials) if (r.host >= at) r.host++;
    this.selected = at;
    this.refresh();
  }

  addRadial() {
    if (this.selected < 0 || !this.design.stack[this.selected]) {
      $('part-info').innerHTML = 'Select a stack part first.';
      return;
    }
    const part = $('radial-part').value;
    // legs/fins are already full ×4 sets — symmetry doesn't apply
    const sym = (PARTS[part].fins || PARTS[part].legs) ? 1 : parseInt($('radial-sym').value, 10);
    this.design.radials.push({ part, sym, host: this.selected });
    this.refresh();
  }

  removeStackPart(i) {
    this.design.stack.splice(i, 1);
    this.design.radials = this.design.radials.filter((r) => r.host !== i);
    for (const r of this.design.radials) if (r.host > i) r.host--;
    if (this.selected >= this.design.stack.length) this.selected = this.design.stack.length - 1;
    this.refresh();
  }

  moveStackPart(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.design.stack.length) return;
    const s = this.design.stack;
    [s[i], s[j]] = [s[j], s[i]];
    for (const r of this.design.radials) {
      if (r.host === i) r.host = j;
      else if (r.host === j) r.host = i;
    }
    this.selected = j;
    this.refresh();
  }

  refresh() {
    this.renderStackList();
    this.renderStats();
    this.rebuildPreview();
  }

  renderStackList() {
    const list = $('stack-list');
    list.innerHTML = '';
    if (!this.design.stack.length) {
      list.innerHTML = '<div class="dim">Empty. Add a pod from the palette — the stack builds top-down.</div>';
      return;
    }
    this.design.stack.forEach((id, i) => {
      const item = document.createElement('div');
      item.className = 'stack-item' + (i === this.selected ? ' selected' : '');
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = PARTS[id].name;
      item.appendChild(name);
      for (const [sym, fn] of [['↑', () => this.moveStackPart(i, -1)], ['↓', () => this.moveStackPart(i, 1)], ['✕', () => this.removeStackPart(i)]]) {
        const b = document.createElement('button');
        b.textContent = sym;
        b.onclick = (e) => { e.stopPropagation(); fn(); };
        item.appendChild(b);
      }
      item.onclick = () => { this.selected = i; this.renderStackList(); };
      list.appendChild(item);

      this.design.radials.forEach((r, ri) => {
        if (r.host !== i) return;
        const rl = document.createElement('div');
        rl.className = 'stack-item radial';
        const rn = document.createElement('span');
        rn.className = 'pname';
        rn.textContent = `${PARTS[r.part].name} ×${r.sym}`;
        rl.appendChild(rn);
        const del = document.createElement('button');
        del.textContent = '✕';
        del.onclick = () => { this.design.radials.splice(ri, 1); this.refresh(); };
        rl.appendChild(del);
        list.appendChild(rl);
      });
    });
  }

  renderStats() {
    const stats = stagingStats(this.design);
    $('stage-stats').innerHTML = stats.length
      ? stats.map((s, i) => `
        <div class="stage-block">
          <span class="sname">Stage ${stats.length - i}</span> — ${s.label}<br>
          Δv <b>${s.dv.toFixed(0)} m/s</b> · TWR ${s.twrSL.toFixed(2)} SL / ${s.twrVac.toFixed(2)} vac<br>
          <span class="dim">burn ${s.burnTime.toFixed(0)} s · ${(s.wet / 1000).toFixed(1)} t wet</span>
        </div>`).join('')
      : '<div class="dim">No engines staged yet.</div>';

    const parts = buildVesselParts(this.design);
    const geom = stackGeometry(parts);
    const wet = parts.reduce((s, p) => s + p.def.mass * p.sym + p.fuel + (p.ablator || 0), 0);
    const totalDv = stats.reduce((s, x) => s + x.dv, 0);
    $('craft-stats').innerHTML =
      `Parts ${parts.length} · Height ${geom.totalLength.toFixed(1)} m · Mass <b>${(wet / 1000).toFixed(2)} t</b><br>` +
      `Total Δv (vac): <b>${totalDv.toFixed(0)} m/s</b><br>` +
      `<span class="dim">Mun round trip needs roughly 5,800–7,000 m/s and pad TWR > 1.2</span>`;
  }

  rebuildPreview() {
    const { scene } = this.ctx;
    if (this.group) scene.remove(this.group);
    const parts = buildVesselParts(this.design);
    const { group, meshByKey } = buildVesselGroup(parts);
    setLegs(meshByKey, parts, true);
    this.group = group;
    scene.add(group);
    const h = group.userData.geom.totalLength;
    this.ctx.frame(h); // let main position the camera for a rocket of height h
  }

  save() {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    all[this.design.name] = this.design;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    this.refreshLoadList();
    $('part-info').textContent = `Saved “${this.design.name}”.`;
  }

  refreshLoadList() {
    const sel = $('load-select');
    while (sel.options.length > 1) sel.remove(1);
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    for (const name of Object.keys(all)) {
      const o = document.createElement('option');
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    }
  }

  load(name) {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (!all[name]) return;
    this.design = all[name];
    this.design.radials ??= [];
    $('craft-name').value = this.design.name;
    this.selected = -1;
    this.refresh();
  }

  loadStock(name) {
    this.design = structuredClone(STOCK[name]);
    this.design.name = name;
    $('craft-name').value = name;
    this.selected = -1;
    this.refresh();
  }

  launch() {
    const parts = buildVesselParts(this.design);
    if (!parts.some((p) => p.def.pod)) {
      $('part-info').innerHTML = '<b style="color:#ff8d7e">No command pod!</b> Add one or the rocket has no one to fly it.';
      return;
    }
    if (!parts.some((p) => p.def.engine)) {
      $('part-info').innerHTML = '<b style="color:#ff8d7e">No engines.</b> Gravity wins by default.';
      return;
    }
    this.ctx.onLaunch(structuredClone(this.design));
  }

  show() {
    $('vab').classList.remove('hidden');
    if (!this.group) this.refresh();
  }

  hide() { $('vab').classList.add('hidden'); }
}
