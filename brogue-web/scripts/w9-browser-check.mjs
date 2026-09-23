// Real page keyboard submission; discord uses the existing CE effect contract (no new item).
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-9-evidence';
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
    for (const [label, id, mode] of [
        ['heal-target', 'staff_of_healing', 'target'], ['haste-target', 'staff_of_haste', 'target'],
        ['slow-target', 'wand_of_slowness', 'target'], ['invisible-target', 'wand_of_invisibility', 'target'],
        ['heal-miss', 'staff_of_healing', 'miss'], ['haste-miss', 'staff_of_haste', 'miss'],
        ['invisible-miss', 'wand_of_invisibility', 'miss'],
        ['heal-reflect', 'staff_of_healing', 'reflect'], ['haste-reflect', 'staff_of_haste', 'reflect'],
        ['invisible-reflect', 'wand_of_invisibility', 'reflect'], ['discord-target', 'staff_of_haste', 'discord'],
    ]) {
        await page.evaluate(async ({ id, mode }) => {
            const { Grid, TerrainType: T } = await import('/src/engine/Map/Grid.ts');
            const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
            const { Monster } = await import('/src/entities/Monster.ts');
            const { default: data } = await import('/src/data/monsters.json');
            const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
            const { logger } = await import('/src/engine/Systems/Logger.ts');
            const g = window.activeGame, Game = g.constructor;
            logger.messages.length = 0; ItemLoader.identifiedItems.clear();
            const { LightMap } = await import('/src/engine/Lighting/LightMap.ts');
            const { FOVSys } = await import('/src/engine/Lighting/FOV.ts');
            g.grid = new Grid(g.grid.width, g.grid.height);
            g.lightMap = new LightMap(g.grid); g.fov = new FOVSys(g.grid);
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, T.FLOOR); Object.assign(g.grid.getCell(x,y), { isVisible: true, hasMemory: true });
            }
            g.environment = new EnvironmentManager(g.grid);
            g.player.loc = { x: 4, y: 5 }; g.player.maxHp = 101; g.player.hp = 50;
            g.player.statusDurations = {}; g.player.refreshSpeeds();
            g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
            g.items = []; g.floatingTexts = []; g.pendingBoltFrames = []; g.monsters = [];
            if (mode !== 'miss') {
                const m = new Monster(8, 5, data.find(d => d.id === (mode === 'reflect' ? 'stone_guardian' : 'rat')));
                m.hp = 1; m.maxHp = 101; m.ticksUntilTurn = 100000; m.isAlly = true; g.monsters.push(m);
            }
            const item = id.startsWith('staff') ? ItemLoader.spawnStaff(id, -1, -1) : ItemLoader.spawnWand(id, -1, -1);
            Object.assign(item, { enchantment: 3, maxCharges: 3, charges: 1 });
            g.player.inventory.items = [item];
            const capture = () => ({ E: item.enchantment, charges: item.charges, hp: g.player.hp,
                statuses: { ...g.player.statusDurations }, monsters: g.monsters.map(m => ({ id: m.typeId, hp: m.hp, statuses: { ...m.statusDurations } })) });
            g.zapBoltFromPlayer = function (...args) {
                const result = Game.prototype.zapBoltFromPlayer.apply(this, args);
                window.w9Contact = { ...capture(), hits: result.hits.map(h => h.creature === g.player ? 'player' : h.creature.typeId),
                    reflections: result.reflections.length, autoID: result.outcome.autoID };
                return result;
            };
            window.w9Capture = capture;
            if (mode === 'discord') {
                const { getBoltForItem, BoltEffect } = await import('/src/engine/Combat/Bolt.ts');
                const { CEBoltType } = await import('/src/engine/Combat/BoltCatalog.ts');
                g.zapBoltFromPlayer({ ...getBoltForItem(id), ceType: CEBoltType.DISCORD, effect: BoltEffect.DISCORD }, item, { x: 8, y: 5 });
            } else {
                g.useArcanaItem(item); g.setArcanaTarget(8, 5);
            }
            g.needsRender = true;
        }, { id, mode });
        if (mode !== 'discord') {
            assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).mode, 'arcana_target');
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => !window.activeGame.pendingArcana);
        }
        await page.waitForTimeout(400);
        const state = await page.evaluate(async () => ({ contact: window.w9Contact, final: window.w9Capture(), text: JSON.parse(window.render_game_to_text()),
            logs: (await import('/src/engine/Systems/Logger.ts')).logger.messages.map(m => m.text) }));
        states.push({ label, ...state });
        assert.equal(state.final.charges, mode === 'discord' ? 1 : 0); assert.equal(state.final.E, 3);
        assert.equal(state.text.player.hp, state.final.hp); assert.ok(state.logs.every(m => !m.includes('&#x2F;')));
        assert.deepEqual(state.contact.hits, mode === 'miss' ? [] : mode === 'reflect' ? ['player'] : ['rat']);
        assert.equal(state.contact.autoID, mode !== 'miss');
        if (mode === 'miss') { assert.equal(state.contact.hp, 50); assert.deepEqual(state.contact.statuses, {}); }
        else {
            const target = mode === 'reflect' ? state.contact : state.contact.monsters[0];
            if (mode === 'discord') { assert.equal(target.statuses.discordant, 12); assert.ok(!target.statuses.confused); }
            else if (id === 'staff_of_healing') assert.equal(target.hp, mode === 'reflect' ? 80 : 31);
            else if (id === 'staff_of_haste') assert.equal(target.statuses.hasted, 14);
            else if (id === 'wand_of_slowness') assert.equal(target.statuses.slowed, 50);
            else assert.equal(target.statuses.invisible, 150);
            if (mode !== 'reflect') { assert.equal(state.contact.hp, 50); assert.deepEqual(state.contact.statuses, {}); }
        }
        await page.screenshot({ path: `${dir}/browser-${label}.png`, fullPage: true });
    }
    fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ scenarios: states.map(s => s.label), errors }));
} finally { await browser.close(); }
