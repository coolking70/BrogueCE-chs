// Run after starting Vite on 127.0.0.1:5176. Fixture setup only; actions use real keys/UI.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'output/w6-browser';
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto('http://127.0.0.1:5176');
    await page.locator('select').first().selectOption('test');
    await page.locator('.actions button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text);
    const labels = await page.evaluate(async () => {
        const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
        const g = window.activeGame;
        const staff = ItemLoader.spawnStaff('staff_of_lightning', 0, 0);
        Object.assign(staff, { enchantment: 3, maxCharges: 3, charges: 1, staffRechargeRemaining: 20, identified: true });
        const wand = ItemLoader.spawnWand('wand_of_slowness', 0, 0);
        wand.charges = 0; wand.identified = true;
        const charm = ItemLoader.spawnCharm('charm_of_health', 0, 0);
        charm.cooldownRemaining = 1000;
        const scroll = ItemLoader.spawnScroll('scroll_of_recharging', 0, 0);
        ['staff_of_lightning','wand_of_slowness','charm_of_health','scroll_of_recharging'].forEach(id => ItemLoader.identifiedItems.add(id));
        g.player.inventory.items = [staff, wand, charm, scroll];
        g.player.ringLeft = g.player.ringRight = null;
        g.monsters = []; g.player.applyStatus('haste', 100); g.player.refreshSpeeds();
        return { staff: staff.name, scroll: scroll.name };
    });
    const states = [];
    const record = async label => {
        const state = await page.evaluate(async () => ({
            text: JSON.parse(window.render_game_to_text()),
            logs: (await import('/src/engine/Systems/Logger.ts')).logger.messages.map(m => m.text),
            gate: window.activeGame.ticksTillUpdateEnvironment,
            inventory: window.activeGame.player.inventory.items.map(i => ({ name: i.displayName, category: i.category,
                E: i.enchantment, capacity: i.maxCharges, charges: i.charges, timer: i.staffRechargeRemaining, cooldown: i.cooldownRemaining }))
        }));
        states.push({ label, ...state });
        return state;
    };
    await record('initial');
    for (let i = 1; i <= 4; i++) {
        await page.keyboard.press('.');
        await page.waitForTimeout(100);
        const s = await record(`haste-action-${i}`);
        assert.equal(s.inventory[0].charges, i === 4 ? 2 : 1);
        assert.equal(s.inventory[1].charges, 0);
        if (i < 4) assert.equal(s.inventory[0].timer, i === 1 ? 20 : 10);
    }
    await page.keyboard.press('i');
    await page.locator('.inventory-modal').waitFor();
    await page.screenshot({ path: `${dir}/natural-charge.png`, fullPage: true });
    const scrollRow = page.locator('.item-wrapper').filter({ hasText: labels.scroll });
    await scrollRow.locator('.item-row').click();
    await scrollRow.locator('.item-actions button').nth(1).click();
    await page.waitForTimeout(150);
    const s = await record('read-recharging-scroll');
    assert.deepEqual([s.inventory[0].E,s.inventory[0].capacity,s.inventory[0].charges,s.inventory[0].timer], [3,3,3,1666]);
    assert.equal(s.inventory[1].charges, 0);
    assert.equal(s.inventory[2].cooldown, 0);
    assert.equal(s.inventory.length, 3);
    assert.ok(s.logs.every(m => !m.includes('&#x2F;')));
    if (!(await page.locator('.inventory-modal').isVisible())) await page.keyboard.press('i');
    await page.screenshot({ path: `${dir}/scroll-charge.png`, fullPage: true });
    await page.evaluate(() => { const g=window.activeGame; g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot()))); });
    const saved = await record('JSON-reload');
    assert.deepEqual(saved.inventory, s.inventory);
    assert.equal(saved.gate, s.gate);
    fs.writeFileSync(`${dir}/states.json`, JSON.stringify({ states, errors }, null, 2)+'\n');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks: '4 haste actions, natural recharge, real scroll read, JSON reload', errors }));
} finally { await browser.close(); }
