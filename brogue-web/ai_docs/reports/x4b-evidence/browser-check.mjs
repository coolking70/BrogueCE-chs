import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = 'ai_docs/reports/x4b-evidence';
const browser = await chromium.launch({ headless: false });
const results = [], errors = [];
try {
  for (const [name, viewport, touch] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['mobile', { width: 390, height: 844 }, true],
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: touch, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await page.goto('http://127.0.0.1:4173');
    await page.locator('.menu-card select').first().selectOption('test');
    await page.locator('.actions button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text);
    await page.evaluate(async () => {
      const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
      const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
      const { logger } = await import('/src/engine/Systems/Logger.ts');
      const g = window.activeGame;
      g.animationEnabled = false; g.monsters = []; g.dormantMonsters = []; g.items = [];
      g.visibleMonsters.clear(); g.visibleItems.clear();
      for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 37 && x <= 46 && y >= 13 && y <= 17 ? T.FLOOR : T.WALL);
        const c = g.grid.getCell(x, y);
        c.isExplored = false; c.hasMemory = false; c.isVisible = false;
      }
      g.player.loc = { x: 40, y: 15 };
      g.grid.setTerrain(41, 15, T.FOLIAGE); g.grid.setTerrain(42, 15, T.DOOR);
      g.grid.setTerrain(39, 15, T.GRASS);
      g.items.push(ItemLoader.spawnPotion('potion_of_strength', 41, 15));
      logger.reset(); g.clearHover(); g.updateVision(); g.needsRender = true; g.update();
    });
    await page.mouse.move(1, 1);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.activeGame.player.x === 41 && !window.activeGame.isAdvancing);
    const line = touch ? '.strip-hover' : '.inspect-panel';
    await page.waitForFunction(sel => document.querySelector(sel)?.textContent.includes('踩倒'), line);
    await page.screenshot({ path: `${out}/${name}-foliage.png`, fullPage: true });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.activeGame.player.x === 42 && !window.activeGame.isAdvancing);
    await page.waitForFunction(sel => document.querySelector(sel)?.textContent.includes('打开的门'), line);
    await page.screenshot({ path: `${out}/${name}-door.png`, fullPage: true });
    const coordinates = await page.evaluate(() => {
      const { mapLayout: m } = JSON.parse(window.render_game_to_text());
      const r = document.querySelector('canvas').getBoundingClientRect();
      return { x: r.x + m.offsetX + 39.5 * m.tile * m.scaleX, y: r.y + m.offsetY + 15.5 * m.tile * m.scaleY };
    });
    if (touch) {
      await page.locator('canvas').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: coordinates.x, clientY: coordinates.y, bubbles: true });
      await page.waitForTimeout(650);
      await page.locator('canvas').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, clientX: coordinates.x, clientY: coordinates.y, bubbles: true });
    } else {
      await page.mouse.move(coordinates.x, coordinates.y);
    }
    await page.waitForFunction(sel => window.activeGame.hoveredText.length > 0 && document.querySelector(sel)?.textContent.includes(window.activeGame.hoveredText), line);
    const hover = await page.locator(line).innerText();
    assert(!hover.includes('打开的门'), 'Inspection should override current location');
    await page.screenshot({ path: `${out}/${name}-hover.png`, fullPage: true });
    if (touch) await page.keyboard.press('ArrowLeft');
    else await page.mouse.move(1, 1);
    await page.waitForFunction(sel => !window.activeGame.hoveredText && document.querySelector(sel)?.textContent.includes(window.activeGame.flavorText), line);
    const state = await page.evaluate(async () => {
      const { logger } = await import('/src/engine/Systems/Logger.ts');
      return { flavor: window.activeGame.flavorText, hovered: window.activeGame.hoveredText,
        messages: logger.getState(), text: JSON.parse(window.render_game_to_text()) };
    });
    assert(!state.messages.messages.some(m => m.text.startsWith('你正站在')), 'Flavor must stay outside archive');
    assert(state.messages.messages.some(m => m.text.includes('拾取') || m.text.includes('捡起') || m.text.includes('获得')), 'Pickup should remain in archive');
    results.push({ viewport, name, hover, ...state });
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ results, errors }, null, 2) + '\n');
  console.log('Desktop/mobile terrain, hover/longpress, fallback and archive assertions passed; errors:', errors.length);
} finally { await browser.close(); }
