import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-05-evidence',errors=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5198');
 await page.locator('.menu-card input[type=text]').fill('3');
 await page.locator('.menu-card .actions').first().locator('button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const result=await page.evaluate(async()=>{
  const g=window.activeGame,{ItemCategory}=await import('/src/engine/Items/Item.ts');
  g.animationEnabled=false;
  const items=[g.items.find(i=>i.category===ItemCategory.STAFF&&i.originDepth===1),g.items.find(i=>i.category===ItemCategory.WAND&&i.originDepth===1)];
  if(items.some(i=>!i))throw Error('seed3 D1 natural machine STAFF/WAND missing');
  const state=i=>({id:i.id,kind:i.identityId,category:i.category,originDepth:i.originDepth,enchantment:i.enchantment,charges:i.charges,maxCharges:i.maxCharges,staffRechargeRemaining:i.staffRechargeRemaining,isCursed:i.isCursed});
  const before=items.map(state);
  // Position the player for focused pickup verification; items/resources are natural.
  for(const item of items){g.player.loc={...item.loc};g.pickUpItemAfterDisplacement();}
  const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));
  if(!g.loadSnapshot(snapshot))throw Error('JSON round trip rejected');
  const after=before.map(i=>state(g.player.inventory.items.find(j=>j.id===i.id)));
  g.updateVision();g.isInventoryOpen=true;g.needsRender=true;g.update();
  return {before,after,text:JSON.parse(window.render_game_to_text())};
 });
 assert.deepEqual(result.after,result.before);
 await page.waitForTimeout(500);
 await page.screenshot({path:`${dir}/browser-inventory.png`});
 const staffRow=page.locator('.item-row').filter({has:page.locator('.item-char',{hasText:'\\'})}).first();
 await staffRow.click();await page.locator('.item-actions .action-btn').first().click();
 await page.waitForTimeout(300);await page.screenshot({path:`${dir}/browser-detail.png`});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({result,errors},null,2)+'\n');
}finally{await browser.close();}
