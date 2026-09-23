// Real page: explicit obstruction config; the item identity remains W-26.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-14-evidence';
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
    for (const mode of ['corridor', 'e8', 'impregnable', 'occupied']) {
        await page.evaluate(async mode => {
            const { Grid, DungeonLayer: L, TerrainType: T } = await import('/src/engine/Map/Grid.ts');
            const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
            const { Monster } = await import('/src/entities/Monster.ts');
            const { default: monsters } = await import('/src/data/monsters.json');
            const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
            const { BoltEffect } = await import('/src/engine/Combat/Bolt.ts');
            const { CEBoltType } = await import('/src/engine/Combat/BoltCatalog.ts');
            const { logger } = await import('/src/engine/Systems/Logger.ts');
            const { LightMap } = await import('/src/engine/Lighting/LightMap.ts');
            const { FOVSys } = await import('/src/engine/Lighting/FOV.ts');
            const { rng } = await import('/src/engine/Random.ts');
            const { DCOLS } = await import('/src/types/index.ts');
            const g = window.activeGame;
            logger.messages.length = 0; ItemLoader.identifiedItems.clear();
            g.grid = new Grid(g.grid.width, g.grid.height);
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                const open = x > 0 && x < g.grid.width - 1 && y > 0 && y < g.grid.height - 1 && (mode !== 'corridor' || y === 5);
                g.grid.setTerrain(x, y, open ? T.FLOOR : T.GRANITE);
                Object.assign(g.grid.getCell(x, y), { isVisible: true, hasMemory: true });
            }
            g.lightMap = new LightMap(g.grid); g.fov = new FOVSys(g.grid);
            g.environment = new EnvironmentManager(g.grid); g.player.loc = { x: 4, y: 5 };
            g.player.hp = g.player.maxHp = 100; g.player.statusDurations = {}; g.player.ticksUntilTurn = 0;
            g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
            g.items = []; g.floatingTexts = []; g.pendingBoltFrames = []; g.monsters = []; g.dormantMonsters = [];
            g.player.inventory.items = []; g.autoPath = []; g.isMouseTraveling = false;
            const item = ItemLoader.spawnStaff('staff_of_fire', -1, -1);
            item.enchantment = mode === 'e8' ? 8 : 2; item.charges = 1;
            ItemLoader.identifiedItems.add(item.identityId);
            g.grid.setTerrain(9, 5, T.GRANITE);
            if (mode === 'impregnable') g.grid.impregnableCells.add(5 * DCOLS + 8);
            if (mode === 'occupied') {
                const m = new Monster(8, 5, monsters.find(m => m.id === 'rat')); m.ticksUntilTurn = 10000; g.monsters.push(m);
            }
            rng.seedRandomGenerator(14014);
            const r = g.zapBoltFromPlayer({ id: 'explicit_obstruction', name: 'obstruction', ceType: CEBoltType.OBSTRUCTION,
                effect: BoltEffect.OBSTRUCTION, magnitude: 999, char: '*', color: 0x55ff55, maxRange: 0, piercing: false, selfTargeting: false,
            }, item, { x: 9, y: 5 });
            window.w14Result = { path: r.path, outcome: r.outcome, landing: r.landingPos };
            window.w14State = () => ({ text: JSON.parse(window.render_game_to_text()), result: window.w14Result,
                fields: Array.from({ length: g.grid.width }, (_, x) => Array.from({ length: g.grid.height }, (_, y) => ({ x, y, c: g.grid.getCell(x, y) })))
                    .flat().filter(p => p.c.layers.includes(T.FORCEFIELD) || p.c.layers.includes(T.FORCEFIELD_MELT)).map(p => ({ x: p.x, y: p.y, layers: p.c.layers, passable: p.c.isPassable })),
                row: Array.from({ length: 11 }, (_, x) => ({ x, layers: g.grid.getCell(x, 5).layers, passable: g.grid.getCell(x, 5).isPassable })),
            });
            if (mode === 'corridor') g.player.loc = { x: 6, y: 5 }; // next step encounters guaranteed first wave at x7
            g.updateVision(); g.needsRender = true;
        }, mode);
        await page.waitForTimeout(900);
        await page.evaluate(() => { window.activeGame.needsRender = true; });
        if (mode === 'corridor') await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(150);
        const state = await page.evaluate(() => window.w14State());
        assert.equal(state.result.outcome.autoID, true); assert(state.fields.length > 0);
        assert(state.fields.every(p => p.passable === false));
        assert.deepEqual(state.result.landing, { x: mode === 'occupied' ? 7 : 8, y: 5 });
        if (mode === 'corridor') assert.equal(state.text.player.x, 6);
        if (mode === 'impregnable') assert.equal(state.row[8].passable, false);
        if (mode === 'occupied') assert.equal(state.row[8].passable, true);
        states.push({ mode, ...state });
        await page.screenshot({ path: `${dir}/browser-${mode}.png`, fullPage: true });
        if (mode === 'corridor') {
            await page.evaluate(async () => {
                const { rng } = await import('/src/engine/Random.ts');
                const original = rng.randRange;
                try { rng.randRange = () => 0; for (let t = 0; t < 14; t++) window.activeGame.objectiveTimeBlock(); }
                finally { rng.randRange = original; }
                window.activeGame.needsRender = true;
            });
            await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
            const melted = await page.evaluate(() => window.w14State());
            assert.equal(melted.text.player.x, 7); assert.equal(melted.fields.length, 0);
            states.push({ mode: 'melted-walk', ...melted });
            await page.screenshot({ path: `${dir}/browser-melted-walk.png`, fullPage: true });
        }
    }
    fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ scenarios: states.map(s => s.mode), errors }));
} finally { await browser.close(); }
