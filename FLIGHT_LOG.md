# MOONSHOT — Mission Flight Log

**Craft:** Mun Express (stock) · **Pilot:** autopilot (`tests/mission.test.mjs`) · **Physics:** live game engine, headless
**Result:** 🌕 mission complete — soft landing on the Mun

## Events

```text
T+00:00:00   PRELAUNCH     Mun Express on the pad — liftoff mass 32.43 t, 5 stages
T+00:00:00   STAGE 1       Ignition — ignite F-30 "Falcon" + SRB-30 Booster
T+00:00:00   LIFTOFF       Vehicle has cleared the pad
T+00:00:30   STAGE 2       Drop boosters (boosters away)
T+00:01:53   STAGE 3       Decouple + ignite — ignite S-7 "Sparrow" (lower stack jettisoned)
T+00:05:22   MECO / ORBIT  Stable orbit 72 × 90 km
T+00:33:36   XFER WINDOW   Mun phase angle 111.4° (target 110.8°) — TLI burn start
T+00:34:43   TLI CUTOFF    Trans-Munar injection complete — predicted Mun periapsis 2060 km
T+07:58:18   SOI           Entered Mun sphere of influence (on-rails coast)
T+08:40:09   MOI           Mun orbit insertion — 27 × 2060 km
T+13:24:15   PDI           Powered descent initiation — alt 27.0 km, velocity 722 m/s
T+13:24:56   STAGE 4       Decouple + ignite — ignite K-1 "Kestrel" (lower stack jettisoned)
T+13:31:32   TOUCHDOWN     Contact at 3.72 m/s — the Mun
T+13:31:32   MISSION END   The Mun. Pod intact, 307 kg of liquid fuel in reserve for the trip home.
```

## Telemetry

Sampled every 15 s under thrust, every 15 min on coasts.

| MET | Body | Altitude | Velocity | Mass | Liquid fuel | Throttle |
|---|---|--:|--:|--:|--:|--:|
| T+00:00:00 | Kerbin | 57 m | 1 m/s | 32.41 t | 14496 kg | 100% |
| T+00:00:15 | Kerbin | 1.71 km | 224 m/s | 26.17 t | 13436 kg | 100% |
| T+00:00:30 | Kerbin | 6.82 km | 480 m/s | 19.93 t | 12375 kg | 100% |
| T+00:00:45 | Kerbin | 13.5 km | 456 m/s | 16.49 t | 11310 kg | 100% |
| T+00:01:00 | Kerbin | 20.1 km | 499 m/s | 15.43 t | 10246 kg | 100% |
| T+00:01:15 | Kerbin | 27.4 km | 582 m/s | 14.36 t | 9182 kg | 100% |
| T+00:01:30 | Kerbin | 35.6 km | 696 m/s | 13.30 t | 8117 kg | 100% |
| T+00:01:45 | Kerbin | 45.1 km | 842 m/s | 12.23 t | 7053 kg | 100% |
| T+00:02:00 | Kerbin | 55.3 km | 902 m/s | 8.92 t | 6372 kg | 100% |
| T+00:02:15 | Kerbin | 63.9 km | 894 m/s | 8.66 t | 6106 kg | 100% |
| T+00:02:30 | Kerbin | 70.9 km | 917 m/s | 8.39 t | 5840 kg | 100% |
| T+00:02:45 | Kerbin | 76.1 km | 967 m/s | 8.12 t | 5574 kg | 100% |
| T+00:03:00 | Kerbin | 79.8 km | 1045 m/s | 7.86 t | 5308 kg | 100% |
| T+00:03:15 | Kerbin | 82.2 km | 1144 m/s | 7.59 t | 5042 kg | 100% |
| T+00:03:30 | Kerbin | 83.8 km | 1251 m/s | 7.33 t | 4776 kg | 100% |
| T+00:03:45 | Kerbin | 84.8 km | 1363 m/s | 7.06 t | 4510 kg | 100% |
| T+00:04:00 | Kerbin | 85.5 km | 1478 m/s | 6.79 t | 4244 kg | 100% |
| T+00:04:15 | Kerbin | 86.2 km | 1598 m/s | 6.53 t | 3978 kg | 100% |
| T+00:04:30 | Kerbin | 86.9 km | 1725 m/s | 6.26 t | 3712 kg | 100% |
| T+00:04:45 | Kerbin | 87.6 km | 1862 m/s | 6.00 t | 3446 kg | 100% |
| T+00:05:00 | Kerbin | 88.4 km | 2010 m/s | 5.73 t | 3180 kg | 100% |
| T+00:05:15 | Kerbin | 89.0 km | 2169 m/s | 5.46 t | 2914 kg | 100% |
| T+00:20:16 | Kerbin | 73.1 km | 2303 m/s | 5.33 t | 2782 kg | 0% |
| T+00:33:36 | Kerbin | 85.6 km | 2262 m/s | 5.33 t | 2781 kg | 100% |
| T+00:33:51 | Kerbin | 86.0 km | 2434 m/s | 5.06 t | 2514 kg | 100% |
| T+00:34:06 | Kerbin | 86.8 km | 2615 m/s | 4.80 t | 2247 kg | 100% |
| T+00:34:21 | Kerbin | 88.1 km | 2805 m/s | 4.53 t | 1981 kg | 100% |
| T+00:34:36 | Kerbin | 90.5 km | 3003 m/s | 4.27 t | 1715 kg | 100% |
| T+00:49:38 | Kerbin | 1.22 Mm | 1804 m/s | 4.15 t | 1596 kg | 0% |
| T+01:04:38 | Kerbin | 2.33 Mm | 1335 m/s | 4.15 t | 1596 kg | 0% |
| T+01:19:38 | Kerbin | 3.26 Mm | 1097 m/s | 4.15 t | 1596 kg | 0% |
| T+01:34:38 | Kerbin | 4.05 Mm | 944 m/s | 4.15 t | 1596 kg | 0% |
| T+01:49:38 | Kerbin | 4.75 Mm | 833 m/s | 4.15 t | 1596 kg | 0% |
| T+02:04:38 | Kerbin | 5.37 Mm | 746 m/s | 4.15 t | 1596 kg | 0% |
| T+02:19:43 | Kerbin | 5.94 Mm | 674 m/s | 4.15 t | 1596 kg | 0% |
| T+02:34:43 | Kerbin | 6.44 Mm | 614 m/s | 4.15 t | 1596 kg | 0% |
| T+02:49:43 | Kerbin | 6.90 Mm | 562 m/s | 4.15 t | 1596 kg | 0% |
| T+03:04:43 | Kerbin | 7.31 Mm | 516 m/s | 4.15 t | 1596 kg | 0% |
| T+03:19:43 | Kerbin | 7.69 Mm | 475 m/s | 4.15 t | 1596 kg | 0% |
| T+03:34:43 | Kerbin | 8.03 Mm | 438 m/s | 4.15 t | 1596 kg | 0% |
| T+03:49:43 | Kerbin | 8.34 Mm | 404 m/s | 4.15 t | 1596 kg | 0% |
| T+04:04:43 | Kerbin | 8.62 Mm | 374 m/s | 4.15 t | 1596 kg | 0% |
| T+04:19:43 | Kerbin | 8.87 Mm | 346 m/s | 4.15 t | 1596 kg | 0% |
| T+04:34:43 | Kerbin | 9.09 Mm | 320 m/s | 4.15 t | 1596 kg | 0% |
| T+04:49:43 | Kerbin | 9.29 Mm | 296 m/s | 4.15 t | 1596 kg | 0% |
| T+05:04:43 | Kerbin | 9.46 Mm | 275 m/s | 4.15 t | 1596 kg | 0% |
| T+05:19:43 | Kerbin | 9.61 Mm | 256 m/s | 4.15 t | 1596 kg | 0% |
| T+05:34:43 | Kerbin | 9.73 Mm | 240 m/s | 4.15 t | 1596 kg | 0% |
| T+05:49:43 | Kerbin | 9.83 Mm | 226 m/s | 4.15 t | 1596 kg | 0% |
| T+06:04:43 | Kerbin | 9.90 Mm | 215 m/s | 4.15 t | 1596 kg | 0% |
| T+06:19:43 | Kerbin | 9.95 Mm | 207 m/s | 4.15 t | 1596 kg | 0% |
| T+06:34:43 | Kerbin | 9.98 Mm | 203 m/s | 4.15 t | 1596 kg | 0% |
| T+06:49:43 | Kerbin | 9.99 Mm | 202 m/s | 4.15 t | 1596 kg | 0% |
| T+07:04:43 | Kerbin | 9.97 Mm | 204 m/s | 4.15 t | 1596 kg | 0% |
| T+07:19:43 | Kerbin | 9.94 Mm | 210 m/s | 4.15 t | 1596 kg | 0% |
| T+07:34:43 | Kerbin | 9.88 Mm | 219 m/s | 4.15 t | 1596 kg | 0% |
| T+07:49:43 | Kerbin | 9.79 Mm | 231 m/s | 4.15 t | 1596 kg | 0% |
| T+08:04:44 | the Mun | 2.18 Mm | 389 m/s | 4.15 t | 1596 kg | 0% |
| T+08:19:44 | the Mun | 2.10 Mm | 392 m/s | 4.15 t | 1596 kg | 0% |
| T+08:34:44 | the Mun | 2.06 Mm | 393 m/s | 4.15 t | 1596 kg | 0% |
| T+08:39:48 | the Mun | 2.06 Mm | 393 m/s | 4.15 t | 1596 kg | 100% |
| T+08:40:03 | the Mun | 2.06 Mm | 167 m/s | 3.88 t | 1329 kg | 100% |
| T+08:55:03 | the Mun | 2.06 Mm | 73 m/s | 3.77 t | 1221 kg | 0% |
| T+09:10:05 | the Mun | 2.04 Mm | 75 m/s | 3.77 t | 1221 kg | 0% |
| T+09:25:05 | the Mun | 2.02 Mm | 79 m/s | 3.77 t | 1221 kg | 0% |
| T+09:40:05 | the Mun | 1.99 Mm | 84 m/s | 3.77 t | 1221 kg | 0% |
| T+09:55:05 | the Mun | 1.95 Mm | 90 m/s | 3.77 t | 1221 kg | 0% |
| T+10:10:05 | the Mun | 1.90 Mm | 98 m/s | 3.77 t | 1221 kg | 0% |
| T+10:25:05 | the Mun | 1.85 Mm | 106 m/s | 3.77 t | 1221 kg | 0% |
| T+10:40:05 | the Mun | 1.78 Mm | 116 m/s | 3.77 t | 1221 kg | 0% |
| T+10:55:05 | the Mun | 1.70 Mm | 127 m/s | 3.77 t | 1221 kg | 0% |
| T+11:10:05 | the Mun | 1.61 Mm | 140 m/s | 3.77 t | 1221 kg | 0% |
| T+11:25:05 | the Mun | 1.51 Mm | 155 m/s | 3.77 t | 1221 kg | 0% |
| T+11:40:05 | the Mun | 1.39 Mm | 172 m/s | 3.77 t | 1221 kg | 0% |
| T+11:55:05 | the Mun | 1.26 Mm | 192 m/s | 3.77 t | 1221 kg | 0% |
| T+12:10:05 | the Mun | 1.11 Mm | 217 m/s | 3.77 t | 1221 kg | 0% |
| T+12:25:05 | the Mun | 940.4 km | 249 m/s | 3.77 t | 1221 kg | 0% |
| T+12:40:05 | the Mun | 743.7 km | 293 m/s | 3.77 t | 1221 kg | 0% |
| T+12:55:05 | the Mun | 513.3 km | 361 m/s | 3.77 t | 1221 kg | 0% |
| T+13:10:05 | the Mun | 240.8 km | 493 m/s | 3.77 t | 1221 kg | 0% |
| T+13:24:15 | the Mun | 27.0 km | 721 m/s | 3.77 t | 1221 kg | 100% |
| T+13:24:30 | the Mun | 27.3 km | 483 m/s | 3.50 t | 955 kg | 100% |
| T+13:24:45 | the Mun | 28.5 km | 244 m/s | 3.24 t | 689 kg | 100% |
| T+13:30:55 | the Mun | 6.47 km | 293 m/s | 1.74 t | 489 kg | 100% |
| T+13:31:10 | the Mun | 2.93 km | 179 m/s | 1.66 t | 414 kg | 100% |
| T+13:31:25 | the Mun | 1.16 km | 54 m/s | 1.59 t | 337 kg | 100% |
