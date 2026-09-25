import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-18a-2-evidence',errors=[],results=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5198');
 await page.locator('.menu-card input[type=text]').fill('20260913');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 for(const depth of [1,6,26]){
  const row=await page.evaluate(async depth=>{
   const g=window.activeGame;g.animationEnabled=false;g.player.hp=g.player.maxHp=10000;
   if(depth!==1){g.depth=depth;g.generateDepth(false,false);}
   g.update();
   const {cellTerrainFlags}=await import('/src/engine/Map/DungeonFeature.ts');
   const {T_PATHING_BLOCKER}=await import('/src/engine/Map/TerrainCatalog.ts');
   return {depth:g.depth,loc:{...g.player.loc},entryPB:cellTerrainFlags(g.grid,g.player.loc.x,g.player.loc.y)&T_PATHING_BLOCKER,
    amulets:g.items.filter(i=>i.identityId==='amulet_of_yendor').map(i=>({loc:i.loc})),
    text:JSON.parse(window.render_game_to_text())};
  },depth);
  assert.equal(row.depth,depth);assert.equal(row.entryPB,0);if(depth===26)assert.equal(row.amulets.length,1);results.push(row);
  await page.waitForTimeout(250);await page.screenshot({path:`${dir}/browser-d${depth}.png`});
 }
 await page.keyboard.press('.');await page.waitForTimeout(200);
 await page.setViewportSize({width:700,height:900});await page.screenshot({path:`${dir}/browser-narrow.png`});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({results,errors},null,2)+'\n');
}finally{await browser.close();}
