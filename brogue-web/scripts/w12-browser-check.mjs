// Real page: explicit player blink (staff stays out of pool), keyboard beckoning,
// and the existing monster outlet. Capture both state and whole-page rendering.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-12-evidence';
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
    for (const mode of ['blink-e2-pickup', 'blink-gold-full', 'blink-e8', 'blink-wall', 'blink-trap', 'beckon-diagonal', 'beckon-adjacent', 'monster-beckon']) {
        await page.evaluate(async mode => {
            const { Grid, TerrainType: T } = await import('/src/engine/Map/Grid.ts');
            const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
            const { Monster } = await import('/src/entities/Monster.ts');
            const { default: data } = await import('/src/data/monsters.json');
            const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
            const { BoltEffect } = await import('/src/engine/Combat/Bolt.ts');
            const { CEBoltType } = await import('/src/engine/Combat/BoltCatalog.ts');
            const { logger } = await import('/src/engine/Systems/Logger.ts');
            const { LightMap } = await import('/src/engine/Lighting/LightMap.ts');
            const { FOVSys } = await import('/src/engine/Lighting/FOV.ts');
            const g = window.activeGame;
            logger.messages.length = 0; ItemLoader.identifiedItems.clear();
            g.grid = new Grid(g.grid.width, g.grid.height);
            g.lightMap = new LightMap(g.grid); g.fov = new FOVSys(g.grid);
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, T.FLOOR); Object.assign(g.grid.getCell(x, y), { isVisible: true, hasMemory: true });
            }
            g.environment = new EnvironmentManager(g.grid); g.player.loc = { x: 4, y: 5 };
            g.player.maxHp = 100; g.player.hp = 100; g.player.regenCarry = 0;
            g.player.statusDurations = {}; g.player.poisonAmount = 0; g.player.ticksUntilTurn = 0;
            g.ticksTillUpdateEnvironment = 100; g.player.refreshSpeeds();
            g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
            g.items = []; g.floatingTexts = []; g.pendingBoltFrames = []; g.monsters = []; g.dormantMonsters = [];
            g.player.inventory.items = [];
            const mon = (x, y, id = 'rat') => {
                const m = new Monster(x, y, data.find(d => d.id === id));
                m.ticksUntilTurn = 10000; g.monsters.push(m); return m;
            };
            window.w12Result = null;
            const summarize = r => ({ path: r.path, landing: r.landingPos, outcome: r.outcome,
                hits: r.hits.map(h => ({ pos: h.pos, target: h.creature === g.player ? 'player' : h.creature.typeId })) });
            if (mode.startsWith('blink')) {
                const item = ItemLoader.spawnStaff('staff_of_fire', -1, -1);
                Object.assign(item, { enchantment: mode === 'blink-e8' ? 8 : 2, charges: 1 });
                if (mode === 'blink-gold-full') {
                    g.stats.gold = 0;
                    for (let i = 0; i < g.player.inventory.capacity; i++) g.player.inventory.items.push(ItemLoader.spawnFood('ration_of_food', -1, -1));
                    g.items.push(ItemLoader.spawnGold(47, 10, 5));
                }
                if (mode === 'blink-e2-pickup') g.items.push(ItemLoader.spawnFood('ration_of_food', 10, 5));
                if (mode === 'blink-wall') g.grid.setTerrain(8, 5, T.CRYSTAL_WALL);
                if (mode === 'blink-trap') g.grid.setTerrain(10, 5, T.GAS_TRAP_POISON_HIDDEN);
                window.w12Result = summarize(g.zapBoltFromPlayer({ id: 'explicit_blink', name: 'blink', ceType: CEBoltType.BLINKING,
                    effect: BoltEffect.BLINKING, magnitude: 999, char: '@', color: 0xffffff, maxRange: 0,
                    piercing: false, selfTargeting: false }, item, { x: 5, y: 5 }));
            } else if (mode === 'monster-beckon') {
                const caster = mon(12, 5, 'mirrored_totem');
                g.items.push(ItemLoader.spawnFood('ration_of_food', 11, 5));
                window.w12Result = summarize(g.castMonsterBolt(caster, g.player, 'BECKONING'));
            } else {
                const m = mode === 'beckon-diagonal' ? mon(6, 8) : mon(5, 5);
                if (mode === 'beckon-diagonal') g.grid.setTerrain(5, 7, T.WALL);
                const item = ItemLoader.spawnWand('wand_of_beckoning', -1, -1); item.charges = 2;
                g.player.inventory.items = [item];
                g.useArcanaItem(item); g.setArcanaTarget(m.loc.x, m.loc.y);
            }
            g.updateVision(); g.needsRender = true;
        }, mode);
        if (mode.startsWith('beckon-')) await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        const state = await page.evaluate(() => ({ text: JSON.parse(window.render_game_to_text()),
            result: window.w12Result,
            inventory: window.activeGame.player.inventory.items.map(i => ({ category: i.category, charges: i.charges })),
            monsters: window.activeGame.monsters.map(m => ({ x: m.loc.x, y: m.loc.y, wait: m.ticksUntilTurn })),
            gold: window.activeGame.stats.gold, ground: window.activeGame.items.length }));
        const expectedX = mode === 'blink-e8' ? 22 : mode === 'blink-wall' ? 7 : mode.startsWith('blink') ? 10 : mode === 'monster-beckon' ? 11 : 4;
        assert.deepEqual([state.text.player.x, state.text.player.y], [expectedX, 5]);
        if (mode === 'beckon-diagonal') assert.deepEqual([state.monsters[0].x, state.monsters[0].y], [5, 6]);
        if (mode === 'beckon-adjacent') assert.deepEqual([state.monsters[0].x, state.monsters[0].y], [5, 5]);
        if (mode.startsWith('beckon-')) assert.equal(state.inventory[0].charges, 1);
        if (mode === 'blink-gold-full') { assert.equal(state.gold, 47); assert.equal(state.inventory.length, 26); assert.equal(state.ground, 0); }
        if (mode.endsWith('pickup') || mode === 'monster-beckon') {
            assert.equal(state.inventory.length, 1); assert.equal(state.ground, 0);
        }
        states.push({ mode, ...state });
        await page.screenshot({ path: `${dir}/browser-${mode}.png`, fullPage: true });
    }
    fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ scenarios: states.map(s => s.mode), errors }));
} finally { await browser.close(); }
