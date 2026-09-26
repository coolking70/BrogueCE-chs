import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-19c-evidence',rows=[],errors=[];
const catalog=JSON.parse(fs.readFileSync(`${out}/scenes.json`)).filter(r=>!r.error);
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('19');await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 for(const r of catalog){
  const before=await page.evaluate(async r=>{const m=await import('/src/test/fixtures/u19c-machine-actions.ts');window.u19cPrepared=m.prepareImmediateAction(window.activeGame,r.ce,r.seed,r.size);return window.u19cPrepared;},r);
  if(before.action==='read')await page.evaluate(async()=>{const m=await import('/src/test/fixtures/u19c-machine-actions.ts');m.performImmediateAction(window.activeGame,window.u19cPrepared);});
  else {const key=before.action==='move'?before.direction.x===1?'ArrowRight':before.direction.x===-1?'ArrowLeft':before.direction.y===1?'ArrowDown':'ArrowUp':before.action==='pickup'?'g':'s';await page.keyboard.press(key);}
  await page.waitForTimeout(100);
  const after=await page.evaluate(async()=>{const m=await import('/src/test/fixtures/u19c-machine-actions.ts');return {state:m.immediateActionState(window.activeGame,window.u19cPrepared),text:JSON.parse(window.render_game_to_text())};});
  assert(after.state.inputs>before.before.inputs,`CE${r.ce} did not record input`);
  const outcome=before.action==='pickup'?after.state.scene.inventoryItem?'item transferred':'item removed':before.action==='move'?after.state.target.length===0?'monster killed':before.before.target?.[0]?.dormant&&!after.state.target[0].dormant?'dormant awakened':after.state.target[0].hp<before.before.target[0].hp?'monster damaged':'immune monster: HP unchanged':before.action==='read'?after.state.target.some(m=>!m.dormant)?'dormant awakened':!after.state.inventory.includes(before.scrollId)?'scroll consumed; target remains dormant':'no result':after.state.scene.visible?'searched and observed':'search';
  await page.screenshot({path:`${out}/browser-ce${r.ce}.png`});rows.push({ce:r.ce,seed:r.seed,size:r.size,before,after,outcome});fs.writeFileSync(`${out}/browser.json`,JSON.stringify({rows,errors},null,2)+'\n');console.log(r.ce,before.action,outcome);
 }
 await page.setViewportSize({width:700,height:900});await page.screenshot({path:`${out}/browser-narrow.png`});
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
