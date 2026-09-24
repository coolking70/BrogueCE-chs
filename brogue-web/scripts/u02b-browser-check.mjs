import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/u-02b-evidence';
const browser = await chromium.launch({ headless: false });
const errors = [], states = [];
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
 page.on('pageerror', e => errors.push(String(e)));
 page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
 await page.goto('http://127.0.0.1:5197');
 const input = page.locator('.menu-card input[type=text]').first();
 const actions = () => page.locator('.menu-card .actions').first().locator('button');
 for (const bad of ['18446744073709551616', '-1', '7junk', '1e3', '1.2']) {
  await input.fill(bad); assert.equal(await actions().first().isDisabled(), true);
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
 }
 for (const [index, seed] of ['1099511627783', '9007199254740993', '18446744073709551615'].entries()) {
  await input.fill(seed); assert.equal(await input.inputValue(), seed);
  assert.equal(await actions().first().isEnabled(), true);
  await actions().first().click();
  await page.waitForFunction(() => !!window.render_game_to_text && !!window.activeGame.onRenderRequested);
  await page.evaluate(async () => {
   const { rng, RNGType } = await import('/src/engine/Random.ts');
   window.activeGame.animationEnabled = false;
   window.activeGame.handlePlayerAction('wait');
   rng.setRNG(RNGType.RNG_COSMETIC); for (let i=0;i<51;i++) rng.randRange(0,99);
   rng.setRNG(RNGType.RNG_SUBSTANTIVE);
  });
  await page.locator('.menu-btn').click();
  await actions().nth(2).click();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('brogue-web-save-v1')));
  assert.equal(before.seed, seed); assert.equal(typeof before.seed, 'string');
  assert.ok((await page.locator('.save-meta').last().innerText()).includes(seed));
  await page.waitForTimeout(1000);
  await page.waitForTimeout(1000);
 await page.screenshot({path: `${dir}/browser-seed-${index}-saved.png`});
  await page.reload();
  assert.ok((await page.locator('.save-meta').last().innerText()).includes(seed));
  await actions().nth(1).click();
  await page.waitForFunction(() => !!window.render_game_to_text && !!window.activeGame.onRenderRequested);
  const after = await page.evaluate(() => ({ snapshot: JSON.parse(JSON.stringify(window.activeGame.toSnapshot())), text: JSON.parse(window.render_game_to_text()) }));
  assert.equal(after.text.seed, seed); assert.equal(after.snapshot.seed, seed);
  assert.deepEqual(after.snapshot.rngState, before.rngState);
  for (const field of ['player','monsters','items','entityGraph','dormantMonsters','waypoints','grid','levelSeeds']) assert.deepEqual(after.snapshot[field], before[field]);
  states.push({ seed, rngState: after.snapshot.rngState, text: after.text });
  await page.keyboard.press('.'); await page.waitForTimeout(250);
  await page.waitForTimeout(1000);
  await page.waitForTimeout(1000);
 await page.screenshot({path: `${dir}/browser-seed-${index}-continued.png`});
  await page.locator('.menu-btn').click();
 }
 await page.setViewportSize({width:700,height:800});
 await input.fill('18446744073709551615');
 await page.waitForTimeout(1000);
 await page.screenshot({path:`${dir}/browser-mobile-seed.png`});
 assert.equal(await input.inputValue(), '18446744073709551615');
 assert.deepEqual(errors, []);
} finally {
 fs.writeFileSync(`${dir}/browser.json`, JSON.stringify({states, errors}, null, 2)+'\n');
 await browser.close();
}
