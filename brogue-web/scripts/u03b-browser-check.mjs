import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-03b-evidence',errors=[],results=[];
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5196');await page.locator('.menu-card input[type=text]').fill('7');
 const actions=()=>page.locator('.menu-card .actions').first().locator('button');await actions().first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const prepared=await page.evaluate(async()=>{
  const {TerrainType}=await import('/src/engine/Map/Grid.ts');const {Monster,MonsterState}=await import('/src/entities/Monster.ts');
  const data=(await import('/src/data/monsters.json')).default;const g=window.activeGame;g.animationEnabled=false;g.player.hp=g.player.maxHp=10000;
  const stair=g.toSnapshot().grid.find(c=>c.layers.includes(TerrainType.STAIRS_DOWN));
  const x=stair.x>5?stair.x-4:stair.x+4,y=stair.y;
  for(let a=Math.min(x,stair.x);a<=Math.max(x,stair.x);a++)g.grid.setTerrain(a,y,TerrainType.FLOOR);
  g.grid.setTerrain(stair.x,stair.y,TerrainType.STAIRS_DOWN);
  g.monsters=[];const ally=new Monster(x,y,data.find(m=>m.id==='rat'));ally.isAlly=true;ally.state=MonsterState.HUNTING;ally.hp=ally.maxHp=100;
  g.monsters=[ally];g.player.loc={x:stair.x,y:stair.y};
  g.handlePlayerAction('stairs_down',undefined,'system');g.update();
  return {id:ally.id,countdown:ally.entersLevelIn,depth:g.depth};
 });
 assert.equal(prepared.depth,2);assert.ok(prepared.countdown>1);
 await page.waitForTimeout(200);
 await page.locator('.menu-btn').click();await actions().nth(2).click();
 await page.waitForFunction(async()=>!!await(await import('/src/engine/Core/SaveStorage.ts')).readSnapshot());
 const checkpoint=await page.evaluate(async()=>JSON.parse(JSON.stringify(await(await import('/src/engine/Core/SaveStorage.ts')).readSnapshot())));
 assert.equal(checkpoint.levels[0].monsters.find(m=>m.id===prepared.id).entersLevelIn,prepared.countdown);
 await page.screenshot({path:`${dir}/browser-in-transit.png`});
 await actions().nth(4).click();
 const advance=async()=>{
  for(let i=0;i<prepared.countdown;i++) await page.keyboard.press('.');
  await page.waitForTimeout(250);
  return page.evaluate(()=>{const s=JSON.parse(JSON.stringify(window.activeGame.toSnapshot()));delete s.savedAt;delete s.run.logger;return s;});
 };
 const direct=await advance();assert.ok(direct.monsters.some(m=>m.id===prepared.id));
 await page.screenshot({path:`${dir}/browser-arrived.png`});
 await page.reload();await page.waitForFunction(()=>[...document.querySelectorAll('.menu-card .actions button')][1]?.disabled===false);await actions().nth(1).click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);await page.evaluate(()=>{window.activeGame.animationEnabled=false;});
 const loaded=await page.evaluate(()=>{const s=JSON.parse(JSON.stringify(window.activeGame.toSnapshot()));delete s.savedAt;delete s.run.logger;return s;});
 delete checkpoint.savedAt;delete checkpoint.run.logger;assert.deepEqual(loaded,checkpoint);
 const resumed=await advance();assert.deepEqual(resumed,direct);
 results.push({scene:'ordinary follower + keyboard wait + menu save/reload',...prepared,checkpointEqual:true,continuationEqual:true});
 const revisit=await page.evaluate(async()=>{
  const {TerrainType}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;
  const before={absolute:g.absoluteTurnNumber,turns:g.stats.turns,nutrition:g.player.nutrition,status:JSON.stringify(g.player.statusDurations)};
  const away=g.absoluteTurnNumber-g.levels.get(1).awaySince;
  const stair=g.toSnapshot().grid.find(c=>c.layers.includes(TerrainType.STAIRS_UP));g.player.loc={x:stair.x,y:stair.y};
  let count=0;const fn=g.updateEnvironment;g.updateEnvironment=function(){count++;return fn.call(this);};
  g.handlePlayerAction('stairs_up',undefined,'system');g.update();delete g.updateEnvironment;
  return {before,after:{absolute:g.absoluteTurnNumber,turns:g.stats.turns,nutrition:g.player.nutrition,status:JSON.stringify(g.player.statusDurations)},away,count,depth:g.depth};
 });
 assert.equal(revisit.depth,1);assert.equal(revisit.count,Math.min(100,revisit.away));assert.deepEqual(revisit.after,revisit.before);results.push(revisit);
 await page.waitForTimeout(200);await page.screenshot({path:`${dir}/browser-return.png`});
 await page.setViewportSize({width:700,height:900});await page.screenshot({path:`${dir}/browser-narrow.png`});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({results,errors,text:await page.evaluate(()=>JSON.parse(window.render_game_to_text()))},null,2)+'\n');
}finally{await browser.close();}
