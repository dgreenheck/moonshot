// Browser smoke test: boots the app in system Chrome, exercises the VAB and a
// launch, captures console errors and screenshots.
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5199 } });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log('serving at', url);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`));

await page.goto(url);
await page.waitForTimeout(4500);

const backend = await page.evaluate(() => navigator.gpu ? 'webgpu-available' : 'no-webgpu');
console.log('GPU:', backend);

// VAB: load stock Mun rocket
await page.click('#btn-stock-mun');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/shot-1-vab.png' });
const stats = await page.textContent('#craft-stats');
console.log('VAB stats:', stats.replace(/\s+/g, ' ').slice(0, 160));

// Launch
await page.click('#btn-launch');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/shot-2-pad.png' });

// Ignite (stage) and fly for a bit at full throttle
await page.keyboard.press('Space');
await page.waitForTimeout(6000);
await page.screenshot({ path: 'scripts/shot-3-ascent.png' });
const alt = await page.textContent('#ro-alt');
const spd = await page.textContent('#ro-speed');
const sit = await page.textContent('#situation');
console.log('After 6s burn:', alt, '|', spd, '|', sit);

// Stage: drop the boosters, verify they separate visually
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/shot-5-staged.png' });

// Map view
await page.keyboard.press('KeyM');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/shot-4-map.png' });
await page.keyboard.press('KeyM');

// time warp x2 then revert
await page.keyboard.press('Period');
await page.waitForTimeout(1000);

console.log('\nConsole errors:', errors.length);
for (const e of errors.slice(0, 12)) console.log('  •', e.slice(0, 300));

// browser.close() can wedge with WebGPU — don't let teardown hang the run
await Promise.race([
  (async () => { await browser.close(); await server.close(); })(),
  new Promise((r) => setTimeout(r, 5000)),
]);
process.exit(errors.length ? 1 : 0);
