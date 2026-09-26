// Derived observation-only capture: wait for the existing UI transition before screenshots.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out = 'ai_docs/reports/u-15d3-evidence', rows = [], errors = [];
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5199');
    await page.locator('.menu-card input[type=text]').fill('1533');
    await page.locator('.menu-card .actions').first().locator('button').first().click();
    await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
    const born = await page.evaluate(async () => {
        const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
        const { rng } = await import('/src/engine/Random.ts');
        const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
        const g = window.activeGame;
        g.startNewGame({ seed: 1533, mode: 'test' });
        g.monsters = []; g.dormantMonsters = []; g.items = []; g.animationEnabled = false;
        g.player.inventory.items = []; g.player.equippedWeapon = null; g.player.equippedArmor = null;
        for (let x = 20; x < 31; x++) for (let y = 10; y < 21; y++) {
            g.grid.getCell(x, y).layers.fill(T.NOTHING); g.grid.setTerrain(x, y, T.FLOOR);
        }
        g.player.loc = { x: 25, y: 15 };
        const records = [], original = rng.getState();
        for (const [category, wanted] of [['weapon', 'multiplicity'], ['weapon', 'slowing'], ['weapon', 'plenty'],
            ['armor', 'multiplicity'], ['armor', 'burden'], ['armor', 'vulnerability'], ['armor', 'immolation'],
            ['weapon', 'slaying'], ['armor', 'immunity'], ['weapon', 'mercy']]) {
            let item, seed;
            for (seed = 1; seed < 5000; seed++) {
                rng.seedRandomGenerator(seed);
                item = category === 'weapon' ? ItemLoader.spawnWeapon('dagger', -1, -1, 1) : ItemLoader.spawnArmor('leather_armor', -1, -1, 1);
                if (item.runicType === wanted) break;
            }
            if (seed === 5000) throw Error(`Missing birth ${category}/${wanted}`);
            g.player.inventory.addItem(item);
            records.push({ category, wanted, seed, letter: item.inventoryLetter, id: item.id, e: item.enchantment, curse: item.isCursed, vorpal: item.vorpalEnemy });
        }
        const scroll = ItemLoader.spawnScroll('scroll_of_identify', -1, -1);
        ItemLoader.identifyInstance(scroll); scroll.quantity = records.length; g.player.inventory.addItem(scroll);
        rng.setState(original); g.updateVision(); g.update(); g.onRenderRequested?.();
        return { records, scrollLetter: scroll.inventoryLetter };
    });
    const itemRow = letter => page.locator('.item-row').filter({ has: page.locator('.item-letter', { hasText: `${letter})` }) });
    const openInventory = async () => {
        if (!await page.locator('.inventory-overlay').isVisible()) await page.keyboard.press('i');
        await page.locator('.inventory-overlay').waitFor({ state: 'visible' });
    };
    const details = async letter => {
        await openInventory();
        await itemRow(letter).click();
        await page.getByRole('button', { name: '查看详情', exact: true }).click();
        await page.locator('.detail-overlay').waitFor({ state: 'visible' });
        return page.locator('.detail-overlay').innerText();
    };
    for (const record of born.records) {
        await openInventory();
        const unknown = await details(record.letter); assert(!unknown.includes('附魔:'));
        await page.locator('.detail-close').click();
        await itemRow(born.scrollLetter).click();
        await page.getByRole('button', { name: '阅读', exact: true }).click();
        await openInventory();
        await page.locator('.identify-banner').waitFor({ state: 'visible' });
        await itemRow(record.letter).click();
        const known = await details(record.letter); assert(known.includes('附魔:'));
        await page.waitForTimeout(400); await page.screenshot({ path: `${out}/browser-${record.category}-${record.wanted}.png` });
        rows.push({ ...record, unknown, known, state: await page.evaluate(id => {
            const i = window.activeGame.player.inventory.items.find(i => i.id === id);
            return { runic: i.runicType, known: i.runicKnown, e: i.enchantment, curse: i.isCursed, vorpal: i.vorpalEnemy, flags: i.flags };
        }, record.id) });
        await page.locator('.detail-close').click();
    }
    const payload = () => page.evaluate(() => window.activeGame.player.inventory.items.map(i => ({
        id: i.id, kind: i.identityId, runic: i.runicType, known: i.runicKnown, e: i.enchantment, curse: i.isCursed,
        vorpal: i.vorpalEnemy, flags: i.flags, charges: i.charges, strength: i.strengthRequired,
    })));
    const before = await payload(); assert.equal(before.length, 10);
    await page.locator('.inventory-overlay .close-btn').click();
    await page.locator('.menu-btn').click();
    await page.locator('.menu-card .actions').first().locator('button').nth(2).click();
    await page.reload();
    await page.locator('.menu-card .actions').first().locator('button').nth(1).click();
    await page.waitForFunction(() => window.activeGame?.player?.inventory?.items.length === 10);
    const after = await payload(); assert.deepEqual(after, before);
    await openInventory(); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/browser-restored-inventory.png` });
    rows.push({ phase: 'menu-save-reload-continue', before, after, text: await page.evaluate(() => JSON.parse(window.render_game_to_text())) });
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ rows, errors }, null, 2) + '\n');
    await browser.close();
}
