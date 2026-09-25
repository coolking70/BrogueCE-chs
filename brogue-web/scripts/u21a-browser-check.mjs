import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const dir = 'ai_docs/reports/u-21a-evidence';
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const results = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('http://127.0.0.1:5197');
    await page.locator('select').first().selectOption('test');
    await page.locator('.actions button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text);
    await page.evaluate(async () => {
      const { Grid, TerrainType: T, DungeonLayer } = await import('/src/engine/Map/Grid.ts');
      const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
      const { LightMap } = await import('/src/engine/Lighting/LightMap.ts');
      const { FOVSys } = await import('/src/engine/Lighting/FOV.ts');
      const { Monster } = await import('/src/entities/Monster.ts');
      const { default: data } = await import('/src/data/monsters.json');
      const g = window.activeGame;
      g.animationEnabled = false;
      g.grid = new Grid(g.grid.width, g.grid.height);
      for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x > 0 && x < 18 && y > 0 && y < 12 ? T.FLOOR : T.GRANITE);
      }
      g.environment = new EnvironmentManager(g.grid);
      g.lightMap = new LightMap(g.grid);
      g.fov = new FOVSys(g.grid);
      g.player.loc = { x: 4, y: 5 };
      g.player.statusDurations = {};
      g.items = [];
      const m = new Monster(8, 5, data.find(d => d.id === 'rat'));
      m.setStatusDuration('invisible', 20);
      g.monsters = [m];
      g.visibleMonsters.clear();
      window.u21aMonster = m;
      window.u21aGasLayer = DungeonLayer.GAS;
      window.u21aGasTile = T.POISON_GAS;
      g.needsRender = true;
      g.update();
    });
    const capture = async state => {
      await page.evaluate(() => { window.activeGame.needsRender = true; window.activeGame.update(); });
      await page.waitForTimeout(250);
      const observation = await page.evaluate(async () => {
        const g = window.activeGame;
        g.updateHover(8, 5);
        const { canObserveBoltCreature } = await import('/src/engine/Combat/BoltTargeting.ts');
        return { text: JSON.parse(window.render_game_to_text()), hover: g.hoveredText,
          visible: g.visibleMonsters.has(window.u21aMonster),
          messageName: g.monsterDisplayName(window.u21aMonster),
          targetCandidate: canObserveBoltCreature(g.player, g.grid, window.u21aMonster) };
      });
      await page.waitForTimeout(150);
      results.push({ width, state, observation });
      await page.screenshot({ path: `${dir}/${width}-${state}.png`, fullPage: true });
      if (width === 390) {
        await page.locator('canvas').first().screenshot({ path: `${dir}/${width}-${state}-map.png` });
      }
      return observation;
    };
    let o = await capture('invisible');
    assert.equal(o.text.monsters.length, 0);
    assert.equal(o.text.revealedLocations.length, 0);
    assert.equal(o.visible, false);
    assert.equal(o.targetCandidate, false);
    assert.equal(o.messageName, '某个生物');
    assert.ok(!o.hover.includes('老鼠'));
    await page.evaluate(() => { window.activeGame.player.setStatusDuration('telepathy', 20); });
    o = await capture('revealed-marker');
    assert.equal(o.text.monsters.length, 0);
    assert.deepEqual(o.text.revealedLocations, [{ x: 8, y: 5, marker: 'x' }]);
    assert.ok(!o.hover.includes('老鼠'));
    assert.equal(o.targetCandidate, false);
    assert.equal(o.messageName, '某个生物');
    await page.evaluate(() => {
      const g = window.activeGame;
      g.grid.getCell(8, 5).layers[window.u21aGasLayer] = window.u21aGasTile;
      g.player.setStatusDuration('telepathy', 0);
    });
    o = await capture('gas-visible');
    assert.equal(o.text.monsters.length, 1);
    assert.equal(o.text.revealedLocations.length, 0);
    assert.equal(o.visible, true);
    assert.equal(o.targetCandidate, true);
    assert.equal(o.messageName, o.text.monsters[0].name);
    assert.ok(o.hover.includes(o.text.monsters[0].name));
    await page.close();
  }
} finally {
  fs.writeFileSync(`${dir}/states.json`, JSON.stringify(results, null, 2) + '\n');
  await browser.close();
}
