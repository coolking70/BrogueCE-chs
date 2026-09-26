import { chromium } from 'playwright';

const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
    const page = await browser.newPage();
    page.on('pageerror', error => console.error('pageerror', error.message));
    const dialogAnswers = [];
    page.on('dialog', dialog => (dialogAnswers.shift() ? dialog.accept() : dialog.dismiss()));
    await page.goto('http://127.0.0.1:5173/');
    await page.locator('.menu-overlay input[type="text"]').fill('424242');
    await page.locator('.menu-overlay .actions button').first().click();
    const bindMountedGame = async () => page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map(entry => entry.name)
            .find(name => name.includes('/src/engine/Core/Game.ts'));
        if (!url) throw new Error('Mounted Game module was not loaded');
        window.x2aGame = (await import(url)).activeGame;
    });
    await bindMountedGame();
    await page.waitForFunction(() => window.x2aGame.animationEnabled);

    const run = async (action, data) => {
        await page.evaluate(async ([name, argument]) => {
            const activeGame = window.x2aGame;
            const before = activeGame.recordedInputEvents.length;
            activeGame.handlePlayerAction(name, argument);
            while (activeGame.isAdvancing) activeGame.stepAdvancement();
            if (activeGame.recordedInputEvents.length !== before + 1 || activeGame.recordedInputEvents.at(-1)?.action !== name) {
                throw new Error(`Command ${name} was not recorded`);
            }
        }, [action, data]);
    };
    await run('wait');
    await run('search');
    const { move, origin } = await page.evaluate(async () => {
        const g = window.x2aGame;
        return {
            origin: { ...g.player.loc },
            move: [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) =>
                g.grid.getCell(g.player.x + dx, g.player.y + dy)?.isPassable && !g.getMonsterAt(g.player.x + dx, g.player.y + dy)),
        };
    });
    if (!move) throw new Error('No adjacent passable cell');
    await run('move', { x: move[0], y: move[1] });
    await run('toggle_inventory');
    await run('escape');

    dialogAnswers.push(false, true);
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.evaluate(async () => {
            const g = window.x2aGame;
            const food = g.player.inventory.items.find(item => item.category === 4);
            if (food) g.executeItemCommand('eat', food);
        });
        await page.evaluate(async () => {
            const g = window.x2aGame;
            while (g.isAdvancing) g.stepAdvancement();
        });
    }

    await run('discoveries');
    await page.locator('.reference-panel button').click();
    await page.waitForFunction(() => !window.x2aGame.referenceScreen);
    await run('help');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.x2aGame.referenceScreen);

    if (origin) {
        await page.evaluate(async pos => {
            const g = window.x2aGame;
            g.executeCommand('mouse_travel', pos);
            while (g.autoPath.length) {
                g.stepAutoPath();
                while (g.isAdvancing) g.stepAdvancement();
            }
        }, origin);
    }
    await run('stairs_down');

    const recording = await page.evaluate(() => window.x2aGame.exportRecording());
    const itemDecisions = recording.events.filter(e => e.action === 'item:command').map(e => e.decisions);
    if (JSON.stringify(itemDecisions) !== JSON.stringify([[false], [true]])) {
        throw new Error(`Confirmation decisions were not recorded: ${JSON.stringify(itemDecisions)}`);
    }
    if (!recording.events.some(e => e.action === 'auto_step')) throw new Error('Auto travel produced no step');
    await page.reload();
    await bindMountedGame();
    const result = await page.evaluate(async rec => {
        const g = window.x2aGame;
        if (!g.loadReplay(rec)) throw new Error('Reloaded recording rejected');
        for (let i = 0; i < rec.events.length; i++) {
            g.replayStep();
            while (g.isAdvancing) g.stepAdvancement();
            if (g.replayError) break;
        }
        const sequential = { cursor: g.replayCursor, error: g.replayError };
        g.replaySeek(rec.events.length);
        return { sequential, seek: { cursor: g.replayCursor, error: g.replayError } };
    }, recording);
    console.log(JSON.stringify({ events: recording.events.map(e => e.action), itemDecisions, ...result }));
    if (result.sequential.error || result.seek.error || result.sequential.cursor !== recording.events.length || result.seek.cursor !== recording.events.length) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
