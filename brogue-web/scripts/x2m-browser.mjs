import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out = 'ai_docs/reports/x2m-evidence';
const errors = [], rows = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.clock.install({ time: new Date('2026-09-27T00:00:00Z') });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5199');
    await page.locator('.menu-card input[type=text]').fill('424242');
    await page.locator('.menu-card .actions button').first().click();
    await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
    await page.clock.pauseAt(new Date('2026-09-27T00:01:00Z'));
    await page.evaluate(async () => {
        const g = window.activeGame;
        const { TerrainType: T, DungeonLayer: L } = await import('/src/engine/Map/Grid.ts');
        const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
        const { Monster } = await import('/src/entities/Monster.ts');
        const { default: monsters } = await import('/src/data/monsters.json');
        window.x2m = { T, L, ItemLoader, Monster, monsters };
        window.x2mScene = () => {
            g.startNewGame({ seed: 424242, mode: 'test' });
            g.animationEnabled = false; g.monsters = []; g.dormantMonsters = []; g.items = [];
            g.grid.impregnableCells.clear();
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, x < 25 || x > 54 || y < 8 || y > 24 ? T.WALL : T.FLOOR);
                Object.assign(g.grid.getCell(x, y), { machineNumber: 0, hasDormantMonster: false,
                    isExplored: false, hasMemory: false, rememberedLayers: [], rememberedItem: null });
            }
            g.player.loc = { x: 35, y: 16 }; g.player.hp = g.player.maxHp = 500;
            g.player.setStatusDuration('darkness', 100); g.player.maxStatus.darkness = 100;
            g.updateVision();
            g.isInventoryOpen = false;
            g.onRenderRequested();
        };
        window.x2mMonster = (id, x = 39, y = 16) => {
            const m = new Monster(x, y, monsters.find(m => m.id === id));
            m.ticksUntilTurn = 100000; g.monsters.push(m); return m;
        };
    });
    const shot = async label => {
        await page.evaluate(() => window.activeGame.onRenderRequested());
        await page.clock.runFor(100); // Real ticker and sidebar, with a controlled browser clock.
        await page.screenshot({ path: `${out}/browser-${label}.png` });
        rows.push(await page.evaluate(label => {
            const g = window.activeGame;
            return { label, visible: g.grid.getCell(39, 16).isVisible, explored: g.grid.getCell(39, 16).isExplored,
                flare: g.flareLightAt(39, 16), monsterRows: document.querySelectorAll('.monster-entry').length,
                flares: g.activeFlares.map(f => ({ ...f })), text: JSON.parse(window.render_game_to_text()) };
        }, label));
    };
    await page.evaluate(() => { window.x2mScene(); window.x2mMonster('rat'); });
    await shot('before');
    assert.equal(rows.at(-1).visible, false);
    // Real inventory/target transaction: consumes a wand charge and empowers the rat.
    const cast = await page.evaluate(() => {
        const g = window.activeGame, item = window.x2m.ItemLoader.spawnWand('wand_of_empowerment', -1, -1);
        g.player.inventory.addItem(item); g.isInventoryOpen = false;
        g.executeItemCommand('use', item); g.setArcanaTarget(39, 16);
        g.handlePlayerAction('confirm_target');
        g.tickFlareAnimation(10); g.onRenderRequested();
        return { charges: item.charges, powers: g.monsters[0].totalPowerCount, turns: g.stats.turns };
    });
    assert.equal(cast.charges, 0); assert.equal(cast.powers, 1);
    await shot('empowerment'); assert.equal(rows.at(-1).visible, true); assert.equal(rows.at(-1).monsterRows, 1);
    await page.evaluate(() => { window.activeGame.tickFlareAnimation(1000); });
    await shot('after'); assert.equal(rows.at(-1).visible, false); assert.equal(rows.at(-1).explored, true); assert.equal(rows.at(-1).monsterRows, 0);

    await page.evaluate(async () => {
        window.x2mScene();
        const { spawnDungeonFeature, catalogFeature } = await import('/src/engine/Map/DungeonFeature.ts');
        const { DF } = await import('/src/engine/Map/DungeonFeatureCatalog.ts');
        const g = window.activeGame; g.bindDungeonFeatureEffects();
        spawnDungeonFeature(g.grid, 39, 16, catalogFeature(DF.DF_BLOAT_EXPLOSION), false);
        g.tickFlareAnimation(10);
    });
    await shot('explosion-df'); assert(rows.at(-1).flares.length > 0);

    await page.evaluate(() => {
        window.x2mScene(); const g = window.activeGame;
        const m = window.x2mMonster('goblin_conjurer'); g.summonMinionsFor(m); g.tickFlareAnimation(10);
    });
    await shot('summoning'); assert(rows.at(-1).flare.r + rows.at(-1).flare.b > 0);

    await page.evaluate(async () => {
        window.x2mScene(); const g = window.activeGame, { T, L } = window.x2m;
        g.player.setStatusDuration('darkness', 0);
        for (let x = 37; x < 45; x++) for (let y = 12; y < 20; y++) g.grid.setTerrain(x, y, T.WATER_DEEP);
        for (let y = 13; y < 20; y++) g.grid.setTerrainLayer(32, y, L.SURFACE, T.FORCEFIELD);
        g.grid.setTerrainLayer(34, 13, L.SURFACE, T.PLAIN_FIRE);
        window.x2mMonster('wisp', 40, 16); g.updateVision(); g.lightMap.dance();
    });
    await shot('dynamic-a'); assert.equal(rows.at(-1).monsterRows, 1);
    await page.evaluate(async () => {
        const { tickTerrainColors } = await import('/src/engine/UI/DancingColors.ts'); const g = window.activeGame;
        for (let i = 0; i < 30; i++) tickTerrainColors(g.grid, 50, g.depth);
        g.lightMap.dance();
    });
    await shot('dynamic-b');
    // Fresh normal game: idle display frames must not move v2 recording checkpoints.
    await page.evaluate(() => { const g = window.activeGame; g.startNewGame({ seed: 424242, mode: 'normal' }); g.animationEnabled = false; });
    await page.clock.runFor(350);
    await page.keyboard.press('.'); await page.clock.runFor(350); await page.keyboard.press('.');
    const replay = await page.evaluate(() => {
        const g = window.activeGame, recording = g.exportRecording();
        g.loadReplay(recording); g.animationEnabled = false;
        for (let i = 0; i < recording.events.length; i++) g.replayStep(true);
        return { count: recording.events.length, cursor: g.replayCursor, error: g.replayError };
    });
    assert(replay.count >= 2); assert.equal(replay.error, null); assert.equal(replay.cursor, replay.count);
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ errors, cast, replay, rows,
        scope: 'Real menu, item use/target/charge/turn, DF transaction, summoning, Pixi and sidebar; controlled geometry and frame timing.' }, null, 2) + '\n');
} finally { await browser.close(); }
