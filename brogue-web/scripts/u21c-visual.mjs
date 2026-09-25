import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = new URL('../ai_docs/reports/u-21c-evidence/', import.meta.url);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:5173/');
await page.waitForTimeout(1000);
await page.getByRole('button', { name: '新游戏' }).click();
await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
await page.evaluate(() => { window.__u21cRender = window.activeGame.onRenderRequested; });
const observation = await page.evaluate(async () => {
  const game = window.activeGame;
  const { TerrainType } = await import('/src/engine/Map/Grid.ts');
  const { terrainAppearance } = await import('/src/engine/UI/Appearance.ts');
  const p = game.player.loc;
  const samples = [TerrainType.FORCEFIELD, TerrainType.CRYSTAL_WALL,
    TerrainType.ANCIENT_SPIRIT_VINES, TerrainType.RUBBLE];
  samples.forEach((type, index) => game.grid.setTerrain(p.x + index + 1, p.y, type));
  const monster = game.monsters[0];
  if (monster) {
    monster.isDormant = false;
    monster.setStatusDuration('invisible', 0);
    monster.hp = Math.max(1, Math.floor(monster.maxHp / 2));
    monster.loc = { x: p.x - 1, y: p.y };
  }
  game.updateVision();
  if (monster) game.grid.getCell(monster.loc.x, monster.loc.y).isVisible = true;
  window.__u21cRender?.();
  return { renderHook: !!game.onRenderRequested,
    player: p, monstersInLevel: game.monsters.length, terrain: samples.map(type => ({ type: TerrainType[type], ...terrainAppearance(type, true) })),
    visibleMonsters: JSON.parse(window.render_game_to_text()).monsters.map(m => m.name) };
});
console.log(JSON.stringify(observation));
for (const width of [1280, 390]) {
  await page.setViewportSize({ width, height: 800 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: fileURLToPath(new URL(`terrain-sidebar-${width}.png`, out)) });
}
await page.setViewportSize({ width: 1280, height: 800 });
await page.evaluate(async () => {
  const game = window.activeGame;
  game.pendingBoltFrames = [{ x: game.player.loc.x, y: game.player.loc.y - 1, char: '*', color: 0xffcc00, durationMs: 5000 }];
  game.currentBoltFrameIndex = 0;
  game.boltAnimStartTime = Date.now();
  window.__u21cRender?.();
});
console.log('bolt during', await page.evaluate(() => ({ frame: window.activeGame.getCurrentBoltFrame(), render: !!window.activeGame.onRenderRequested })));
await page.screenshot({ path: fileURLToPath(new URL('bolt-during.png', out)) });
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(150);
await page.screenshot({ path: fileURLToPath(new URL('bolt-during-390.png', out)) });
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(150);
await page.evaluate(async () => {
  const game = window.activeGame;
  game.boltAnimStartTime = Date.now() - 5100;
  game.tickBoltAnimation();
  window.__u21cRender?.();
});
await page.screenshot({ path: fileURLToPath(new URL('bolt-after.png', out)) });
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(150);
await page.screenshot({ path: fileURLToPath(new URL('bolt-after-390.png', out)) });
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(150);
await page.evaluate(async () => {
  const game = window.activeGame;
  const { LightKind } = await import('/src/engine/Map/LightCatalog.ts');
  game.createFlare(game.player.loc.x, game.player.loc.y, LightKind.SCROLL_ENCHANTMENT_LIGHT);
  game.tickFlareAnimation(30);
  game.pendingEnchantment = true; // hold the synthetic animation frame for both screenshots
  window.__u21cRender?.();
});
console.log('flare center', await page.evaluate(() => ({ base: window.activeGame.lightMap.lightAt(window.activeGame.player.loc.x, window.activeGame.player.loc.y), visual: window.activeGame.visualLightAt(window.activeGame.player.loc.x, window.activeGame.player.loc.y) })));
await page.screenshot({ path: fileURLToPath(new URL('flare.png', out)) });
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(150);
await page.screenshot({ path: fileURLToPath(new URL('flare-390.png', out)) });
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(150);
await page.evaluate(() => {
  const game = window.activeGame;
  game.tickFlareAnimation(1000);
  game.pendingEnchantment = false;
  window.__u21cRender?.();
});
await page.screenshot({ path: fileURLToPath(new URL('flare-after.png', out)) });
await browser.close();
