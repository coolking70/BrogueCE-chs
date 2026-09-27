import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5192', '--strictPort'], {
    cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'ignore',
});
let browser;
try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
        try { ready = (await fetch('http://127.0.0.1:5192')).ok; } catch { /* server starting */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Vite server did not start');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto('http://127.0.0.1:5192');
    await page.locator('.menu-card select').first().selectOption('test');
    await page.locator('.menu-card .actions button').first().click();
    await page.locator('.menu-card').waitFor({ state: 'hidden' });

    const result = await page.evaluate(async () => {
        const { activeGame: game } = await import('/src/engine/Core/Game.ts');
        const { RETIRED_INVENTED_BLUEPRINT_IDS } = await import('/src/engine/Generator/BlueprintEngine.ts');
        const inventedItems = new Set(['halberd', 'wand_of_fire', 'wand_of_lightning', 'scroll_of_amnesia', 'potion_of_healing', 'staff_of_light']);
        const inventedRunics = new Set(['venom', 'vampirism', 'vitality']);
        if (game.mode !== 'test' || game.depth !== 1) throw new Error('Menu did not start test mode');
        const categories = new Set();
        let pickups = 0;
        for (let depth = 1; depth <= 40; depth++) {
            if (game.depth !== depth) throw new Error(`Unexpected depth ${game.depth}`);
            categories.add(game.currentTestCategory);
            if (!game.testRooms.size) throw new Error(`Empty D${depth} exhibit`);
            const allItems = [...game.items, ...game.player.inventory.items,
                ...[...game.testRooms.values()].flatMap(room => room.baselineItems)];
            for (const item of allItems) {
                const id = item.consumableId ?? item.identityId;
                if (inventedItems.has(id) || inventedRunics.has(item.runicType)) {
                    throw new Error(`D${depth}: retired item ${id}, runic ${item.runicType}`);
                }
            }
            if (game.currentTestCategory === 'blueprints') {
                for (const room of game.testRooms.values()) {
                    if (!room.blueprintId || RETIRED_INVENTED_BLUEPRINT_IDS.has(room.blueprintId)) {
                        throw new Error(`D${depth}: retired or unidentified blueprint ${room.blueprintId}`);
                    }
                }
            }
            if (game.items.length && pickups < 5) {
                const item = game.items[0];
                game.player.loc = { ...item.loc };
                game.handlePlayerAction('pickup', undefined, 'system');
                if (!game.player.inventory.items.includes(item)) throw new Error(`D${depth}: pickup failed`);
                pickups++;
            }
            game.player.loc = { x: 5, y: 3 };
            game.handlePlayerAction('stairs_down', undefined, 'system');
        }
        return { depths: 40, categories: [...categories], pickups };
    });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ menu: 'test', ...result, pageErrors: errors.length }));
} finally {
    if (browser) await browser.close();
    server.kill();
}
