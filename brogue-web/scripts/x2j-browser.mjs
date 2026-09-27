import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out='ai_docs/reports/x2j-evidence', natural=JSON.parse(fs.readFileSync(`${out}/natural-actions.json`,'utf8')).find(r=>r.recovered);
if(!natural)throw Error('No completed natural route');
const browser=await chromium.launch({headless:false}), errors=[], rows=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5196');
 await page.locator('.menu-card input[type=text]').fill(String(natural.seed));
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 await page.evaluate(()=>{window.activeGame.animationEnabled=false;});
 const state=()=>page.evaluate(()=>{
  const g=window.activeGame,m=g.monsters.find(m=>m.typeId==='monkey'&&!m.isCaged&&!m.isAlly);
  return {depth:g.depth,player:{...g.player.loc},hp:g.player.hp,monkey:m&&{id:m.id,loc:{...m.loc},hp:m.hp,state:m.state,mode:m.creatureMode,carried:m.carriedItem&&{id:m.carriedItem.id,quantity:m.carriedItem.quantity,flags:m.carriedItem.flags}},pack:g.player.inventory.items.map(i=>({id:i.id,kind:i.identityId??i.consumableId,quantity:i.quantity})),floor:g.items.map(i=>({id:i.id,kind:i.identityId??i.consumableId,quantity:i.quantity,loc:{...i.loc}}))};
 });
 const shot=async label=>{await page.evaluate(()=>{const g=window.activeGame;g.needsRender=true;g.onRenderRequested();});await page.waitForTimeout(200);await page.screenshot({path:`${out}/browser-${label}.png`});rows.push({label,state:await state(),text:await page.evaluate(()=>JSON.parse(window.render_game_to_text()))});};
 const keys={'-1,-1':'y','0,-1':'ArrowUp','1,-1':'u','-1,0':'ArrowLeft','1,0':'ArrowRight','-1,1':'b','0,1':'ArrowDown','1,1':'n'};
 for(let i=0;i<natural.actions.length;i++) {
  const a=natural.actions[i];
  if(a.action==='throw_at') {
   await page.evaluate(data=>{const g=window.activeGame,item=g.player.inventory.items.find(i=>i.inventoryLetter===data.letter);if(!item)throw Error('missing dart');g.executeItemCommand('throw',item);g.handleMouseTravel(data.x,data.y);},a.data);
  } else await page.keyboard.press(a.action==='move'?keys[`${a.data.x},${a.data.y}`]:a.action==='stairs_down'?'>':a.action==='pickup'?'g':'.');
  await page.waitForFunction(()=>!window.activeGame.isAdvancing);
  const observed=await state();assert.deepEqual(observed.player,a.player,`step ${i} position`);assert.equal(observed.hp,a.hp,`step ${i} HP`);
  if(i===105)await shot('before-theft');
  if(i===107){await shot('stolen');assert.equal(observed.monkey.carried.quantity,8);assert.equal(observed.monkey.mode,1);}
  if(i===110) {
   await shot('fleeing');const before=await state();
   await page.locator('.menu-btn').click();await page.getByRole('button',{name:'保存游戏',exact:true}).click();
   await page.reload();await page.getByRole('button',{name:'继续游戏',exact:true}).click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
   await page.evaluate(()=>{window.activeGame.animationEnabled=false;});assert.deepEqual(await state(),before);await shot('restored');
  }
  if(i===112)await shot('dropped');
 }
 await shot('recovered');
 const final=await state();assert(!final.floor.some(i=>i.id===natural.stolen.id));assert.equal(final.pack.find(i=>i.kind==='dart').quantity,13);
 await page.keyboard.press('i');await page.locator('.inventory-modal').waitFor();await page.screenshot({path:`${out}/browser-inventory.png`});await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${out}/browser.json`,JSON.stringify({seed:natural.seed,steps:natural.actions.length,errors,rows,final,setup:'Normal new-game menu; natural D1→D2 movement/combat through keyboard; two throws through the same inventory/target entry points as UI; real menu save/reload/continue. No entity, map, inventory, HP or RNG mutation.'},null,2)+'\n');
 console.log(`Natural seed ${natural.seed}: ${natural.actions.length} commands, theft/flee/save/reload/kill/recover; 0 errors.`);
} finally {await browser.close();}
