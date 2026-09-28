import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'ai_docs/reports/x3-u1-evidence';
const browser = await chromium.launch({ headless: process.env.X3_HEADLESS === '1' });
const errors = [], networkErrors = [], dialogs = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => networkErrors.push({ url: r.url(), failure: r.failure() }));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Offline fixture: use the page's fallback fonts instead of waiting for Google Fonts.
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
  await page.locator('.menu-card select').first().selectOption('test');
  await page.locator('.actions button').first().click();
  await page.waitForFunction(() => !!window.render_game_to_text);
  let answer = false;
  page.on('dialog', async d => {
    dialogs.push({ message: d.message(), type: d.type(), answer });
    if (answer) await d.accept(); else await d.dismiss();
  });
  async function setup(kind) {
    await page.evaluate(async kind => {
      const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
      const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
      const { Monster, MonsterState } = await import('/src/entities/Monster.ts');
      const { default: monsters } = await import('/src/data/monsters.json');
      const g = window.activeGame;
      g.startNewGame({ seed: 33001, mode: 'test' });
      g.animationEnabled = false; g.monsters = []; g.dormantMonsters = []; g.items = [];
      g.visibleMonsters.clear(); g.visibleItems.clear();
      for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 36 && x <= 46 && y >= 12 && y <= 18 ? T.FLOOR : T.WALL);
        const c = g.grid.getCell(x, y);
        Object.assign(c, { hasMemory: true, isExplored: true, isVisible: true,
          isClairvoyantVisible: false, isMagicMapped: false, rememberedLayers: [...c.layers] });
      }
      g.player.loc = { x: 40, y: 15 }; g.player.hp = g.player.maxHp = 500;
      g.player.equippedWeapon = null; g.player.equippedArmor = null;
      if (kind === 'acid') {
        g.player.equippedWeapon = ItemLoader.spawnWeapon('sword', -1, -1);
        Object.assign(g.player.equippedWeapon, { runicType: undefined, isProtected: false, enchantment: 0 });
        g.player.strength = 100;
        const m = new Monster(41, 15, { ...monsters.find(m => m.id === 'acid_mound'), hp: 500, defense: 0 });
        m.state = MonsterState.ASLEEP; g.monsters.push(m);
      } else {
        g.grid.setTerrain(41, 15, T[{ lava: 'LAVA', fire: 'PLAIN_FIRE', gas: 'CONFUSION_GAS', paralysis: 'PARALYSIS_GAS', plate: 'PRESSURE_PLATE' }[kind]]);
      }
      g.updateVision(); g.needsRender = true; g.update();
    }, kind);
    await page.waitForTimeout(100);
  }
  const state = () => page.evaluate(async () => {
    const { rng } = await import('/src/engine/Random.ts');
    const { timeSystem } = await import('/src/engine/Systems/Time.ts');
    const { logger } = await import('/src/engine/Systems/Logger.ts');
    const g = window.activeGame;
    return { loc: { ...g.player.loc }, turn: g.stats.turns, tick: timeSystem.currentTick,
      substantive: { stream: rng.getState().streams[0], draws: rng.getState().randomNumbersGenerated }, hp: g.player.hp, path: g.autoPath.length,
      auto: g.isAutoTraveling(), events: g.exportRecording().events,
      messages: logger.getState(), text: JSON.parse(window.render_game_to_text()) };
  });
  for (const kind of ['lava', 'fire', 'gas', 'paralysis', 'plate', 'acid']) {
    await setup(kind); answer = false;
    const old = await state(), count = dialogs.length;
    await page.keyboard.press('ArrowRight');
    const denied = await state();
    assert.deepEqual(denied.loc, old.loc); assert.equal(denied.turn, old.turn); assert.equal(denied.tick, old.tick);
    assert.deepEqual(denied.substantive, old.substantive);
    assert.equal(dialogs.length - count, kind === 'lava' ? 0 : 1);
    await page.screenshot({ path: `${out}/${kind}-denied.png`, fullPage: true });
    if (kind !== 'lava') {
      answer = true; await page.keyboard.press('ArrowRight');
      const accepted = await state(); assert.equal(accepted.turn, old.turn + 1);
      if (kind !== 'acid') assert.deepEqual(accepted.loc, { x: 41, y: 15 });
      await page.screenshot({ path: `${out}/${kind}-accepted.png`, fullPage: true });
      results.push({ kind, old, denied, accepted });
    } else results.push({ kind, old, denied });
  }
  // The route remembers safe floor; clairvoyance reveals the new flame.
  await setup('fire'); answer = false;
  await page.evaluate(async () => {
    const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
    const g = window.activeGame, c = g.grid.getCell(41, 15);
    c.isVisible = false; c.isClairvoyantVisible = true;
    c.rememberedLayers = [T.FLOOR, T.NOTHING, T.NOTHING, T.NOTHING];
    c.rememberedTerrainFlags = 0;
    g.handleMouseTravel(43, 15);
    g.stepAutoPath();
  });
  await page.waitForFunction(() => !window.activeGame.isAutoTraveling());
  const stopped = await state(); assert.deepEqual(stopped.loc, { x: 40, y: 15 }); assert.equal(stopped.path, 0);
  results.push({ kind: 'auto-fire-no', stopped });
  await page.screenshot({ path: `${out}/auto-fire-stopped.png`, fullPage: true });
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ results, dialogs, errors, networkErrors, externalFontCSS: 'empty response in offline browser fixture' }, null, 2) + '\n');
  assert.equal(dialogs.length, 11);
  assert.deepEqual(errors, []);
  console.log('Six terrain/attack scenarios and auto-stop passed; dialogs:', dialogs.length, 'errors:', errors, 'network:', networkErrors);
} finally { await browser.close(); }
