// Fixture setup uses engine constructors; reading, selection and cancellation use the real Vue UI.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-7-evidence';
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], states = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto('http://127.0.0.1:5177');
    await page.locator('select').first().selectOption('test');
    await page.locator('.actions button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text);
    await page.evaluate(async () => {
        const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
        const g = window.activeGame;
        const staff = ItemLoader.spawnStaff('staff_of_lightning', 0, 0);
        Object.assign(staff, { enchantment: 3, maxCharges: 3, charges: 1, staffRechargeRemaining: 2700,
            identified: false, maxChargesKnown: true });
        const wand = ItemLoader.spawnWand('wand_of_teleportation', 0, 0);
        Object.assign(wand, { charges: 1, maxCharges: 1, identified: true });
        ItemLoader.identifiedItems.add('wand_of_teleportation');
        const scroll1 = ItemLoader.spawnScroll('scroll_of_enchantment', 0, 0);
        const scroll2 = ItemLoader.spawnScroll('scroll_of_enchantment', 0, 0);
        const food = ItemLoader.spawnFood('food_ration', 0, 0);
        g.player.inventory.items = [staff, wand, scroll1, scroll2, food].filter(Boolean);
        g.player.equippedWeapon = g.player.equippedArmor = null;
        g.player.ringLeft = g.player.ringRight = null;
        g.monsters = [];
        g.player.statusDurations = {}; g.player.refreshSpeeds();
    });
    const record = async label => {
        const state = await page.evaluate(async () => ({
            text: JSON.parse(window.render_game_to_text()),
            logs: (await import('/src/engine/Systems/Logger.ts')).logger.messages.map(m => m.text),
            pending: window.activeGame.pendingEnchantment, turns: window.activeGame.stats.turns,
            gate: window.activeGame.ticksTillUpdateEnvironment,
            inventory: window.activeGame.player.inventory.items.map(i => ({ name: i.displayName, category: i.category,
                E: i.enchantment, capacity: i.maxCharges, charges: i.charges, timer: i.staffRechargeRemaining,
                identified: i.identified, maxChargesKnown: i.maxChargesKnown }))
        }));
        states.push({ label, ...state }); return state;
    };
    const initial = await record('initial');
    await page.keyboard.press('i');
    await page.locator('.inventory-modal').waitFor();
    // Closing before read is an ordinary free inventory cancellation.
    await page.locator('.close-btn').click();
    const closed = await record('closed-before-read');
    assert.deepEqual(closed.inventory, initial.inventory);
    assert.equal(closed.turns, initial.turns);
    await page.keyboard.press('i');
    const readFirstScroll = async () => {
        const row = page.locator('.category-block').filter({ has: page.locator('h3', { hasText: 'SCROLLS' }) }).locator('.item-wrapper').first();
        await row.locator('.item-row').click();
        await row.locator('.item-actions button').filter({ hasText: 'Read' }).click();
        await page.locator('.enchant-banner').waitFor();
    };
    await readFirstScroll();
    const pending = await record('read-awaiting-target');
    assert.equal(pending.text.mode, 'enchantment_target');
    assert.equal(pending.text.enchantmentTargets.length, 2);
    assert.equal(pending.turns, initial.turns);
    assert.equal(await page.locator('.enchant-candidate').count(), 2);
    assert.equal(await page.locator('.close-btn').isDisabled(), true);
    assert.equal(await page.locator('.item-actions').count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('.inventory-overlay').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('.');
    // The other scroll is not an eligible target.
    await page.locator('.category-block').filter({ has: page.locator('h3', { hasText: 'SCROLLS' }) }).locator('.item-row').click();
    const invalid = await record('cancel-and-invalid-target');
    assert.equal(invalid.pending, true);
    assert.equal(invalid.turns, initial.turns);
    assert.deepEqual(invalid.inventory, pending.inventory);
    await page.screenshot({ path: `${dir}/browser-select.png`, fullPage: true });
    // Reorder the live pack during the modal: click still resolves to the original item.
    await page.evaluate(() => window.activeGame.player.inventory.items.reverse());
    await page.waitForTimeout(150);
    await page.locator('.category-block').filter({ has: page.locator('h3', { hasText: 'STAFFS' }) }).locator('.enchant-candidate').click();
    await page.waitForTimeout(150);
    const staffDone = await record('staff-enchanted');
    const staff = staffDone.inventory.find(i => i.timer !== undefined);
    assert.deepEqual([staff.E,staff.capacity,staff.charges,staff.timer], [4,4,2,115]);
    assert.equal(staff.identified, false);
    assert.ok(staff.name.includes('?/4'));
    assert.equal(staffDone.turns, initial.turns + 1);
    await page.keyboard.press('i');
    await page.locator('.inventory-modal').waitFor();
    await page.screenshot({ path: `${dir}/browser-staff.png`, fullPage: true });
    await readFirstScroll();
    // Save/load while pending: target belongs to restored objects, not stale Vue proxies.
    await page.evaluate(() => { const g=window.activeGame; g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot()))); });
    await page.waitForTimeout(150);
    assert.equal((await record('pending-JSON-reload')).pending, true);
    await page.locator('.category-block').filter({ has: page.locator('h3', { hasText: 'WANDS' }) }).locator('.enchant-candidate').click();
    await page.waitForTimeout(150);
    const wandDone = await record('wand-enchanted');
    const wand = wandDone.inventory.find(i => i.timer === undefined && i.capacity === 1);
    assert.deepEqual([wand.E,wand.capacity,wand.charges], [0,1,4]);
    assert.equal(wandDone.turns, initial.turns + 2);
    assert.ok(wandDone.logs.every(m => !m.includes('&#x2F;')));
    await page.keyboard.press('i');
    await page.locator('.inventory-modal').waitFor();
    await page.screenshot({ path: `${dir}/browser-wand.png`, fullPage: true });
    await page.evaluate(() => { const g=window.activeGame; g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot()))); });
    assert.deepEqual((await record('completed-JSON-reload')).inventory, wandDone.inventory);
    fs.writeFileSync(`${dir}/browser-states.json`, JSON.stringify({ states, errors }, null, 2)+'\n');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks: 'pre-read cancel, mandatory selection, invalid target, reordered raw references, staff/wand enchanting, pending/completed JSON reload', errors }));
} finally { await browser.close(); }
