// Fixture setup through real engine constructors; submission through real keyboard Enter.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-8-evidence';
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
    for (const [label, id, E, targets] of [
        ['fire-e2', 'staff_of_fire', 2, [['rat', 8, 5]]],
        ['lightning-e3', 'staff_of_lightning', 3, [['rat', 6, 5], ['rat', 9, 5]]],
        ['reflected-e8', 'staff_of_fire', 8, [['stone_guardian', 8, 5]]],
        ['immune-e8', 'staff_of_fire', 8, [['salamander', 8, 5]]],
        ['split-e8', 'staff_of_fire', 8, [['pink_jelly', 8, 5]]],
    ]) {
        await page.evaluate(async ({ id, E, targets }) => {
            const { Grid, TerrainType: T } = await import('/src/engine/Map/Grid.ts');
            const { EnvironmentManager } = await import('/src/engine/Environment/Gas.ts');
            const { Monster } = await import('/src/entities/Monster.ts');
            const { default: data } = await import('/src/data/monsters.json');
            const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
            const { rng } = await import('/src/engine/Random.ts');
            const { logger } = await import('/src/engine/Systems/Logger.ts');
            logger.messages.length = 0;
            const g = window.activeGame, Game = g.constructor; // Do not load a second HMR-versioned Game singleton.
            g.grid = new Grid(g.grid.width, g.grid.height);
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, T.FLOOR);
                Object.assign(g.grid.getCell(x,y), { isVisible: true, hasMemory: true });
            }
            g.environment = new EnvironmentManager(g.grid);
            g.player.loc = { x: 4, y: 5 }; g.player.hp = g.player.maxHp = 500;
            g.player.statusDurations = {}; g.player.refreshSpeeds();
            g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
            g.items = []; g.floatingTexts = []; g.pendingBoltFrames = [];
            g.monsters = targets.map(([type, x, y]) => {
                const m = new Monster(x, y, data.find(d => d.id === type));
                m.hp = m.maxHp = 500; m.ticksUntilTurn = 100000; return m;
            });
            const item = ItemLoader.spawnStaff(id, -1, -1);
            Object.assign(item, { enchantment: E, maxCharges: E, charges: 1, identified: true });
            ItemLoader.identifyItemKind(item);
            g.player.inventory.items = [item];
            const capture = () => ({ E: item.enchantment, charges: item.charges, hp: g.player.hp,
                statuses: { ...g.player.statusDurations }, monsters: g.monsters.map(m => ({ id: m.typeId, hp: m.hp, statuses: { ...m.statusDurations } })) });
            g.zapBoltFromPlayer = function (...args) {
                const result = Game.prototype.zapBoltFromPlayer.apply(this, args);
                window.w8Contact = { ...capture(), hits: result.hits.map(h => h.creature === g.player ? 'player' : h.creature.typeId),
                    reflections: result.reflections.length, autoID: result.outcome.autoID };
                return result;
            };
            window.w8Capture = capture;
            rng.seedRandomGenerator(32);
            g.useArcanaItem(item);
            // Known fire immunity excludes automatic candidates; explicit targeting must still collide.
            g.pendingArcana.cursor = { x: targets[0][1], y: targets[0][2] };
            g.needsRender = true;
        }, { id, E, targets });
        const selected = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
        assert.equal(selected.mode, 'arcana_target', label);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !window.activeGame.pendingArcana);
        await page.waitForTimeout(300);
        const state = await page.evaluate(async () => ({ contact: window.w8Contact, final: window.w8Capture(), text: JSON.parse(window.render_game_to_text()),
            logs: (await import('/src/engine/Systems/Logger.ts')).logger.messages.map(m => m.text) }));
        states.push({ label, selected, ...state });
        assert.equal(state.final.E, E); assert.equal(state.final.charges, 0);
        assert.equal(state.text.player.hp, state.final.hp);
        assert.equal(state.contact.autoID, true);
        assert.ok(state.logs.every(m => !m.includes('&#x2F;')));
        if (label === 'fire-e2') {
            assert.ok(state.contact.monsters[0].hp >= 491 && state.contact.monsters[0].hp <= 497);
            assert.equal(state.contact.monsters[0].statuses.burning, 7);
        } else if (label === 'lightning-e3') {
            assert.deepEqual(state.contact.hits, ['rat', 'rat']);
            assert.ok(state.contact.monsters.every(m => m.hp >= 489 && m.hp <= 497 && !m.statuses.burning));
        } else if (label === 'reflected-e8') {
            assert.deepEqual(state.contact.hits, ['player']); assert.equal(state.contact.reflections, 1);
            assert.equal(state.contact.hp, 481); assert.equal(state.contact.monsters[0].hp, 500);
            assert.equal(state.contact.statuses.burning, 7);
        } else if (label === 'immune-e8') {
            assert.deepEqual(state.contact.hits, ['salamander']); assert.equal(state.contact.monsters[0].hp, 500);
            assert.ok(!state.contact.monsters[0].statuses.burning);
        } else {
            assert.equal(state.contact.monsters.length, 2);
            assert.deepEqual(state.contact.monsters.map(m => m.hp), [241, 241]);
            assert.equal(state.contact.monsters[0].statuses.burning, 7);
        }
        await page.screenshot({ path: `${dir}/browser-${label}.png`, fullPage: true });
    }
    fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ scenarios: states.map(s => s.label), errors }));
} finally { await browser.close(); }
