// Controlled inventory fixture; all reads, selections and cancellations use mounted Vue UI.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = 'ai_docs/reports/x2d-evidence';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { windowsHide: true, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', b => serverLog += b); server.stderr.on('data', b => serverLog += b);
let browser;
try {
    for (let i = 0; i < 100; i++) {
        try { if ((await fetch('http://127.0.0.1:5186')).ok) break; } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const errors = [], states = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5186');
    await page.locator('select').first().selectOption('test');
    await page.locator('.actions button').first().click();
    await page.waitForFunction(() => window.activeGame?.player && !window.activeGame.isAdvancing);
    await page.evaluate(() => window.activeGame.startNewGame({ seed: 27027, mode: 'test' }));
    const configure = async () => page.evaluate(async () => {
        const g = window.activeGame;
        const { ItemLoader: L } = await import('/src/engine/Items/ItemLoader.ts');
        g.monsters = []; g.player.inventory.items = [];
        g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
        const worn = L.spawnWeapon('dagger', -1, -1);
        const spare = L.spawnWeapon('sword', -1, -1);
        Object.assign(spare, { enchantment: -3, strengthRequired: 12, isCursed: true, runicType: undefined, identified: true });
        const armor = L.spawnArmor('leather_armor', -1, -1);
        Object.assign(armor, { enchantment: -2, isCursed: true });
        const darts = L.spawnWeapon('dart', -1, -1); darts.quantity = 15;
        const ring = L.spawnRing('ring_of_light', -1, -1);
        Object.assign(ring, { enchantment: -3, isCursed: true });
        const staff = L.spawnStaff('staff_of_lightning', -1, -1);
        const wand = L.spawnWand('wand_of_teleportation', -1, -1);
        const charm = L.spawnCharm('charm_of_health', -1, -1);
        const scroll = L.spawnScroll('scroll_of_enchantment', -1, -1); scroll.quantity = 2;
        const curse = L.spawnScroll('scroll_of_remove_curse', -1, -1);
        curse.quantity = 2;
        for (const i of [worn, spare, armor, darts, ring, staff, wand, charm, scroll, curse]) g.player.inventory.addItem(i);
        g.player.equippedWeapon = worn; g.player.equippedArmor = armor;
        window.x2dItems = { worn, spare, armor, darts, ring, staff, wand, charm, scroll, curse };
        return Object.fromEntries(Object.entries(window.x2dItems).map(([key, i]) => [key, { id: i.id, name: i.displayName, letter: i.inventoryLetter }]));
    });
    const names = await configure();
    const record = async label => {
        const state = await page.evaluate(async () => {
            const g = window.activeGame;
            return { pending: g.pendingEnchantment, open: g.isInventoryOpen, turns: g.stats.turns,
                inventory: g.player.inventory.items.map(i => ({ id: i.id, name: i.displayName, category: i.category, E: i.enchantment, strength: i.strengthRequired, times: i.timesEnchanted, cursed: i.isCursed, quantity: i.quantity, quiver: i.quiverNumber, runic: i.runicType, known: i.runicKnown })),
                rng: (await import('/src/engine/Random.ts')).rng.getState(),
                logs: (await import('/src/engine/Systems/Logger.ts')).logger.messages.map(m => m.text) };
        });
        states.push({ label, ...state }); return state;
    };
    const initial = await record('initial');
    await page.keyboard.press('i'); await page.locator('.inventory-modal').waitFor();
    await page.locator('.close-btn').click(); await page.locator('.inventory-modal').waitFor({ state: 'hidden' });
    const closed = await record('cancel-before-read');
    assert.deepEqual(closed.inventory, initial.inventory); assert.equal(closed.turns, initial.turns);
    await page.keyboard.press('i'); await page.locator('.inventory-modal').waitFor();
    const rowByLetter = letter => page.locator('.item-wrapper').filter({ has: page.locator('.item-letter', { hasText: letter }) });
    // Stable inventory letters survive item removal and are also used by U27 dispatch.
    const read = async letter => {
        const row = rowByLetter(letter);
        await row.locator('.item-row').click();
        await row.locator('.item-actions button').filter({ hasText: /阅读|朗读|Read/ }).click();
    };
    await read(names.scroll.letter); await page.locator('.enchant-banner').waitFor();
    const pending = await record('pending');
    assert.equal(await page.locator('.enchant-candidate').count(), 8);
    assert.equal(await page.locator('.close-btn').isDisabled(), true);
    assert.equal(await page.locator('.item-actions').count(), 0);
    assert.match(await page.locator('.enchant-banner').innerText(), /武器、护甲、戒指、法杖、魔杖或护符/);
    await page.keyboard.press('Escape');
    await page.locator('.inventory-overlay').click({ position: { x: 10, y: 10 } });
    await rowByLetter(names.curse.letter).locator('.item-row').click();
    const refused = await record('cancel-and-ineligible');
    assert.equal(refused.pending, true); assert.equal(refused.turns, initial.turns);
    assert.deepEqual(refused.inventory, pending.inventory); assert.deepEqual(refused.rng, pending.rng);
    await page.screenshot({ path: `${out}/browser-selection.png`, fullPage: true });
    await rowByLetter(names.spare.letter).locator('.item-row').click();
    await page.waitForFunction(() => !window.activeGame.pendingEnchantment && !window.activeGame.isAdvancing);
    const spareDone = await record('spare-enchanted');
    const spare = spareDone.inventory.find(i => i.id === names.spare.id);
    assert.deepEqual([spare.E, spare.strength, spare.times, spare.cursed, spare.runic], [-2, 11, 1, false, undefined]);
    assert.deepEqual(spareDone.inventory.find(i => i.id === names.worn.id), initial.inventory.find(i => i.id === names.worn.id));
    await page.keyboard.press('i'); await page.locator('.inventory-modal').waitFor();
    await read(names.scroll.letter); await page.locator('.enchant-banner').waitFor();
    await rowByLetter(names.darts.letter).locator('.item-row').click();
    await page.waitForFunction(() => !window.activeGame.pendingEnchantment && !window.activeGame.isAdvancing);
    const stackDone = await record('stack-enchanted');
    assert.equal(stackDone.inventory.find(i => i.id === names.darts.id).quantity, 15);
    assert.equal(stackDone.inventory.find(i => i.id === names.darts.id).E, 1);
    assert.equal(stackDone.turns, initial.turns + 2);
    for (const label of ['remove-curse-effect', 'remove-curse-empty']) {
        await page.keyboard.press('i'); await page.locator('.inventory-modal').waitFor();
        await read(names.curse.letter);
        await page.waitForFunction(() => !window.activeGame.isAdvancing);
        // Animated reads can finish with the ordinary inventory still open;
        // close it through the real UI after the turn unlocks.
        if (await page.locator('.inventory-modal').isVisible()) {
            await page.locator('.close-btn').click();
            await page.locator('.inventory-modal').waitFor({ state: 'hidden' });
        }
        const state = await record(label);
        assert.equal(state.inventory.every(i => !i.cursed), true);
        assert.equal(state.inventory.find(i => i.id === names.armor.id).E, -2);
        assert.equal(state.inventory.find(i => i.id === names.ring.id).E, -3);
        assert.ok(state.logs.some(m => m.includes(label.endsWith('empty') ? '但什么也没有发生' : '一股邪恶的力量消散')));
    }
    const completed = states.at(-1);
    assert.equal(completed.turns, initial.turns + 4);
    const recording = await page.evaluate(() => window.activeGame.exportRecording());
    await page.evaluate(rec => { if (!window.activeGame.loadReplay(rec)) throw Error('loadReplay failed'); }, recording);
    await configure();
    const replay = await page.evaluate(() => {
        const g = window.activeGame;
        while (g.replayCursor < g.replayRecording.events.length && !g.replayError) {
            g.replayStep(); while (g.isAdvancing) g.stepAdvancement();
        }
        return { cursor: g.replayCursor, error: g.replayError };
    });
    assert.equal(replay.error, null); assert.equal(replay.cursor, recording.events.length);
    const replayed = await record('replayed');
    assert.deepEqual(replayed.inventory, completed.inventory); assert.deepEqual(replayed.rng, completed.rng);
    // Final screenshot shows the actual Chinese results after the two completed reads.
    await page.evaluate(() => { window.activeGame.isInventoryOpen = true; });
    await page.locator('.inventory-modal').waitFor();
    await page.screenshot({ path: `${out}/browser-result.png`, fullPage: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ fixture: 'synthetic pack reconstructed identically after loadReplay; no gameplay overrides', states, commands: recording.events, replay, errors }, null, 2) + '\n');
    console.log(JSON.stringify({ states: states.map(s => s.label), replay, errors }));
} finally {
    if (browser) await browser.close();
    server.kill();
    fs.writeFileSync(`${out}/browser-server.txt`, serverLog.replaceAll('\r\n', '\n'));
}
