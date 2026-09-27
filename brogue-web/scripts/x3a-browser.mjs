import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
process.chdir(new URL('..', import.meta.url).pathname);
const out = 'ai_docs/reports/x3a-evidence';
const browser = await chromium.launch({ headless: false });
const errors = [], rows = [];
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
 page.on('pageerror', e => errors.push(String(e)));
 page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
 await page.goto('http://127.0.0.1:5199');
 await page.locator('.menu-card input[type=text]').fill('22013');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
 const setup = () => page.evaluate(async () => {
  const g = window.activeGame;
  const [{ TerrainType: T }, { Monster, MonsterState }, { default: data }] = await Promise.all([
   import('/src/engine/Map/Grid.ts'), import('/src/entities/Monster.ts'), import('/src/data/monsters.json')]);
  g.startNewGame({ seed: 22013, mode: 'test' }); g.animationEnabled = false;
  g.monsters = []; g.dormantMonsters = []; g.items = []; g.purgatory = [];
  for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
   const c = g.grid.getCell(x, y); c.layers.fill(T.NOTHING); c.machineNumber = 0;
   g.grid.setTerrain(x, y, x && y && x < g.grid.width - 1 && y < g.grid.height - 1 ? T.FLOOR : T.WALL);
  }
  g.player.loc = { x: 10, y: 10 };
  const rat = new Monster(12, 10, data.find(m => m.id === 'rat'));
  const revenant = new Monster(13, 10, data.find(m => m.id === 'revenant'));
  rat.state = MonsterState.HUNTING; rat.ticksUntilTurn = 0; revenant.isAlly = true;
  g.monsters.push(rat, revenant); window.x3aRat = rat; window.x3aCorpse = revenant;
  g.updateVision(); g.needsRender = true;
 });
 const observe = () => page.evaluate(async () => {
  const g = window.activeGame, { rng } = await import('/src/engine/Random.ts');
  return { text: JSON.parse(window.render_game_to_text()), rat: { loc: window.x3aRat.loc, state: window.x3aRat.state, hp: window.x3aRat.hp },
   corpse: { listed: g.monsters.includes(window.x3aCorpse), hp: window.x3aCorpse.hp, processed: window.x3aCorpse.deathProcessed,
    occupies: g.getMonsterAt(13, 10) === window.x3aCorpse }, rng: rng.getState() };
 });
 const shot = async label => {
  await page.evaluate(() => { const g = window.activeGame; g.updateVision(); g.needsRender = true; g.onRenderRequested(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/browser-${label}.png` });
  rows.push({ label, ...await observe() });
 };
 await setup(); await shot('alive');
 await page.evaluate(() => window.x3aCorpse.takeDamage(window.x3aCorpse.hp, true));
 await shot('dead-listed');
 assert.equal(rows.at(-1).corpse.listed, true); assert.equal(rows.at(-1).corpse.processed, true); assert.equal(rows.at(-1).corpse.occupies, false);
 assert.equal(await page.locator('#ai-agent-monsters .ai-monster[data-hp="0"]').count(), 0);
 assert.equal(await page.locator('#ai-agent-monsters .ai-monster').count(), 1);
 assert.ok(!rows.at(-1).text.monsters.some(m => m.typeId === 'revenant'));
 await page.keyboard.press('.'); await page.waitForFunction(() => !window.activeGame.isAdvancing);
 await shot('turn'); const withCorpse = rows.at(-1);
 assert.equal(withCorpse.rat.state, 2); assert.equal(withCorpse.corpse.listed, false);
 await setup(); await page.evaluate(() => { window.x3aCorpse.takeDamage(window.x3aCorpse.hp, true); window.activeGame.removeDeadMonsters(); });
 await page.keyboard.press('.'); await page.waitForFunction(() => !window.activeGame.isAdvancing);
 await shot('control'); const swept = rows.at(-1);
 assert.deepEqual(withCorpse.rat, swept.rat);
 assert.deepEqual(withCorpse.rng.streams[0], swept.rng.streams[0]);
 assert.equal(withCorpse.rng.randomNumbersGenerated, swept.rng.randomNumbersGenerated);
 assert.deepEqual(errors, []);
} finally {
 fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ scope: 'Synthetic seed22013 scene; real death, keyboard wait, render and DOM consumers. Does not establish natural frequency.', errors, rows }, null, 2) + '\n');
 await browser.close();
}
