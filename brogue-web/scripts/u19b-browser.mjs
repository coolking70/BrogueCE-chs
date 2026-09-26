import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-19b-evidence',errors=[],rows=[];
const catalog=JSON.parse(fs.readFileSync(`${out}/scenes-discovery.json`)).filter(r=>!r.error);
for(const ce of [6,7,65,66])if(!catalog.some(r=>r.ce===ce))catalog.push({ce,seed:1,size:0});
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('19');await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 for(const row of catalog){
  const before=await page.evaluate(async r=>{
   const {preparePendingScene}=await import('/src/test/fixtures/u19b-machine-scenes.ts');
   const scene=preparePendingScene(window.activeGame,r.ce,r.seed,r.size);window.u19bScene=scene;return scene;
  },row);
  const action=before.itemId!==undefined&&before.observer.x===before.target.x&&before.observer.y===before.target.y?'pickup':'search';
  await page.keyboard.press(action==='pickup'?'g':'s');await page.waitForTimeout(80);
  const state=()=>page.evaluate(async()=>{const {pendingSceneState}=await import('/src/test/fixtures/u19b-machine-scenes.ts');const g=window.activeGame;g.update();g.onRenderRequested();return {state:pendingSceneState(g,window.u19bScene),text:JSON.parse(window.render_game_to_text())};});
  const searched=await state();assert(searched.state.inputs>before.before.inputCount,`CE${row.ce} no real input`);assert(searched.state.visible,`CE${row.ce} target not visible`);
  await page.screenshot({path:`${out}/browser-ce${row.ce}.png`});
  const picked=action==='pickup'?searched:null;
  if(picked){assert(picked.state.inventoryItem||!picked.state.floorItem,`CE${row.ce} pickup did not resolve`);if(row.ce===15){assert(picked.state.inventoryItem);assert(picked.state.guardianActive);await page.screenshot({path:`${out}/browser-ce15-pickup.png`});}}
  rows.push({ce:row.ce,action,before,searched,picked});fs.writeFileSync(`${out}/browser.json`,JSON.stringify({rows,errors},null,2)+'\n');console.log('CE',row.ce,'search',!!searched.state.visible,'pickup',picked?.state.inventoryItem??null);
 }
 await page.setViewportSize({width:700,height:900});await page.screenshot({path:`${out}/browser-narrow.png`});assert.deepEqual(errors,[]);
}finally{await browser.close();}
