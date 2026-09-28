import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = 'ai_docs/reports/x3-u3-evidence';
const browser = await chromium.launch({ headless: false });
const errors = [], dialogs = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('http://127.0.0.1:4183', { waitUntil: 'domcontentloaded' });
  await page.locator('.menu-card select').first().selectOption('test');
  await page.locator('.actions button').first().click();
  await page.waitForFunction(() => !!window.render_game_to_text);
  let answer = false;
  page.on('dialog', async d => {
    dialogs.push({ message: d.message(), answer });
    if (answer) await d.accept(); else await d.dismiss();
  });
  const setup = (slot, cursed) => page.evaluate(async ({ slot, cursed }) => {
    const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
    const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
    const g = window.activeGame;
    g.startNewGame({ seed: 33003, mode: 'test' }); g.animationEnabled = false;
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.visibleMonsters.clear(); g.visibleItems.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
      g.grid.setTerrain(x, y, x >= 36 && x <= 46 && y >= 12 && y <= 18 ? T.FLOOR : T.WALL);
      const c = g.grid.getCell(x, y);
      Object.assign(c, { hasMemory: true, isExplored: true, isVisible: true, machineNumber: 0,
        isClairvoyantVisible: false, isMagicMapped: false, rememberedLayers: [...c.layers] });
    }
    g.player.loc = { x: 40, y: 15 }; g.player.inventory.items = [];
    for (const key of ['equippedWeapon', 'equippedArmor', 'ringLeft', 'ringRight']) g.player[key] = null;
    const item = slot === 'equippedWeapon' ? ItemLoader.spawnWeapon('sword', -1, -1)
      : slot === 'equippedArmor' ? ItemLoader.spawnArmor('leather_armor', -1, -1)
      : ItemLoader.spawnRing('ring_of_regeneration', -1, -1);
    Object.assign(item, { isCursed: cursed, identified: false, enchantment: -2, quantity: 1, runicType: undefined });
    g.player.inventory.addItem(item); g.player[slot] = item;
    g.updateVision(); g.needsRender = true; g.update();
  }, { slot, cursed });
  const state = () => page.evaluate(async () => {
    const { rng } = await import('/src/engine/Random.ts');
    const { timeSystem } = await import('/src/engine/Systems/Time.ts');
    const { logger } = await import('/src/engine/Systems/Logger.ts');
    const g = window.activeGame;
    return { turn: g.absoluteTurnNumber, tick: timeSystem.currentTick,
      rng: { stream: rng.getState().streams[0], draws: rng.getState().randomNumbersGenerated },
      inventory: g.player.inventory.items.map(i => ({ id: i.id, identified: i.identified, quantity: i.quantity })),
      slots: ['equippedWeapon', 'equippedArmor', 'ringLeft', 'ringRight'].map(k => g.player[k]?.id ?? null),
      floor: g.items.map(i => i.id), messages: logger.messages.map(m => m.text),
      events: g.exportRecording().events, text: JSON.parse(window.render_game_to_text()) };
  });
  const operate = async operation => {
    await page.keyboard.press('i'); await page.locator('.item-row').first().click();
    await page.getByRole('button', { name: operation, exact: true }).click();
    await page.waitForTimeout(160);
  };
  const sameGameplay = (a, b) => {
    for (const k of ['turn', 'tick', 'rng', 'inventory', 'slots', 'floor']) assert.deepEqual(a[k], b[k], k);
  };
  for (const slot of ['equippedWeapon', 'equippedArmor', 'ringLeft', 'ringRight']) {
    for (const op of ['卸下', '丢弃']) {
      await setup(slot, true); const before = await state(); await operate(op); const after = await state();
      sameGameplay(after, before); assert.match(after.messages.at(-1), /似乎受到了诅咒/);
      assert.ok(after.events.some(e => e.action === 'item:command' && e.data.startsWith(op === '卸下' ? 'unequip|' : 'drop|')));
      results.push({ slot, op, before, after });
    }
  }
  await page.screenshot({ path: `${out}/cursed-drop.png`, fullPage: true });
  for (const cursed of [true, false]) {
    await setup('equippedArmor', cursed); const before = await state();
    answer = false; await operate('投掷');
    // UI selected the item; target click uses the same public mouse command as the canvas.
    await page.evaluate(() => window.activeGame.executeCommand('mouse_travel', { x: 43, y: 15 }));
    const denied = await state(); sameGameplay(denied, before);
    assert.deepEqual(denied.events.at(-1).decisions, [false]);
    answer = true; await operate('投掷');
    await page.evaluate(() => window.activeGame.executeCommand('mouse_travel', { x: 43, y: 15 }));
    const accepted = await state(); assert.deepEqual(accepted.events.at(-1).decisions, [true]);
    if (cursed) { sameGameplay(accepted, before); assert.match(accepted.messages.at(-1), /无法卸下.+似乎受到了诅咒/); }
    else { assert.equal(accepted.turn, before.turn + 1); assert.deepEqual(accepted.slots, [null, null, null, null]); assert.equal(accepted.floor.length, 1); }
    await page.screenshot({ path: `${out}/throw-${cursed ? 'cursed' : 'ordinary'}.png`, fullPage: true });
    results.push({ op: 'throw', cursed, before, denied, accepted });
  }
  assert.equal(dialogs.length, 4); assert.ok(dialogs.every(d => /^你确定要投掷你的.+吗？$/.test(d.message)));
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ results, dialogs, errors }, null, 2) + '\n');
  console.log('Eight cursed UI removals/drops and four real Yes/No dialogs passed; no console/page errors.');
} finally { await browser.close(); }
