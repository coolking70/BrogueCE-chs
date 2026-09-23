import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-23-evidence', browser = await chromium.launch({ headless: false });
const states = [], errors = [];
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5193');
    await page.locator('select').first().selectOption('test');
    await page.locator('.actions button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text);
    await page.evaluate(async () => {
        const { Grid, TerrainType: T } = await import('/src/engine/Map/Grid.ts');
        const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
        const { LightMap } = await import('/src/engine/Lighting/LightMap.ts');
        const { FOVSys } = await import('/src/engine/Lighting/FOV.ts');
        const { Monster, MonsterState } = await import('/src/entities/Monster.ts');
        const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
        const { default: data } = await import('/src/data/monsters.json');
        const g = window.activeGame; g.animationEnabled = false;
        window.w23Setup = (id = 'dar_priestess') => {
            g.grid = new Grid(g.grid.width, g.grid.height);
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, x > 0 && x < 18 && y > 0 && y < 12 ? T.FLOOR : T.GRANITE);
                Object.assign(g.grid.getCell(x, y), { isVisible: true, hasMemory: true, isDiscovered: true });
            }
            g.environment = new EnvironmentManager(g.grid); g.lightMap = new LightMap(g.grid); g.fov = new FOVSys(g.grid);
            g.player.loc = { x: 4, y: 5 }; g.player.hp = g.player.maxHp = 100; g.player.statusDurations = {}; g.player.poisonAmount = 0;
            g.player.ticksUntilTurn = 0; g.player.refreshSpeeds(); g.ticksTillUpdateEnvironment = 100;
            g.player.inventory.items = []; g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
            g.isInventoryOpen = false; g.inspectTarget = null; g.pendingArcana = null; g.dormantMonsters = []; g.items = [];
            g.pendingBoltFrames = []; g.floatingTexts = []; g.autoPath = []; g.isMouseTraveling = false; g.levels.clear();
            const m = new Monster(8, 5, data.find(d => d.id === id)); m.state = MonsterState.HUNTING; m.ticksUntilTurn = 100000;
            g.monsters = [m]; window.w23Target = m;
            g.updateVision(); g.needsRender = true; g.update();
        };
        window.w23Read = () => { const scroll = ItemLoader.spawnScroll('scroll_of_negation', -1, -1); g.player.inventory.addItem(scroll); g.readItem(scroll); };
        window.w23Setup();
    });
    const capture = async name => {
        await page.evaluate(() => { const g = window.activeGame; g.needsRender = true; g.update(); });
        await page.waitForTimeout(300);
        const state = await page.evaluate(() => ({ text: JSON.parse(window.render_game_to_text()),
            monsters: window.activeGame.monsters.map(m => ({ type: m.typeId, hp: m.hp, wasNegated: m.wasNegated,
                bolts: m.bolts, flags: [...m.behaviorFlags], abilities: [...m.abilityFlags], statuses: { ...m.statusDurations }, poison: m.poisonAmount })),
            player: { statuses: { ...window.activeGame.player.statusDurations }, poison: window.activeGame.player.poisonAmount } }));
        states.push({ name, state }); await page.screenshot({ path: `${dir}/browser-${name}.png`, fullPage: true }); return state;
    };
    await page.evaluate(() => { const g = window.activeGame, m = window.w23Target; m.empower(); m.newPowerCount = 0; m.applyShield(130); m.addPoison(8, 2); m.setStatusDuration('hasted', 8); g.player.addPoison(8, 2); g.player.setStatusDuration('hasted', 8); });
    await capture('before-scroll'); await page.evaluate(() => window.w23Read()); let s = await capture('after-scroll');
    assert.deepEqual(s.monsters[0].bolts, []); assert.equal(s.monsters[0].wasNegated, true); assert.equal(s.monsters[0].poison, 2); assert.equal(s.player.poison, 2);
    assert.ok(!s.monsters[0].statuses.hasted && !s.monsters[0].statuses.shielded);
    await page.evaluate(() => window.activeGame.handleInspectAt(8, 5)); await capture('negated-detail');
    assert.ok(await page.getByText('特殊能力已被消除。').count()); await page.locator('.detail-close').click();
    await page.evaluate(() => { const g = window.activeGame; g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot()))); });
    s = await capture('save-restore'); assert.equal(s.monsters[0].wasNegated, true); assert.deepEqual(s.monsters[0].bolts, []);
    await page.evaluate(() => { window.w23Setup('vampire_bat'); });
    // Use catalog enum rather than any numeric terrain assumption.
    await page.evaluate(async () => { const { TerrainType: T } = await import('/src/engine/Map/Grid.ts'); const g = window.activeGame;
        g.grid.setTerrain(8, 5, T.LAVA); g.updateVision(); });
    await capture('flying-over-lava'); await page.evaluate(() => window.w23Read()); s = await capture('lost-flight'); assert.equal(s.monsters.length, 0);
    await page.evaluate(() => { window.w23Setup('dar_priestess'); const g = window.activeGame; g.player.addPoison(7, 3); g.player.setStatusDuration('hasted', 7); g.castMonsterBolt(window.w23Target, g.player, 'NEGATION'); });
    s = await capture('monster-negates-player'); assert.ok(!s.player.statuses.hasted); assert.equal(s.player.poison, 3);
    for (const id of ['wisp', 'stone_guardian', 'rat']) {
        await page.evaluate(id => { window.w23Setup(id); window.w23Target.behaviorFlags.add('MONST_DIES_IF_NEGATED'); window.w23Read(); }, id);
        s = await capture(`death-${id}`); assert.equal(s.monsters.length, 0);
    }
    assert.deepEqual(errors, []); console.log(JSON.stringify({ scenarios: states.map(s => s.name), errors }));
} finally { fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2) + '\n'); await browser.close(); }
