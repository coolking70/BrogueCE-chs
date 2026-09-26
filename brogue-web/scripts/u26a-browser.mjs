import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out = 'ai_docs/reports/u-26a-evidence', rows = [], errors = [];
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5199');
    await page.locator('.menu-card input[type=text]').fill('777');
    await page.locator('.menu-card .actions button').first().click();
    await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
    await page.evaluate(() => { const g = window.activeGame; g.player.hp = g.player.maxHp = 100000; g.animationEnabled = false; });
    const place = async (type, itemId) => {
        // Relocate away from a gas cloud, then let real wait commands expire paralysis.
        if (await page.evaluate(() => window.activeGame.player.hasStatus('paralyzed'))) {
            await page.evaluate(async () => {
                const g = window.activeGame, { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
                for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++)
                    if (g.grid.getCell(x, y).layers.includes(T.STAIRS_UP)) g.player.loc = { x, y };
            });
            for (let n = 0; n < 100 && await page.evaluate(() => window.activeGame.player.hasStatus('paralyzed')); n++) await press('.');
            assert(!await page.evaluate(() => window.activeGame.player.hasStatus('paralyzed')));
        }
        return page.evaluate(async ({ type, itemId }) => {
        const g = window.activeGame;
        const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
        if (itemId) g.player.loc = { ...g.items.find(i => i.id === itemId).loc };
        else {
            let loc;
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++)
                if (g.grid.getCell(x, y).layers.includes(T[type])) loc = { x, y };
            if (!loc) throw Error(`Missing ${type}`);
            g.player.loc = loc;
        }
        g.updateVision(); g.needsRender = true; g.onRenderRequested?.();
    }, { type, itemId });
    };
    const press = async key => {
        await page.waitForFunction(() => !window.activeGame.isInputLocked());
        await page.keyboard.press(key);
        await page.waitForFunction(() => !window.activeGame.isInputLocked());
    };
    const state = () => page.evaluate(() => {
        const g = window.activeGame;
        return { depth: g.depth, hp: g.player.hp, won: g.gameOverWon, superVictory: g.gameOverSuperVictory, score: g.gameOverScore,
            gems: g.items.filter(i => i.identityId === 'lumenstone').map(i => ({ id: i.id, depth: i.originDepth, quantity: i.quantity })),
            pack: g.player.inventory.items.map(i => ({ id: i.id, kind: i.identityId, depth: i.originDepth, quantity: i.quantity, name: i.displayName })),
            text: JSON.parse(window.render_game_to_text()) };
    });
    const shot = async label => { await page.waitForTimeout(240); await page.screenshot({ path: `${out}/browser-${label}.png` }); rows.push({ label, ...await state() }); };
    for (let d = 1; d < 26; d++) { await place('STAIRS_DOWN'); await press('>'); }
    assert.equal((await state()).depth, 26);
    const amulet = await page.evaluate(() => window.activeGame.items.find(i => i.identityId === 'amulet_of_yendor').id);
    await place(null, amulet); await press('g');
    for (let d = 27; d <= 40; d++) {
        await place('STAIRS_DOWN'); await press('>');
        const s = await state(); assert.equal(s.depth, d);
        assert.equal(s.gems.length, [3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1][d - 27]);
        if (d === 27) {
            // Locate a safe adjacent square so the natural GEM glyph is visible, then walk onto it.
            const key = await page.evaluate(id => {
                const g = window.activeGame, gem = g.items.find(i => i.id === id);
                for (const [dx, dy, key] of [[-1, 0, 'ArrowRight'], [1, 0, 'ArrowLeft'], [0, -1, 'ArrowDown'], [0, 1, 'ArrowUp']]) {
                    const x = gem.x + dx, y = gem.y + dy;
                    if (g.canMoveTo(x, y) && !g.getMonsterAt(x, y)) {
                        g.player.loc = { x, y }; g.updateVision(); g.onRenderRequested?.(); return key;
                    }
                }
                throw Error('No adjacent gem square');
            }, s.gems[0].id);
            await shot('d27-gem');
            assert(rows.at(-1).text.items.some(i => i.name.includes('流明宝石')));
            await press(key);
        }
        for (const gem of s.gems) { await place(null, gem.id); await press('g'); }
        if ((await state()).gems.length) await shot(`pickup-failure-d${d}`);
        assert.equal((await state()).gems.length, 0, `pickup D${d}`);
        if (d === 27) {
            await place('STAIRS_UP');
            await press('i'); await page.locator('.inventory-overlay').waitFor(); await shot('d27-inventory');
            assert((await page.locator('.inventory-overlay').innerText()).includes('来自第 27 层'));
            const original = (await state()).pack.find(i => i.kind === 'lumenstone');
            await page.locator('.item-row').filter({ hasText: '来自第 27 层' }).click();
            await page.locator('.item-actions .danger').click();
            await page.locator('.inventory-overlay').waitFor({ state: 'hidden' });
            await page.waitForFunction(() => !window.activeGame.isInputLocked());
            assert.deepEqual((await state()).gems, [{ id: original.id, depth: 27, quantity: 3 }]);
            assert(!(await state()).pack.some(i => i.kind === 'lumenstone'));
            await shot('d27-dropped-stack');
            // Stairs reject items, so the normal drop path relocates this stack nearby.
            await place(null, original.id);
            await press('g');
            assert.equal((await state()).gems.length, 0);
            assert.equal((await state()).pack.find(i => i.kind === 'lumenstone').quantity, 3);
        }
        if (d === 28) {
            await place('STAIRS_UP'); await press('<'); assert.equal((await state()).depth, 27);
            assert.equal((await state()).gems.length, 0);
            await place('STAIRS_DOWN'); await press('>'); assert.equal((await state()).depth, 28);
            await page.locator('.menu-btn').click();
            await page.locator('.menu-card .actions').first().locator('button').nth(2).click();
            await page.reload();
            await page.locator('.menu-card .actions').first().locator('button').nth(1).click();
            await page.waitForFunction(() => window.activeGame?.depth === 28 && !!window.activeGame.onRenderRequested);
            await page.waitForTimeout(200);
            await page.evaluate(() => { window.activeGame.animationEnabled = false; });
            await shot('d28-restored');
        }
    }
    const finished = await state();
    const packGems = finished.pack.filter(i => i.kind === 'lumenstone');
    assert.equal(packGems.length, 14); assert.equal(packGems.reduce((n, i) => n + i.quantity, 0), 25);
    await place('DUNGEON_PORTAL'); await shot('d40-portal');
    await press('>'); await page.locator('.game-end-overlay').waitFor();
    await shot('super-victory');
    assert.equal(rows.at(-1).superVictory, true); assert.equal(rows.at(-1).score, 195000);
    assert((await page.locator('.high-scores').innerText()).includes('14'));
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ rows, errors }, null, 2) + '\n');
    await browser.close();
}
