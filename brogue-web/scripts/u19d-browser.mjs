import fs from 'node:fs';import {gunzipSync} from 'node:zlib';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const out='ai_docs/reports/u-19d-evidence',natural=JSON.parse(fs.readFileSync(`${out}/actions.json`)).rows,controlled=JSON.parse(fs.readFileSync(`${out}/static-actions.json`)).rows;
const rows=[],errors=[],browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('19');await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 for(const r of [...natural,...controlled.filter(r=>[38,15].includes(r.ce)).map(r=>({...r,controlled:true}))]){
  const prefix=r.controlled?'static':'action',snapshot=JSON.parse(gunzipSync(fs.readFileSync(`${out}/${prefix}-start-ce${r.ce}.json.gz`)));
  const loaded=await page.evaluate(snapshot=>{const g=window.activeGame;const ok=g.loadSnapshot(snapshot);g.animationEnabled=false;g.onConfirmRequest=()=>true;g.update();g.needsRender=true;g.onRenderRequested?.();return ok;},snapshot);assert(loaded,`CE${r.ce} load`);
  await page.waitForTimeout(80);await page.screenshot({path:`${out}/browser-ce${r.ce}-entry.png`});const checkpoints=[];
  for(let index=0;index<r.commands.length;index++){
   const cmd=r.commands[index];
   if(cmd.action==='throw')await page.evaluate(cmd=>{const g=window.activeGame,i=g.player.inventory.items.find(i=>i.id===cmd.data.itemId);g.executeItemCommand('throw',i,undefined,()=>g.throwItemAt(i,cmd.data.x,cmd.data.y));},cmd);
   else {const key=cmd.action==='move'?cmd.data.x===1?'ArrowRight':cmd.data.x===-1?'ArrowLeft':cmd.data.y===1?'ArrowDown':'ArrowUp':cmd.action==='search'?'s':cmd.action==='pickup'?'g':'.';await page.keyboard.press(key);}
   for(const phase of r.phases.filter(p=>p.commands===index+1)){
    const state=await page.evaluate(()=>{const g=window.activeGame;return {player:{...g.player.loc},inventory:g.player.inventory.items.map(i=>i.id),paralyzed:g.player.getStatusDuration('paralyzed'),hp:g.player.hp,text:JSON.parse(window.render_game_to_text())};});
    assert.deepEqual(state.player,phase.player,`CE${r.ce}/${phase.label}/location`);assert.deepEqual(state.inventory,phase.inventory,`CE${r.ce}/${phase.label}/inventory`);assert.equal(state.paralyzed,phase.paralyzed,`CE${r.ce}/${phase.label}/paralysis`);
    if(['searched','pulled','thrown','paralyzed','awakened','final'].includes(phase.label)){await page.waitForTimeout(60);await page.screenshot({path:`${out}/browser-ce${r.ce}-${phase.label}.png`});}
    checkpoints.push({label:phase.label,commands:index+1,state});
   }
  }
  rows.push({ce:r.ce,controlled:!!r.controlled,seed:r.seed,depth:r.depth,commands:r.commands.length,rewardId:r.rewardId,checkpoints});fs.writeFileSync(`${out}/browser.json`,JSON.stringify({rows,errors},null,2)+'\n');console.log(r.ce,'PASS',r.commands.length);
 }
 await page.setViewportSize({width:700,height:900});await page.screenshot({path:`${out}/browser-narrow.png`});assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${out}/browser.json`,JSON.stringify({rows,errors},null,2)+'\n');await browser.close();}
