import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1440,height:900}, deviceScaleFactor:1});
await page.goto('http://127.0.0.1:5173/');
await page.locator('input[type=text]').first().fill('2323');
await page.locator('.actions button').first().click();
await page.waitForTimeout(1200);
const evidence = 'ai_docs/reports/u-23-evidence';
const setup = await page.evaluate(async () => {
 const {activeGame:g} = await import('/src/engine/Core/Game.ts');
 const {TerrainType:T,DungeonLayer:L} = await import('/src/engine/Map/Grid.ts');
 const x=g.player.loc.x+2,y=g.player.loc.y;
 g.grid.setTerrain(x,y,T.DOOR); const c=g.grid.getCell(x,y);
 c.isVisible=true;c.isExplored=true;c.hasMemory=true;
 c.rememberedTerrain=c.terrain;c.rememberedLayers=[...c.layers];
 const {memoryTerrainAppearance}=await import('/src/engine/UI/Appearance.ts');
 c.rememberedAppearance=memoryTerrainAppearance(c,g.depth);
 g.onRenderRequested?.(); return {x,y};
});
await page.screenshot({path:`${evidence}/visible-before.png`});
await page.evaluate(async ({x,y}) => {
 const {activeGame:g}=await import('/src/engine/Core/Game.ts');
 const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
 const c=g.grid.getCell(x,y);c.isVisible=false;
 g.grid.setTerrain(x,y,T.OPEN_DOOR);g.onRenderRequested?.();
},setup);
await page.screenshot({path:`${evidence}/memory-after.png`});
await page.evaluate(async ({x,y}) => {
 const {activeGame:g}=await import('/src/engine/Core/Game.ts');
 const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
 const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');
 for(let dx=4;dx<10;dx++) {const c=g.grid.getCell(x+dx,y);if(!c)continue;g.grid.setTerrain(x+dx,y,T.FLOOR);c.isVisible=false;c.isExplored=false;}
 const scroll=ItemLoader.spawnScroll('scroll_of_magic_mapping',-1,-1);
 g.player.inventory.addItem(scroll);g.readItem(scroll);g.onRenderRequested?.();
},setup);
await page.screenshot({path:`${evidence}/magic-mapped.png`});
console.log(JSON.stringify(setup));
await browser.close();
