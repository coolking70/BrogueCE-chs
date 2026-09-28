import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = 'ai_docs/reports/x3-u2-evidence';
const browser = await chromium.launch({ headless: false });
const errors = [], networkErrors = [], dialogs = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => networkErrors.push({ url: r.url(), failure: r.failure() }));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
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
  const setup = kind => page.evaluate(async kind => {
    const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
    const { Monster, MonsterState } = await import('/src/entities/Monster.ts');
    const { default: monsters } = await import('/src/data/monsters.json');
    const g = window.activeGame;
    g.startNewGame({ seed: 33002, mode: 'test' });
    g.animationEnabled = false; g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleMonsters.clear(); g.visibleItems.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
      g.grid.setTerrain(x, y, x >= 36 && x <= 46 && y >= 12 && y <= 18 ? T.FLOOR : T.WALL);
      const c = g.grid.getCell(x, y);
      Object.assign(c, { hasMemory: true, isExplored: true, isVisible: true, machineNumber: 0,
        isClairvoyantVisible: false, isMagicMapped: false, rememberedLayers: [...c.layers] });
    }
    g.player.loc = { x: 40, y: 15 }; g.player.hp = g.player.maxHp = 500;
    g.player.equippedWeapon = null; g.player.equippedArmor = null;
    const m = new Monster(41, 15, { ...monsters.find(m => m.id === 'monkey'), hp: 500, defense: 0 });
    m.state = MonsterState.WANDERING; m.ticksUntilTurn = 10000;
    m.isAlly = kind !== 'captive'; m.isCaged = kind === 'captive';
    if (kind === 'discordant') m.setStatusDuration('discordant', 100);
    if (kind === 'fallback') { g.grid.setTerrain(40, 15, T.LAVA); g.player.setStatusDuration('levitating', 100); }
    g.monsters.push(m); g.updateVision(); g.needsRender = true; g.update();
  }, kind);
  const state = () => page.evaluate(async () => {
    const { rng } = await import('/src/engine/Random.ts');
    const { timeSystem } = await import('/src/engine/Systems/Time.ts');
    const g = window.activeGame, m = g.monsters[0];
    return { loc: { ...g.player.loc }, turn: g.stats.turns, tick: timeSystem.currentTick,
      substantive: { stream: rng.getState().streams[0], draws: rng.getState().randomNumbersGenerated },
      monster: { loc: { ...m.loc }, hp: m.hp, ally: m.isAlly, captive: m.isCaged },
      decisions: g.exportRecording().events.map(e => e.decisions), text: JSON.parse(window.render_game_to_text()) };
  });
  for (const kind of ['swap', 'fallback', 'discordant', 'captive']) {
    await setup(kind); await page.waitForTimeout(150);
    const old = await state(), count = dialogs.length;
    if (kind === 'discordant' || kind === 'captive') {
      answer = false; await page.keyboard.press('ArrowRight');
      const denied = await state();
      for (const k of ['loc', 'turn', 'tick', 'substantive', 'monster']) assert.deepEqual(denied[k], old[k]);
      assert.deepEqual(denied.decisions, [[false]]); assert.equal(dialogs.length, count + 1);
      await page.screenshot({ path: `${out}/${kind}-denied.png`, fullPage: true });
      results.push({ kind: `${kind}-denied`, old, denied });
    }
    answer = true; await page.keyboard.press('ArrowRight');
    const accepted = await state(); assert.equal(accepted.turn, old.turn + 1); assert.equal(accepted.tick - old.tick, 100);
    if (kind === 'swap' || kind === 'fallback') {
      assert.deepEqual(accepted.loc, { x: 41, y: 15 }); assert.equal(accepted.monster.hp, 500);
      if (kind === 'swap') assert.deepEqual(accepted.monster.loc, old.loc);
      else { assert.notDeepEqual(accepted.monster.loc, old.loc); assert.notDeepEqual(accepted.monster.loc, accepted.loc); }
      assert.equal(dialogs.length, count);
    } else {
      assert.deepEqual(accepted.loc, old.loc); assert.deepEqual(accepted.decisions, [[false], [true]]);
      if (kind === 'discordant') assert.ok(accepted.monster.hp < 500);
      else { assert.equal(accepted.monster.hp, 500); assert.equal(accepted.monster.ally, true); assert.equal(accepted.monster.captive, false); }
    }
    await page.screenshot({ path: `${out}/${kind}-accepted.png`, fullPage: true }); results.push({ kind, old, accepted });
  }
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ results, dialogs, errors, networkErrors }, null, 2) + '\n');
  assert.equal(dialogs.length, 4); assert.deepEqual(errors, []); assert.deepEqual(networkErrors, []);
  console.log('Four scenarios passed; four native Yes/No dialogs; no console/page/network errors.');
} finally { await browser.close(); }
