// Real page, explicit tunneling outlet (the staff identity remains W-25).
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-13-evidence';
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], states = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5179');
    await page.locator('select').first().selectOption('test');
    await page.locator('.actions button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text);
    for (const mode of ['e2-consecutive', 'e3-layers', 'impregnable', 'creature-reflection', 'boundary', 'ordinary']) {
        await page.evaluate(async mode => {
            const { Grid, DungeonLayer: L, TerrainType: T } = await import('/src/engine/Map/Grid.ts');
            const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
            const { Monster } = await import('/src/entities/Monster.ts');
            const { default: monsters } = await import('/src/data/monsters.json');
            const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
            const { BoltEffect, getBoltForItem } = await import('/src/engine/Combat/Bolt.ts');
            const { CEBoltType } = await import('/src/engine/Combat/BoltCatalog.ts');
            const { logger } = await import('/src/engine/Systems/Logger.ts');
            const { LightMap } = await import('/src/engine/Lighting/LightMap.ts');
            const { FOVSys } = await import('/src/engine/Lighting/FOV.ts');
            const { DCOLS } = await import('/src/types/index.ts');
            const g = window.activeGame;
            logger.messages.length = 0; ItemLoader.identifiedItems.clear();
            g.grid = new Grid(g.grid.width, g.grid.height);
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, x === 0 || y === 0 || x === g.grid.width - 1 || y === g.grid.height - 1 ? T.GRANITE : T.FLOOR);
                Object.assign(g.grid.getCell(x, y), { isVisible: true, hasMemory: true });
            }
            g.lightMap = new LightMap(g.grid); g.fov = new FOVSys(g.grid);
            g.environment = new EnvironmentManager(g.grid); g.player.loc = { x: 4, y: 5 };
            g.player.hp = g.player.maxHp = 100; g.player.statusDurations = {}; g.player.ticksUntilTurn = 0;
            g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
            g.items = []; g.floatingTexts = []; g.pendingBoltFrames = []; g.monsters = []; g.dormantMonsters = [];
            g.player.inventory.items = []; g.autoPath = []; g.isMouseTraveling = false;
            const item = ItemLoader.spawnStaff('staff_of_fire', -1, -1);
            item.enchantment = mode === 'e3-layers' ? 3 : 2; item.charges = 1;
            // Mark the borrowed fixture identity known to render the brown beam.
            ItemLoader.identifiedItems.add(item.identityId);
            for (let x = 5; x <= 8; x++) for (let y = 3; y <= 7; y++) g.grid.setTerrain(x, y, T.GRANITE);
            if (mode === 'e3-layers') {
                g.grid.setTerrainLayer(5, 5, L.SURFACE, T.FORCEFIELD);
                g.grid.setTerrainLayer(5, 5, L.LIQUID, T.WATER_DEEP);
            }
            if (mode === 'impregnable') g.grid.impregnableCells.add(5 * DCOLS + 5);
            if (mode === 'creature-reflection') {
                for (let x = 5; x <= 8; x++) g.grid.setTerrain(x, 5, T.FLOOR);
                g.grid.setTerrain(2, 5, T.GRANITE); g.grid.setTerrain(1, 5, T.GRANITE);
                const m = new Monster(7, 5, monsters.find(m => m.id === 'stone_guardian')); m.ticksUntilTurn = 10000; g.monsters.push(m);
            }
            const bolt = mode === 'ordinary' ? getBoltForItem('staff_of_lightning') : {
                id: 'explicit_tunnel', name: 'tunnel', ceType: CEBoltType.TUNNELING, effect: BoltEffect.TUNNELING,
                magnitude: 999, char: '*', color: 0xcc8855, maxRange: 0, piercing: true, selfTargeting: false,
            };
            const r = g.zapBoltFromPlayer(bolt, item, { x: mode === 'boundary' ? 3 : 8, y: 5 });
            window.w13Result = { path: r.path, outcome: r.outcome, reflections: r.reflections.map(r => ({ pos: r.pos, towardCaster: r.towardCaster })) };
            g.updateVision(); g.needsRender = true;
        }, mode);
        await page.waitForTimeout(900);
        // Exercise actual movement into the freshly opened first corridor cell.
        if (mode === 'e2-consecutive') await page.keyboard.press('ArrowRight');
        // Existing animation clearing does not itself request a repaint (W-12).
        // Request a normal render after animation to inspect final terrain.
        await page.evaluate(() => { window.activeGame.needsRender = true; });
        await page.waitForTimeout(150);
        const state = await page.evaluate(() => ({ text: JSON.parse(window.render_game_to_text()), result: window.w13Result,
            row: Array.from({ length: 9 }, (_, x) => {
                const c = window.activeGame.grid.getCell(x, 5);
                return { x, layers: c.layers, passable: c.isPassable, opaque: c.isOpaque };
            }) }));
        const last = state.result.path.at(-1);
        assert.deepEqual(last, { x: mode === 'e2-consecutive' ? 6 : mode === 'e3-layers' ? 7 : mode === 'boundary' ? 0 : mode === 'creature-reflection' ? 1 : 5, y: 5 });
        assert.equal(state.text.player.x, mode === 'e2-consecutive' ? 5 : 4);
        if (mode === 'impregnable' || mode === 'ordinary') assert.equal(state.row[5].passable, false);
        if (mode === 'impregnable') assert.equal(state.result.outcome.autoID, false);
        if (mode === 'boundary') { assert.equal(state.row[0].passable, false); assert.equal(state.row[0].opaque, false); }
        if (mode === 'creature-reflection') assert.equal(state.result.reflections.length, 1);
        states.push({ mode, ...state });
        await page.screenshot({ path: `${dir}/browser-${mode}.png`, fullPage: true });
    }
    fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ scenarios: states.map(s => s.mode), errors }));
} finally { await browser.close(); }
