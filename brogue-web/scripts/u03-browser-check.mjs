import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir = 'ai_docs/reports/u-03-evidence', results = [], errors = [];
function compare(actual, expected, label) {
    const first = (a,b,p='') => { if(JSON.stringify(a)===JSON.stringify(b))return null; if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const d=first(a[k],b[k],p+'/'+k);if(d)return d;}}return {path:p,actual:a,expected:b};};
    const diff=first(actual,expected); if(diff)throw Error(label+': '+JSON.stringify(diff));
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const browser = await chromium.launch({ headless: false });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5196');
    await page.locator('.menu-card input[type=text]').fill('7');
    const actions = () => page.locator('.menu-card .actions').first().locator('button');
    await actions().first().click();
    await page.waitForFunction(() => !!window.render_game_to_text && !!window.activeGame.onRenderRequested);
    const setup = async () => page.evaluate(async () => {
        const { TerrainType } = await import('/src/engine/Map/Grid.ts');
        window.u03Stairs = (up) => {
            const g = window.activeGame;
            const terrain = up ? TerrainType.STAIRS_UP : TerrainType.STAIRS_DOWN;
            const c = g.toSnapshot().grid.find(c => c.layers.includes(terrain));
            if (!c) throw Error('Missing stairs');
            g.player.loc = { x: c.x, y: c.y };
            g.handlePlayerAction(up ? 'stairs_up' : 'stairs_down', undefined, 'system');
            g.update();
        };
        window.u03Stable = () => {
            const s = JSON.parse(JSON.stringify(window.activeGame.toSnapshot()));
            delete s.savedAt;
            // App intentionally logs Save/Load, with monotonically allocated log IDs.
            // Engine tests compare the complete logger; this UI comparison omits only it.
            delete s.run.logger;
            return s;
        };
    });
    await setup();
    await page.evaluate(() => {
        const g = window.activeGame; g.animationEnabled = false; g.player.hp = g.player.maxHp = 100000;
        for (let i = 0; i < 3; i++) { g.handlePlayerAction('wait', undefined, 'system'); g.update(); }
        window.u03Stairs(false);
        for (let i = 0; i < 2; i++) { g.handlePlayerAction('wait', undefined, 'system'); g.update(); }
    });
    await page.waitForTimeout(500);
    await page.locator('.menu-btn').click(); await actions().nth(2).click();
    await page.waitForFunction(async () => !!await (await import('/src/engine/Core/SaveStorage.ts')).readSaveSummary());
    const before = await page.evaluate(async () => {
        const s = await (await import('/src/engine/Core/SaveStorage.ts')).readSnapshot();
        delete s.savedAt; delete s.run.logger; return s;
    });
    assert.equal(before.levels.length, 1);
    await page.screenshot({ path: `${dir}/browser-saved.png` });
    await page.evaluate(() => { window.u03Stairs(true); });
    await page.waitForTimeout(500);
    const direct = await page.evaluate(() => window.u03Stable());
    await page.reload(); await setup();
    await page.waitForFunction(() => [...document.querySelectorAll('.menu-card .actions button')][1]?.disabled === false);
    await actions().nth(1).click();
    await page.waitForFunction(() => !!window.render_game_to_text && !!window.activeGame.onRenderRequested);
    await page.waitForTimeout(500);
    const loaded = await page.evaluate(() => window.u03Stable());
    compare(loaded, before, 'checkpoint');
    await page.evaluate(() => { window.activeGame.animationEnabled = false; window.u03Stairs(true); });
    await page.waitForTimeout(500);
    const resumed = await page.evaluate(() => window.u03Stable());
    compare(resumed, direct, 'return D1');
    await page.screenshot({ path: `${dir}/browser-return-d1.png` });
    results.push({ scene: 'menu-save-reload-continue-return-D1', completeStateExceptMenuLog: true,
        checkpointSHA256: hash(before), returnSHA256: hash(resumed), text: await page.evaluate(() => JSON.parse(window.render_game_to_text())) });

    const performance = await page.evaluate(async () => {
        const { saveSnapshot, readSnapshot, deleteSnapshot, readSaveSummary } = await import('/src/engine/Core/SaveStorage.ts');
        const g = window.activeGame; g.onRenderRequested = null;
        for (let d = 2; d <= 26; d++) { g.depth = d; g.generateDepth(); }
        const snapshot = g.toSnapshot(), json = JSON.stringify(snapshot), t0 = performance.now();
        await saveSnapshot(snapshot); const t1 = performance.now();
        const loaded = await readSnapshot(); const t2 = performance.now();
        if (JSON.stringify(loaded) !== json) throw Error('IndexedDB JSON mismatch');
        if (!g.loadSnapshot(loaded)) throw Error('26-level load rejected');
        const t3 = performance.now();
        const restored = g.toSnapshot(); delete restored.savedAt; delete loaded.savedAt;
        if (JSON.stringify(restored) !== JSON.stringify(loaded)) throw Error('26-level engine mismatch');
        const summary = await readSaveSummary();
        // An aborted overwrite must retain both the previous payload and summary.
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('brogue-web-saves', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise(resolve => { const tx = db.transaction('checkpoint', 'readwrite'); tx.objectStore('checkpoint').put('bad', 'world'); tx.objectStore('checkpoint').put({}, 'summary'); tx.onabort = resolve; tx.abort(); });
        db.close();
        if (JSON.stringify(await readSaveSummary()) !== JSON.stringify(summary)) throw Error('Aborted summary overwrite');
        if (JSON.stringify(await readSnapshot()) !== json) throw Error('Aborted world overwrite');
        await deleteSnapshot();
        if (await readSnapshot() !== null || await readSaveSummary() !== null) throw Error('Delete failed');
        await saveSnapshot(snapshot); // Leave a real 26-level record for the reload test.
        return { floors: 26, bytes: new TextEncoder().encode(json).length, writeMs: t1 - t0,
            readAndParseMs: t2 - t1, loadMs: t3 - t2, fullEquality: true, abortedOverwritePreserved: true, deleteVerified: true };
    });
    results.push(performance);
    await page.reload(); await page.waitForFunction(() => [...document.querySelectorAll('.menu-card .actions button')][1]?.disabled === false);
    await actions().nth(1).click();
    await page.waitForFunction(() => window.activeGame.depth === 26 && window.activeGame.levels.size === 25);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${dir}/browser-26-levels.png` });
    await page.setViewportSize({ width: 700, height: 800 });
    await page.locator('.menu-btn').click(); await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/browser-narrow-summary.png` });
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(`${dir}/browser.json`, JSON.stringify({ results, errors }, null, 2) + '\n');
    await browser.close();
}
