import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const out = 'ai_docs/reports/x2n-evidence';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], cases = [];
try {
    for (const superVictory of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto('http://127.0.0.1:5199');
        await page.locator('.menu-card input[type=text]').fill('777');
        await page.locator('.menu-card .actions button').first().click();
        await page.waitForFunction(() => !!window.activeGame?.onRenderRequested);
        const state = await page.evaluate(async superVictory => {
            const game = window.activeGame;
            const { ItemLoader } = await import('/src/engine/Items/ItemLoader.ts');
            const { TerrainType } = await import('/src/engine/Map/Grid.ts');
            // Controlled pack/position fixtures; settlement, storage and overlay remain production code.
            localStorage.removeItem('brogue-web-high-scores-v1');
            game.player.inventory.items = [ItemLoader.spawnAmulet('amulet_of_yendor', 0, 0)];
            for (const [index, quantity] of [3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1].entries()) {
                const gem = ItemLoader.spawnGem(27 + index, 0, 0);
                gem.quantity = quantity;
                game.player.inventory.addItem(gem);
            }
            game.stats.gold = 0;
            game.depth = superVictory ? 40 : 1;
            game.grid.setTerrain(game.player.loc.x, game.player.loc.y,
                superVictory ? TerrainType.DUNGEON_PORTAL : TerrainType.STAIRS_UP);
            game.handlePlayerAction(superVictory ? 'stairs_down' : 'stairs_up');
            return { score: game.gameOverScore, won: game.gameOverWon, superVictory: game.gameOverSuperVictory,
                scores: JSON.parse(localStorage.getItem('brogue-web-high-scores-v1')),
                checkpoint: game.exportRecording().events.at(-1).end };
        }, superVictory);
        const overlay = page.locator('.game-end-overlay');
        await overlay.waitFor();
        const description = `${superVictory ? '征服了' : '逃出了'}末日地牢，携带25颗流明宝石！`;
        const score = superVictory ? 195000 : 160000;
        assert.equal(state.score, score);
        assert.equal(state.scores[0].description, description);
        assert.deepEqual(state.checkpoint, { won: true, superVictory, score });
        const text = await overlay.locator('.high-scores').innerText();
        assert(text.includes(description));
        assert(!(text.includes('14颗流明宝石')));
        assert.equal(await overlay.locator('.score-value').innerText(), score.toLocaleString('en-US'));
        const label = superVictory ? 'mastered' : 'escaped';
        await page.screenshot({ path: `${out}/browser-${label}.png` });
        cases.push({ label, ...state, highScoreText: text });
        await page.close();
    }
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ cases, errors }, null, 2) + '\n');
    await browser.close();
}
