import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out = 'ai_docs/reports/x2e-evidence', errors = [], rows = [];
const names = ['悬浮符咒', '碎墙符咒', '守卫符咒', '传送符咒', '充能符咒', '消魔符咒'];
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5199');
    await page.locator('.menu-card input[type=text]').fill('424242');
    await page.locator('.menu-card .actions button').first().click();
    await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
    await page.evaluate(async () => {
        const g = window.activeGame, { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
        const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
        g.animationEnabled = true; g.monsters = []; g.dormantMonsters = []; g.items = [];
        g.player.inventory.items = []; g.grid.impregnableCells.clear();
        for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
            g.grid.setTerrain(x, y, x === 0 || y === 0 || x === g.grid.width - 1 || y === g.grid.height - 1 || x === 45 ? T.WALL : T.FLOOR);
            Object.assign(g.grid.getCell(x, y), { hasDormantMonster: false, machineNumber: 0, isPowered: false });
        }
        g.player.loc = { x: 35, y: 15 };
        g.grid.setTerrain(38, 15, T.WALL);
        for (const kind of ['levitation', 'shattering', 'guardian', 'teleportation', 'recharging', 'negation']) {
            const c = ItemLoader.spawnCharm('charm_of_' + kind, -1, -1);
            c.enchantment = 2; g.player.inventory.addItem(c);
        }
        const staff = ItemLoader.spawnStaff('staff_of_fire', -1, -1);
        staff.enchantment = staff.maxCharges = 3; staff.charges = 0; staff.staffRechargeRemaining = 1000;
        g.player.inventory.addItem(staff); ItemLoader.identifyInstance(staff);
        const wand = ItemLoader.spawnWand('wand_of_negation', -1, -1);
        wand.charges = 1; g.player.inventory.addItem(wand); ItemLoader.identifyInstance(wand);
        const scroll = ItemLoader.spawnScroll('scroll_of_enchantment', -1, -1);
        g.player.inventory.addItem(scroll); ItemLoader.identifyInstance(scroll);
        g.updateVision(); g.needsRender = true; g.onRenderRequested();
    });
    const shot = async label => {
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${out}/browser-${label}.png` });
        rows.push({ label, text: await page.evaluate(() => JSON.parse(window.render_game_to_text())) });
    };
    const inventory = async () => {
        if (!await page.evaluate(() => window.activeGame.isInventoryOpen)) await page.keyboard.press('i');
        await page.waitForSelector('.inventory-modal');
    };
    const select = async name => {
        await inventory();
        const row = page.locator('.item-wrapper').filter({ has: page.locator('.item-name').filter({ hasText: name }) });
        await row.locator('.item-row').click();
        return row;
    };
    for (let i = 0; i < names.length; i++) {
        const row = await select(names[i]);
        await row.getByRole('button', { name: '查看详情', exact: true }).click();
        await page.waitForSelector('.detail-panel');
        const text = await page.locator('.detail-panel').innerText();
        assert(text.includes('附魔后') && text.includes('冷却回合'));
        assert(!/charm_of_|Charm of|Unknown/.test(text));
        await shot(`detail-${i + 1}`);
        await page.locator('.detail-close').click();
    }
    const use = async name => {
        const row = await select(name);
        await row.getByRole('button', { name: '使用', exact: true }).click();
        await page.waitForFunction(() => !window.activeGame.isInputLocked());
        if (await page.evaluate(() => window.activeGame.isInventoryOpen)) await page.keyboard.press('Escape');
    };
    const state = () => page.evaluate(() => {
        const g = window.activeGame;
        return { player: { ...g.player.loc }, levitating: g.player.getStatusDuration('levitating'),
            items: g.player.inventory.items.map(i => ({ id: i.identityId || i.consumableId, enchantment: i.enchantment,
                charges: i.charges, cooldown: i.cooldownRemaining })),
            guardians: g.monsters.filter(m => m.typeId === 'guardian_spirit').map(m => ({ id: m.id, hp: m.hp,
                lifespan: m.getStatusDuration('lifespan_remaining'), bound: m.boundToPlayer, independent: m.doesNotTrackLeader, ...m.loc })) };
    });
    await use(names[0]); const levitation = await state(); assert.equal(levitation.levitating, 14);
    await shot('levitation');
    await use(names[1]);
    assert.equal(await page.evaluate(async () => {
        const { TerrainType: T, DungeonLayer: L } = await import('/src/engine/Map/Grid.ts');
        // The shattering DF overlays rubble; the environment may also promote
        // the temporary forcefield during the use turn.
        return [T.FORCEFIELD, T.FLOOR].includes(window.activeGame.grid.getCell(38, 15).layers[L.DUNGEON]);
    }), true);
    await shot('shattering');
    await use(names[4]); const recharging = await state();
    assert.equal(recharging.items.find(i => i.id === 'staff_of_fire').charges, 3);
    assert.equal(recharging.items.find(i => i.id === 'wand_of_negation').charges, 1);
    assert(recharging.items.find(i => i.id === 'charm_of_levitation').cooldown > 0);
    await use(names[3]); const teleportation = await state(); assert(teleportation.player.x > 45);
    await shot('teleportation');
    await use(names[2]); const beforeSave = await state();
    assert.equal(beforeSave.guardians.length, 1); assert.equal(beforeSave.guardians[0].lifespan, 7);
    await shot('guardian');
    await page.locator('.menu-btn').click();
    await page.getByRole('button', { name: '保存游戏', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: '继续游戏', exact: true }).click();
    await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
    await page.waitForFunction(() => window.activeGame.animationEnabled);
    const restored = await state(); assert.deepEqual(restored, beforeSave);
    await shot('restored');
    await use(names[5]); const negation = await state();
    assert.equal(negation.guardians.length, 0); assert.equal(negation.levitating, 0);
    assert(negation.items.find(i => i.id === 'charm_of_recharging').cooldown > 0);
    await shot('negation');
    const scrollRow = await select('附魔卷轴');
    await scrollRow.getByRole('button', { name: '阅读', exact: true }).click();
    await page.waitForFunction(() => window.activeGame.pendingEnchantment);
    await page.locator('.item-row').filter({ hasText: names[0] }).click();
    await page.waitForFunction(() => !window.activeGame.pendingEnchantment && !window.activeGame.isInputLocked());
    const enchanted = await state();
    assert.equal(enchanted.items.find(i => i.id === 'charm_of_levitation').enchantment, 3);
    assert.equal(enchanted.items.find(i => i.id === 'charm_of_levitation').cooldown, 0);
    await shot('enchanted');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ levitation, recharging, teleportation, beforeSave, restored, negation, enchanted, rows, errors }, null, 2) + '\n');
    console.log(`Six details/effects, save-refresh-continue, enchanting; ${rows.length} screenshots; no errors.`);
} finally { await browser.close(); }
