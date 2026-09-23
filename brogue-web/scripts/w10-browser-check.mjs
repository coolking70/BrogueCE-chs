// W-10: real keyboard submission, then inspect poison contact and objective pulse.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-10-evidence';
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
    for (const [mode, E] of [['target', 2], ['stack', 3], ['reflect', 8], ['immune', 3], ['miss', 2], ['death', 2], ['half', 3]]) {
        await page.evaluate(async ({ mode, E }) => {
            const { Grid, TerrainType: T } = await import('/src/engine/Map/Grid.ts');
            const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
            const { Monster } = await import('/src/entities/Monster.ts');
            const { default: data } = await import('/src/data/monsters.json');
            const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
            const { logger } = await import('/src/engine/Systems/Logger.ts');
            const { LightMap } = await import('/src/engine/Lighting/LightMap.ts');
            const { FOVSys } = await import('/src/engine/Lighting/FOV.ts');
            const g = window.activeGame, Game = g.constructor;
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
            if (mode === 'half') g.player.applyStatus('hasted', 100);
            g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
            g.items = []; g.floatingTexts = []; g.pendingBoltFrames = []; g.monsters = []; g.dormantMonsters = [];
            if (mode !== 'miss') {
                const m = new Monster(8, 5, data.find(d => d.id === (mode === 'reflect' ? 'stone_guardian' : 'rat')));
                m.hp = mode === 'death' ? 1 : 50; m.maxHp = 100; m.ticksUntilTurn = 100000;
                m.goldDropChance = m.itemDropChance = 0; m.regenTurns = 0; g.monsters.push(m);
                if (mode === 'stack') m.addPoison(3);
                if (mode === 'immune') m.statusImmunities.add('poisoned');
            }
            const item = ItemLoader.spawnStaff('staff_of_poison', -1, -1);
            Object.assign(item, { enchantment: E, maxCharges: E, charges: 1 }); g.player.inventory.items = [item];
            const capture = () => ({ E: item.enchantment, charges: item.charges, hp: g.player.hp,
                amount: g.player.poisonAmount, duration: g.player.getStatusDuration('poisoned'),
                monsters: g.monsters.map(m => ({ hp: m.hp, amount: m.poisonAmount, duration: m.getStatusDuration('poisoned') })) });
            g.zapBoltFromPlayer = function (...args) {
                const r = Game.prototype.zapBoltFromPlayer.apply(this, args);
                window.w10Contact = { ...capture(), autoID: r.outcome.autoID, reflections: r.reflections.length,
                    hits: r.hits.map(h => h.creature === g.player ? 'player' : h.creature.typeId) };
                return r;
            };
            window.w10Capture = capture;
            g.updateVision(); g.useArcanaItem(item); g.setArcanaTarget(8, 5); g.needsRender = true;
        }, { mode, E });
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !window.activeGame.pendingArcana);
        await page.waitForTimeout(350);
        const state = await page.evaluate(async () => ({ contact: window.w10Contact, final: window.w10Capture(),
            text: JSON.parse(window.render_game_to_text()), logs: (await import('/src/engine/Systems/Logger.ts')).logger.messages.map(m => m.text) }));
        assert.equal(state.final.charges, 0); assert.equal(state.final.E, E);
        assert.equal(state.contact.autoID, !['miss', 'immune'].includes(mode), JSON.stringify({mode, state}));
        assert.equal(state.text.player.poisonAmount, state.final.amount);
        if (mode === 'reflect') { assert.equal(state.contact.reflections, 1); assert.equal(state.contact.duration, 24); assert.equal(state.final.hp, 99); assert.equal(state.final.duration, 23); }
        else if (mode === 'death') { assert.equal(state.contact.monsters[0].hp, 1); assert.equal(state.final.monsters.length, 0); }
        else if (mode === 'miss') assert.equal(state.final.monsters.length, 0);
        else {
            const [hp, amount, duration] = mode === 'target' ? [49, 1, 4] : mode === 'stack' ? [48, 2, 8] : mode === 'half' ? [50, 1, 6] : [50, 0, 0];
            assert.deepEqual(state.final.monsters[0], { hp, amount, duration });
        }
        states.push({ mode, E, ...state });
        await page.screenshot({ path: `${dir}/browser-${mode}.png`, fullPage: true });
        if (mode === 'half') {
            await page.waitForFunction(() => !window.activeGame.isInputLocked());
            await page.evaluate(() => window.activeGame.handlePlayerAction('wait'));
            await page.waitForTimeout(350);
            const second = await page.evaluate(() => window.w10Capture());
            assert.deepEqual(second.monsters[0], { hp: 49, amount: 1, duration: 5 });
            states.push({ mode: 'half-second-action', ...second });
        }
    }
    fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ scenarios: states.map(s => s.mode), errors }));
} finally { await browser.close(); }
