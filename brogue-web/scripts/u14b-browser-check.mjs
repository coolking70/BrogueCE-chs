import { chromium } from 'playwright';
import fs from 'node:fs';import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-14b-evidence';
const browser=await chromium.launch({headless:false});const states=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5198');await page.locator('.menu-card input[type=text]').fill('1414');await page.locator('.menu-card .actions').first().locator('button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text && !!window.activeGame.onRenderRequested);
 await page.evaluate(async()=>{
  const [{Monster,MonsterState},md,{TerrainType:T,DungeonLayer:L},{ItemLoader},{generateMonsterDetail}]=await Promise.all([import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Map/Grid.ts'),import('/src/engine/Items/ItemLoader.ts'),import('/src/engine/UI/DetailGenerator.ts')]);
  const g=window.activeGame;g.startNewGame({seed:1414,mode:'test'});g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;g.player.loc={x:8,y:8};g.player.hp=g.player.maxHp=100;
  for(let x=2;x<30;x++)for(let y=2;y<20;y++){g.grid.setTerrain(x,y,T.FLOOR);g.grid.getCell(x,y).layers[L.GAS]=T.NOTHING;}
  const armor=ItemLoader.spawnArmor('chain_mail',0,0);armor.armor=6;armor.enchantment=2;armor.strengthRequired=12;g.player.inventory.addItem(armor);g.equipItem(armor);
  g.grid.setTerrainLayer(8,8,L.SURFACE,T.WEB);g.applyEntanglementFromTerrain(g.player);
  // Deterministic remaining count after testing the real terrain source.
  g.player.setStatusDuration('stuck',3);g.player.maxStatus.stuck=3;
  const m=new Monster(13,8,md.default.find(d=>d.id==='goblin'));m.state=MonsterState.HUNTING;m.hp=m.maxHp=100;m.ticksUntilTurn=100000;m.abilityFlags.add('MA_AVOID_CORRIDORS');m.enrageAfterAttack();m.applyStatus('lifespan_remaining',8);g.monsters=[m];window.u14bm=m;
  window.u14bdetail=()=>{g.inspectTarget=generateMonsterDetail(window.u14bm,g.player.hp,g.player.effectiveStrength,0,null,0,12,g.player.equippedArmor.armor,g.player.equippedArmor.enchantment,12,false,g.player.getStatusDuration('donning'),g.player.hasStatus('stuck'));};
  window.u14bread=()=>({state:JSON.parse(window.render_game_to_text()),sidebar:document.querySelector('.status-panel')?.textContent,monster:{hp:window.u14bm.hp,status:{...window.u14bm.statusDurations},max:{...window.u14bm.maxStatus}},web:g.grid.getCell(8,8).layers[L.SURFACE]});
  g.updateVision();g.needsRender=true;g.update();
 });
 const shot=async(name)=>{await page.waitForTimeout(300);const state=await page.evaluate(()=>window.u14bread());states.push({name,...state});await page.screenshot({path:`${dir}/browser-${name}.png`,animations:'disabled'});return state;};
 const before=await shot('equipped-stuck');assert.match(before.sidebar,/缠绕/);assert.match(before.sidebar,/穿甲/);assert.doesNotMatch(before.sidebar,/狂怒|enraged/);
 await page.keyboard.press('ArrowRight');const struggle=await shot('struggle');assert.equal(struggle.state.player.x,8);assert.equal(struggle.state.player.statuses.stuck,2);assert.equal(struggle.state.player.statuses.donning,before.state.player.statuses.donning-1);
 await page.evaluate(()=>window.u14bdetail());const detail=await shot('lifespan-detail');assert.equal(detail.monster.status.lifespan_remaining,7);await page.keyboard.press('Escape');
 await page.evaluate(()=>{const g=window.activeGame,id=window.u14bm.id;const save=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(save);window.u14bm=g.monsters.find(m=>m.id===id);g.needsRender=true;g.update();});
 const loaded=await shot('save-roundtrip');assert.equal(loaded.state.player.statuses.stuck,2);assert.equal(loaded.monster.status.lifespan_remaining,7);
 await page.keyboard.press('ArrowRight');await shot('last-count');await page.keyboard.press('ArrowRight');const released=await shot('released');assert.equal(released.state.player.x,9);assert.equal(released.state.player.statuses.stuck,undefined);
 await page.evaluate(()=>{const g=window.activeGame;window.u14bm.setStatusDuration('lifespan_remaining',1);g.player.setStatusDuration('donning',1);g.needsRender=true;g.update();});
 await page.keyboard.press('Period');const expired=await shot('expired');assert.equal(expired.monster.hp,0);assert.equal(expired.state.player.statuses.donning,undefined);
 await page.setViewportSize({width:700,height:800});await shot('narrow');assert.deepEqual(errors,[]);
 fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');console.log(`${states.length} browser scenarios, no errors`);
}finally{await browser.close();}
