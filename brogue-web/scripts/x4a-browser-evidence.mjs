// Local reproducible browser evidence. Before differs ONLY by identity glyph
// normalization; both variants mount the production GameCanvas and TargetBar.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'ai_docs/reports/x4a-evidence');
mkdirSync(out, { recursive: true });
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body,#app{margin:0;width:100%;height:100%;background:#111;color:#ddd;font-family:system-ui}
#caption{position:fixed;z-index:30;top:8px;left:12px;background:#111d;padding:8px;font-size:14px;pointer-events:none}
.target-bar{position:fixed;bottom:8px;left:0}
</style></head><body><div id="caption"></div><div id="app"></div><script type="module">
import { createApp, h } from 'vue';
import GameCanvas from '/src/components/GameCanvas.vue';
import TargetBar from '/src/components/TargetBar.vue';
import { activeGame as g } from '/src/engine/Core/Game.ts';
import { TerrainType as T } from '/src/engine/Map/Grid.ts';
import { cellAppearance } from '/src/engine/UI/Appearance.ts';
import { normalizeMapGlyph } from '/src/ui/mapGlyph.ts';
import { rng } from '/src/engine/Random.ts';
import { timeSystem } from '/src/engine/Systems/Time.ts';
import setupI18n from '/src/i18n.ts';
const app=createApp({render:()=>[h(GameCanvas,{style:'width:100vw;height:100vh'}),h(TargetBar)]});
setupI18n(app);
const query = new URLSearchParams(location.search), memory = query.get('state') === 'memory';
g.startNewGame({seed:44001,mode:'test'});g.monsters=[];g.dormantMonsters=[];g.items=[];
g.visibleMonsters.clear();g.visibleItems.clear();g.player.loc={x:50,y:17};
for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
 g.grid.setTerrain(x,y,T.FLOOR); const c=g.grid.getCell(x,y);
 Object.assign(c,{isVisible:true,isExplored:true,hasMemory:true,rememberedLayers:[...c.layers],rememberedAppearance:null,rememberedItem:null});
}
for(let x=44;x<=56;x++)for(let y=14;y<=20;y++){
 if(x===50&&y===17)continue;
 g.grid.setTerrain(x,y,T.FOLIAGE);const c=g.grid.getCell(x,y);
 Object.assign(c,{isVisible:!memory,isExplored:true,hasMemory:true,rememberedLayers:[...c.layers],rememberedAppearance:null});
}
// Fixed simulation lighting; animation may redraw but cannot change this fixture.
g.lightMap.lightAt=()=>({r:100,g:100,b:100});g.lightMap.renderLightAt=()=>({r:100,g:100,b:100});
g.lightMap.dance=()=>false;
g.needsRender=true;
app.mount('#app');
document.querySelector('#caption').textContent='X4a · '+query.get('variant')+' · '+query.get('state')+' · '+innerWidth+'×'+innerHeight;
const sample=g.grid.getCell(46,16);
window.x4aEvidence={ready:true,raw:sample.char,visual:cellAppearance(sample,{lightChannels:{r:100,g:100,b:100},dancingLightChannels:{r:100,g:100,b:100},depth:1,hallucinating:false,cosmetic:{percent:()=>false,pick:a=>a[0]}}),normalized:normalizeMapGlyph('♈♠'),memory};
window.x4aThrow=()=>{g.executeItemCommand('throw',g.player.inventory.items[0]);g.update();};
window.x4aState=()=>({throwing:g.isThrowing,target:g.throwItemTarget?.id??null,tick:timeSystem.currentTick,turn:g.absoluteTurnNumber,rng:rng.getState(),items:JSON.stringify(g.player.inventory.items),commands:g.exportRecording().events.map(e=>e.action)});
</script></body></html>`;
const captures = [], errors = [];
let browser;
try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const variant of ['before', 'after']) {
        const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, plugins: [{
            name: 'x4a-evidence', enforce: 'pre',
            transform(code, id) {
                if (variant === 'before' && id.endsWith('/src/ui/mapGlyph.ts')) return 'export const normalizeMapGlyph = text => text;';
            },
            configureServer(server) {
                server.middlewares.use('/__x4a_fixture', async (req, res) => {
                    res.setHeader('Content-Type', 'text/html');
                    res.end(await server.transformIndexHtml('/__x4a_fixture', html));
                });
            },
        }] });
        try {
            await server.listen();
            const base = server.resolvedUrls.local[0];
            for (const [device, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
                const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
                const page = await context.newPage();
                page.on('pageerror', error => errors.push({ variant, device, error: error.message }));
                for (const state of ['visible', 'memory']) {
                    await page.goto(base + '__x4a_fixture?variant=' + variant + '&state=' + state);
                    await page.waitForFunction(() => window.x4aEvidence?.ready && !!window.render_game_to_text);
                    await page.evaluate(() => document.fonts.ready);
                    await page.waitForTimeout(350);
                    const file = device + '-' + state + '-' + variant + '.png';
                    await page.screenshot({ path: resolve(out, file) });
                    const evidence = await page.evaluate(() => window.x4aEvidence);
                    const expected = variant === 'before' ? '♈♠' : '♈\uFE0E♠\uFE0E';
                    if (evidence.visual.char !== '♈' || evidence.normalized !== expected || (state === 'memory' && evidence.visual.color !== '#333333')) throw new Error('unexpected glyph fixture: ' + JSON.stringify(evidence));
                    captures.push({ variant, device, viewport, state, file, evidence, layout: await page.evaluate(() => JSON.parse(window.render_game_to_text()).mapLayout) });
                }
                if (variant === 'after') {
                    await page.evaluate(() => window.x4aThrow());
                    const before = await page.evaluate(() => window.x4aState());
                    if (device === 'mobile') await page.getByRole('button', { name: '取消', exact: true }).tap();
                    else await page.keyboard.press('Escape');
                    await page.waitForFunction(() => !window.x4aState().throwing);
                    const after = await page.evaluate(() => window.x4aState());
                    if (after.target !== null || before.tick !== after.tick || before.turn !== after.turn || JSON.stringify(before.rng) !== JSON.stringify(after.rng) || before.items !== after.items || after.commands.at(-1) !== 'escape') throw new Error('throw cancellation diverged');
                    captures.push({ device, cancellation: { before, after } });
                }
                await context.close();
            }
        } finally { await server.close(); }
    }
    writeFileSync(resolve(out, 'browser.json'), JSON.stringify({ browser: await browser.version(), platform: process.platform, captures, errors }, null, 2) + '\n');
    if (errors.length) throw new Error(JSON.stringify(errors));
    console.log(JSON.stringify({ screenshots: captures.filter(c => c.file).length, cancelChecks: captures.filter(c => c.cancellation).length, errors }));
} finally { await browser?.close(); }
