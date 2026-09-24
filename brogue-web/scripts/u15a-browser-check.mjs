import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/u-15a-evidence';
const browser = await chromium.launch({ headless: false });
const errors = [], states = [];
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5196');
    await page.locator('.menu-card input[type=text]').fill('15015');
    await page.locator('.menu-card .actions').first().locator('button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text && !!window.activeGame.onRenderRequested);
    for (const reload of [false, true]) {
        await page.evaluate(async () => {
            const [{ ItemLoader }, { TerrainType: T, DungeonLayer: L }, { Monster }, md] = await Promise.all([
                import('/src/engine/Items/ItemLoader.ts'), import('/src/engine/Map/Grid.ts'),
                import('/src/entities/Monster.ts'), import('/src/data/monsters.json'),
            ]);
            const g = window.activeGame;
            g.startNewGame({ seed: 15015, mode: 'test' });
            g.monsters = []; g.dormantMonsters = []; g.items = []; g.grid.impregnableCells.clear();
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, T.FLOOR);
                Object.assign(g.grid.getCell(x, y), { machineNumber: 0, hasDormantMonster: false });
            }
            g.player.loc = { x: 5, y: 5 }; g.animationEnabled = false;
            for (const [x, y, protectedCell] of [[7, 5, true], [7, 7, false], [0, 5, true], [0, 7, false]]) {
                g.grid.setTerrain(x, y, T.WALL, '#', 0x888888);
                if (protectedCell) g.grid.impregnableCells.add(y * g.grid.width + x);
            }
            g.grid.getCell(7, 5).machineNumber = 17;
            const m = new Monster(7, 5, md.default.find(d => d.id === 'goblin'));
            m.isCaged = true; m.ticksUntilTurn = 10000; g.monsters.push(m);
            g.player.inventory.items = [ItemLoader.spawnScroll('scroll_of_shattering', -1, -1)];
            g.updateVision(); g.needsRender = true; g.update();
            window.u15aReadState = () => ({
                cells: [[7, 5], [7, 7], [0, 5], [0, 7]].map(([x, y]) => {
                    const c = g.grid.getCell(x, y);
                    return { x, y, dungeon: c.layers[L.DUNGEON], surface: c.layers[L.SURFACE],
                        machine: c.machineNumber, protected: g.grid.isImpregnable(x, y), char: c.char, color: c.color };
                }),
                flags: [...g.grid.impregnableCells], turns: g.stats.turns,
                inventory: g.player.inventory.items.length, captive: g.monsters.find(m => m.x === 7 && m.y === 5)?.isCaged,
                text: JSON.parse(window.render_game_to_text()), constants: { WALL: T.WALL, FORCEFIELD: T.FORCEFIELD, CRYSTAL_WALL: T.CRYSTAL_WALL, RUBBLE: T.RUBBLE },
            });
        });
        const before = await page.evaluate(() => window.u15aReadState());
        if (reload) {
            // Real menu save, fresh document, Continue; reattach observation only.
            await page.locator('.menu-btn').click();
            await page.locator('.menu-card .actions').first().locator('button').nth(2).click();
            const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('brogue-web-save-v1')));
            assert.equal(saved.version, 2); assert.deepEqual(saved.impregnableCells, before.flags);
            const observation = await page.evaluate(() => window.u15aReadState.toString());
            await page.reload();
            await page.locator('.menu-card .actions').first().locator('button').nth(1).click();
            await page.waitForFunction(() => !!window.render_game_to_text && !!window.activeGame.onRenderRequested);
            await page.evaluate(async source => {
                const { TerrainType: T, DungeonLayer: L } = await import('/src/engine/Map/Grid.ts');
                window.u15aReadState = new Function('g', 'T', 'L', `return (${source});`)(window.activeGame, T, L);
            }, observation);
            assert.deepEqual((await page.evaluate(() => window.u15aReadState())).cells, before.cells);
        }
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${dir}/browser-${reload ? 'restored' : 'direct'}-before.png` });
        await page.keyboard.press('i');
        await page.locator('.item-row').first().click();
        await page.locator('.item-actions button').filter({ hasText: /^(朗读|Read)$/ }).click();
        await page.waitForTimeout(350);
        const after = await page.evaluate(() => window.u15aReadState());
        assert.deepEqual(after.cells[0], before.cells[0]); assert.deepEqual(after.cells[2], before.cells[2]);
        assert.equal(after.cells[1].dungeon, after.constants.FORCEFIELD);
        assert.equal(after.cells[3].dungeon, after.constants.CRYSTAL_WALL);
        assert.equal(after.cells[1].surface, after.constants.RUBBLE);
        assert.equal(after.inventory, 0); assert.equal(after.captive, true); assert.equal(after.turns, before.turns + 1);
        assert.deepEqual(after.flags, before.flags);
        states.push({ reload, before, after });
        await page.screenshot({ path: `${dir}/browser-${reload ? 'restored' : 'direct'}-after.png` });
    }
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(`${dir}/browser.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    await browser.close();
}
