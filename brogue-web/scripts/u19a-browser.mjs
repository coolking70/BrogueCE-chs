import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-19a-evidence',errors=[],rows=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');
 await page.locator('.menu-card input[type=text]').fill('19');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 for(const ce of [15,18,24,36,37,38,46,49,55,56,62,65,66,71]){
  const before=await page.evaluate(async ce=>{
   const {machineScene,observeFromOrigin}=await import('/src/test/fixtures/u19a-machine-scenes.ts');
   const g=window.activeGame;g.startNewGame({seed:19,mode:'test'});
   const scene=machineScene(g,ce,[36,38].includes(ce)?2:1);if(!scene)throw Error(`CE${ce} build failed`);
   const observed=observeFromOrigin(g,scene,false);window.u19aTargets=observed.before;
   g.update();g.needsRender=true;g.onRenderRequested();return {observed,recorded:g.getRecordedInputs?.()?.length??null};
  },ce);
  // Real keyboard input through Input -> Game, after generation/population.
  await page.keyboard.press('s');await page.waitForTimeout(250);
  const after=await page.evaluate(()=>{
   const g=window.activeGame;g.update();g.onRenderRequested();
   return {targets:window.u19aTargets.map(t=>({...t,visible:g.grid.getCell(t.pos.x,t.pos.y).isVisible,layers:g.grid.getCell(t.pos.x,t.pos.y).layers})),text:JSON.parse(window.render_game_to_text())};
  });
  assert(after.targets.some(t=>t.visible),`CE${ce} has no visible constrained feature`);
  assert(after.text.recordedInputEvents>0,`CE${ce} keyboard action was not recorded`);
  await page.screenshot({path:`${out}/browser-ce${ce}.png`});rows.push({ce,before,after});
 }
 await page.setViewportSize({width:700,height:900});await page.screenshot({path:`${out}/browser-narrow.png`});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/browser.json`,JSON.stringify({rows,errors},null,2)+'\n');
}finally{await browser.close();}
