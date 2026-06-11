# 🚀 MOONSHOT

A Kerbal Space Program–style game in the browser: build a rocket, launch it,
fly to orbit, transfer to the Mun, land, plant a metaphorical flag, and come
home. Built with **three.js WebGPU + TSL** (falls back to WebGL2), real
two-body orbital mechanics with patched conics, and zero asset files — every
texture and sound is procedural.

```bash
npm install
npm run dev        # open the printed URL (Chrome/Edge for WebGPU)
npm test           # orbital math vs. brute-force RK4 integration
npm run mission    # autopilot flies the stock rocket to a Mun landing, headless
```

## What's simulated

- **Vehicle assembly** — stack parts top-to-bottom, radial boosters with
  2/3/4/6× symmetry, auto-staging, per-stage **Δv / TWR / burn time** readouts
  (time-marching burn sim, handles SRB flameout properly), craft save/load.
- **Flight physics** — RK4 integration, thrust with Isp(pressure), exponential
  atmosphere, drag with a real center-of-pressure (fins keep you pointy-end
  first), reaction wheels + engine gimbal, SAS (hold / prograde / retrograde).
- **Orbital mechanics** — osculating Kepler elements, elliptic & hyperbolic
  analytic propagation, **sphere-of-influence transitions** (Kerbin ↔ Mun),
  Mun encounter prediction with periapsis readout, transfer phase-angle gauge.
- **Time warp** — physics warp to 4×, on-rails Kepler warp to 100,000×
  (engines off, out of atmosphere — the navball won't save you on rails).
- **Thermodynamics** — reentry heating on the windward part, part overheat
  destruction, ablative heat shields. Steep Mun returns without a shield are
  fatal; aim for a 30–50 km periapsis.
- **Staging & fuel flow** — decouplers split the rocket into sections,
  engines drain their own section's tanks, SRBs are self-contained, jettisoned
  stages become tumbling debris with their own ballistic + drag sim.
- **Landing** — procedural terrain on both bodies (the same height field
  drives collision, the local terrain mesh, and the planet texture), landing
  legs (≤12 m/s), parachutes for Kerbin, crash physics for everything else.
- **The cockpit** — navball with prograde/retrograde markers, altimeter,
  Ap/Pe/period/inclination, map view with orbit lines and encounter trajectory,
  procedural engine rumble and wind.

The whole solar system runs at KSP scale (Kerbin R=600 km, Mun at 12,000 km)
in double precision on the CPU, with a floating-origin renderer so nothing
jitters 12,000 km from home. The math is verified: `tests/orbits.test.mjs`
checks the Kepler solver against RK4 integration, and `tests/mission.test.mjs`
is an autopilot that flies the stock rocket through the *entire mission* —
ascent guidance, circularization, phase-angle transfer, SOI capture, powered
descent — using the same physics code the game runs.

## Controls

| Key | Action |
|---|---|
| `Space` | next stage |
| `Shift` / `Ctrl` | throttle up / down (`Z` full, `X` cut) |
| `W S A D Q E` | pitch / yaw / roll |
| `T` | SAS on/off · `1` hold · `2` prograde · `3` retrograde |
| `G` | landing legs |
| `P` | arm parachutes |
| `M` | map view |
| `,` / `.` | time warp |
| `H` | help |

## How to land on the Mun (stock "Mun Express")

1. **Launch** — `Space`, full throttle. At ~80 m/s start a gentle eastward tip
   (the navball's 90° meridian); follow prograde. Aim to be ~45° over by 12 km.
2. **Orbit** — cut engines when apoapsis (map view) reads ~80 km. Coast to Ap,
   burn prograde until periapsis leaves the atmosphere. ~75×75 km is lovely.
3. **Transfer** — watch *Mun phase ∠* in the orbit panel. When it ticks down to
   the *burn at* value (~117°), point prograde and burn until the map shows a
   Mun encounter; nudge until *Mun Pe* reads 15–30 km. Warp (`.`) to the SOI.
4. **Capture & land** — at Mun periapsis, burn retrograde until captured, keep
   burning to kill orbital speed. Deploy legs (`G`), SAS retrograde (`3`), and
   ride the throttle: keep speed under ~alt/15, touch down under 10 m/s.
5. **Home** — launch eastward into low Mun orbit, burn prograde on the
   Kerbin-facing side until you escape with a Kerbin periapsis of **30–45 km**.
   Warp home, arm chutes (`P`), and let the atmosphere do the rest.

## Not in v1 (deliberately)

Maneuver-node editor, docking/rendezvous, EVA, career mode, other planets,
planetary rotation. The orbital core supports more bodies — add an entry to
`BODIES` and a height function if you want Minmus.
