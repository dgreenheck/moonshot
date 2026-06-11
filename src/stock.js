// Stock craft designs. Stack index 0 = top.

export const STOCK = {
  'Suborbital Hopper': {
    stack: ['chute', 'pod-mk1', 'heat-shield', 'decoupler-s', 'tank-m', 'eng-falcon'],
    radials: [{ part: 'fins', sym: 1, host: 5 }],
  },
  'Mun Express': {
    stack: [
      'chute', 'pod-mk1', 'tank-s', 'eng-kestrel',                 // lander/return stage
      'decoupler-s', 'tank-l', 'tank-m', 'eng-sparrow',            // transfer + landing stage
      'decoupler-s', 'tank-l', 'tank-l', 'eng-falcon',             // launch stage
    ],
    radials: [
      { part: 'legs', sym: 1, host: 2 },   // legs/fins are already ×4 sets
      { part: 'srb', sym: 3, host: 10 },
      { part: 'fins', sym: 1, host: 10 },
    ],
  },
};
