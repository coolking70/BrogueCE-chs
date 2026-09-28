import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = 'ai_docs/reports/x3-u4-evidence', errors = [], results = [];
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5198');
    await page.locator('.menu-card input[type=text]').fill('33004');
    await page.locator('.menu-card .actions button').first().click();
    await page.waitForFunction(() => !!window.activeGame?.onRenderRequested && !!window.render_game_to_text);
    await page.evaluate(async () => {
        const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
        const { Monster, MonsterState } = await import('/src/entities/Monster.ts');
        const data = (await import('/src/data/monsters.json')).default;
        const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
        const { logger } = await import('/src/engine/Systems/Logger.ts');
        window.u4setup = kind => {
            const g = window.activeGame; g.startNewGame({ seed: 33004, mode: 'test' });
            g.animationEnabled = false; g.monsters = []; g.dormantMonsters = []; g.items = [];
            g.visibleMonsters.clear(); g.visibleItems.clear(); g.everSeenMonsters.clear();
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, x >= 5 && x <= 55 && y >= 9 && y <= 11 ? T.FLOOR : T.GRANITE);
                const c = g.grid.getCell(x, y);
                Object.assign(c, { isVisible: false, isClairvoyantVisible: false, isExplored: true, hasMemory: true,
                    isMagicMapped: false, autoSearched: true, machineNumber: 0, rememberedAppearance: null, rememberedLayers: [...c.layers], rememberedItem: null });
            }
            g.player.loc = { x: 10, y: 10 }; g.player.hp = g.player.maxHp = kind === 'combat' ? 16 : 30;
            g.player.equippedWeapon = null; g.player.equippedArmor = null;
            g.player.setStatusDuration('darkness', 1000); g.player.maxStatus.darkness = 1000;
            g.updateVision();
            const x = kind === 'combat' ? 11 : 16, y = kind === 'combat' ? 10 : 9;
            if (kind === 'combat' || kind === 'ally') {
                const m = new Monster(x, y, { ...data.find(m => m.id === 'rat'), hp: 500, defense: 0, accuracy: 100, damage: '1d1+4' });
                m.state = MonsterState.HUNTING; m.isAlly = kind === 'ally'; m.ticksUntilTurn = kind === 'combat' ? 100 : 100000;
                g.monsters.push(m);
            }
            if (kind === 'item') g.items.push(ItemLoader.spawnFood('ration_of_food', x, y));
            if (kind === 'key') g.items.push(ItemLoader.spawnKey('iron_key', x, y));
            if (kind === 'stairs') g.grid.setTerrain(x, y, T.STAIRS_DOWN);
            if (['item', 'key', 'stairs'].includes(kind)) Object.assign(g.grid.getCell(x, y), { isExplored: false, hasMemory: false });
            logger.reset(); g.disturbed = false; g.needsRender = true; g.update();
        };
        window.u4read = () => ({ text: JSON.parse(window.render_game_to_text()), turns: window.activeGame.stats.turns,
            path: window.activeGame.autoPath, disturbed: window.activeGame.disturbed, log: logger.messages.map(m => m.text) });
    });
    await page.evaluate(() => window.u4setup('combat'));
    await page.keyboard.press('Shift+X');
    await page.waitForFunction(() => window.activeGame.stats.turns >= 3 && window.activeGame.autoPath.length === 0);
    let s = await page.evaluate(() => window.u4read());
    results.push({ scene: 'HP brake via X key', state: s, debug: await page.evaluate(() => ({ hp: window.activeGame.player.hp, mode: window.activeGame.mode, monsters: window.activeGame.monsters.map(m => ({ damage: m.damageString, hp: m.hp, state: m.state, loc: m.loc })), statuses: window.activeGame.player.statuses })) });
    assert.equal(s.text.player.hp, 1); assert.equal(s.turns, 3);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/browser-hp-brake.png` });
    for (const key of ['Escape', 'Space', 'q']) {
        await page.evaluate(() => { window.u4setup('empty'); window.activeGame.executeCommand('mouse_travel', { x: 50, y: 10 }); });
        await page.waitForFunction(() => window.activeGame.stats.turns >= 2);
        await page.keyboard.press(key); s = await page.evaluate(() => window.u4read());
        assert.equal(s.path.length, 0); const loc = [s.text.player.x, s.text.player.y];
        await page.waitForTimeout(180);
        const later = await page.evaluate(() => window.u4read());
        assert.deepEqual([later.text.player.x, later.text.player.y], loc);
        results.push({ scene: `${key} stops ticker travel`, state: s });
    }
    for (const kind of ['item', 'ally', 'key', 'stairs']) {
        await page.evaluate(kind => { window.u4setup(kind); window.activeGame.executeCommand('mouse_travel', { x: 24, y: 10 }); }, kind);
        await page.waitForFunction(() => window.activeGame.autoPath.length === 0);
        s = await page.evaluate(() => window.u4read());
        if (kind === 'key' || kind === 'stairs') { assert(s.text.player.x < 16); assert.equal(s.log.length, 1); }
        else { assert.equal(s.text.player.x, 24); assert.equal(s.log.length, 0); }
        results.push({ scene: `${kind} first sight`, state: s });
        if (kind === 'key' || kind === 'stairs') { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/browser-${kind}.png` }); }
    }
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ results, errors }, null, 2) + '\n');
    await browser.close();
}
