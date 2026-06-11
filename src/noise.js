// Tiny deterministic 3D value noise + fbm, used for terrain heightfields
// (CPU side: collision + meshes + planet textures must all agree).

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647 ^ 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const sm = (t) => t * t * (3 - 2 * t);

export function valueNoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz);
  let r = 0;
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        r += w * hash3(ix + dx, iy + dy, iz + dz);
      }
  return r; // 0..1
}

export function fbm3(x, y, z, octaves = 4) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x, y, z);
    norm += amp;
    x = x * 2.03 + 13.7; y = y * 2.01 + 7.3; z = z * 1.99 + 3.1;
    amp *= 0.5;
  }
  return sum / norm; // 0..1
}
