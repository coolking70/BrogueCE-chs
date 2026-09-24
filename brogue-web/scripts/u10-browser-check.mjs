import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-10-evidence',states=[],errors=[];
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');
 await page.locator('.menu-card input[type=text]').fill('1010');await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text&&!!window.activeGame.onRenderRequested);
 await page.evaluate(async()=>{
  const [{Monster},md,{TerrainType:T},{CEBoltType}]=await Promise.all([import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Map/Grid.ts'),import('/src/engine/Combat/BoltCatalog.ts')]);
  const g=window.activeGame;g.startNewGame({seed:1010,mode:'test'});g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
  for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++) {
   g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);
   Object.assign(g.grid.getCell(x,y),{isExplored:true,hasMemory:true,machineNumber:0,hasDormantMonster:false});
  }
  g.player.loc={x:10,y:10};const m=new Monster(13,10,md.default.find(m=>m.id==='rat'));m.isAlly=true;m.ticksUntilTurn=10000;g.monsters=[m];
  window.u10Set=()=>Object.assign(g.monsters[0],{targetCorpseLoc:{x:13,y:10},targetCorpseName:'巨龙',corpseAbsorptionCounter:13,absorptionFlags:'MONST_FLIES',absorbBehavior:true,absorptionBolt:CEBoltType.NONE,isAbsorbing:true,newPowerCount:2,totalPowerCount:4});
  window.u10Inspect=()=>{g.updateVision();g.needsRender=true;g.update();const m=g.monsters[0];g.handleInspectAt(m.x,m.y);};
  window.u10Read=()=>{const m=g.monsters[0];return {targetCorpseLoc:m.targetCorpseLoc,targetCorpseName:m.targetCorpseName,corpseAbsorptionCounter:m.corpseAbsorptionCounter,absorptionFlags:m.absorptionFlags,absorbBehavior:m.absorbBehavior,absorptionBolt:m.absorptionBolt,isAbsorbing:m.isAbsorbing,newPowerCount:m.newPowerCount,totalPowerCount:m.totalPowerCount,detail:g.inspectTarget,text:JSON.parse(window.render_game_to_text())};};
  window.u10Inspect();
 });
 const shot=async(name,expected)=>{
  await page.waitForTimeout(600);await page.locator('.detail-panel').waitFor({state:'visible'});assert.equal(await page.locator('.detail-panel progress').count(),expected?1:0);
  const state=await page.evaluate(()=>window.u10Read());
  if(expected)assert.deepEqual(await page.locator('progress').evaluate(p=>({value:p.value,max:p.max,label:p.getAttribute('aria-label')})),{value:13,max:20,label:'吸收'});
  states.push({name,state});await page.screenshot({animations:'disabled',path:`${dir}/browser-${name}.png`});return state;
 };
 await shot('default-hidden',false);
 await page.evaluate(()=>{window.u10Set();window.u10Inspect();});const before=await shot('absorbing',true);
 await page.evaluate(()=>{const g=window.activeGame,s=JSON.parse(JSON.stringify(g.toSnapshot()));if(!g.loadSnapshot(s))throw Error('load failed');window.u10Inspect();});const loaded=await shot('loaded',true);
 const fields=['targetCorpseLoc','targetCorpseName','corpseAbsorptionCounter','absorptionFlags','absorbBehavior','absorptionBolt','isAbsorbing','newPowerCount','totalPowerCount'];
 for(const f of fields)assert.deepEqual(loaded[f],before[f]);
 await page.setViewportSize({width:700,height:800});
 await page.evaluate(()=>{const m=window.activeGame.monsters[0];m.applyShield(10000);m.takeDamage(1);window.u10Inspect();});
 const interrupted=await shot('interrupted-narrow',true);assert.equal(interrupted.isAbsorbing,false);assert.equal(interrupted.corpseAbsorptionCounter,13);
 await page.evaluate(()=>{window.activeGame.monsters[0].targetCorpseLoc={x:14,y:10};window.u10Inspect();});await shot('walking-hidden',false);
 await page.evaluate(()=>{window.u10Set();window.activeGame.player.setStatusDuration('hallucinating',10);window.u10Inspect();});await shot('hallucination-hidden',false);
 await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.equal(await page.locator('.detail-panel').count(),0);
 assert.deepEqual(errors,[]);
}finally {fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
