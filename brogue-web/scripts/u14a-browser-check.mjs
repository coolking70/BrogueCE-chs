import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-14a-evidence';
const browser=await chromium.launch({headless:false});const states=[],errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5198');
 await page.locator('.menu-card input[type=text]').fill('1414');
 await page.locator('.menu-card .actions').first().locator('button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text && !!window.activeGame.onRenderRequested);
 await page.evaluate(async()=>{
  const [{Monster,MonsterState},md,{TerrainType:T,DungeonLayer},{rng},{ItemLoader},{generateMonsterDetail}]=await Promise.all([
   import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Map/Grid.ts'),import('/src/engine/Random.ts'),import('/src/engine/Items/ItemLoader.ts'),import('/src/engine/UI/DetailGenerator.ts')]);
  const g=window.activeGame;
  window.u14setup=()=>{g.startNewGame({seed:1414,mode:'test'});g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;g.player.loc={x:8,y:8};g.player.hp=g.player.maxHp=100;
   for(let x=2;x<30;x++)for(let y=2;y<20;y++){g.grid.setTerrain(x,y,T.FLOOR);g.grid.getCell(x,y).layers[DungeonLayer.GAS]=T.NOTHING;}
   g.player.weaken(300);g.player.weaken(300);g.player.weaken(300);g.player.applyStatus('darkness',15);
   g.grid.getCell(8,8).layers[DungeonLayer.GAS]=T.STENCH_SMOKE_GAS;g.applyEnvironmentalEffects(g.player);g.grid.getCell(8,8).layers[DungeonLayer.GAS]=T.NOTHING;
   const m=new Monster(12,8,md.default.find(d=>d.id==='rat'));m.state=MonsterState.HUNTING;m.hp=m.maxHp=100;m.applyStatus('magical_fear',12);m.applyStatus('nauseous',20);m.weaken(300);m.ticksUntilTurn=100000;g.monsters=[m];window.u14m=m;
   g.updateVision();g.needsRender=true;g.update();
  };
  window.u14detail=()=>{g.inspectTarget=generateMonsterDetail(window.u14m,g.player.hp,g.player.effectiveStrength,0,null,0,12);};
  window.u14cure=()=>{g.player.heal(100,true);g.needsRender=true;g.update();};
  window.u14seedVomit=()=>{for(let seed=1;seed<1000;seed++){rng.seedRandomGenerator(seed);if(rng.randPercent(25)){rng.seedRandomGenerator(seed);break;}}};
  window.u14negate=()=>{g.negateCreatureMagic(g.player);g.negateCreatureMagic(window.u14m);g.needsRender=true;g.update();};
  window.u14read=()=>({state:JSON.parse(window.render_game_to_text()),sidebar:document.querySelector('.status-panel')?.textContent,monster:{status:{...window.u14m.statusDurations},weakness:window.u14m.weaknessAmount,ai:window.u14m.state},terrain:[...g.grid.getCell(8,8).layers]});
  window.u14setup();
 });
 const shot=async(name)=>{await page.waitForTimeout(250);const state=await page.evaluate(()=>window.u14read());states.push({name,...state});await page.screenshot({path:`${dir}/browser-${name}.png`});return state;};
 const before=await shot('statuses');assert.match(before.sidebar,/虚弱 -3/);assert.match(before.sidebar,/恶心/);assert.match(before.sidebar,/黑暗/);
 await page.evaluate(()=>window.u14seedVomit());await page.keyboard.press('ArrowRight');
 const after=await shot('vomit');assert.equal(after.state.player.x,before.state.player.x);assert.equal(after.state.player.hp,100);assert.equal(after.state.player.weaknessAmount,3);assert.equal(after.state.player.statuses.nauseous,19);
 await page.evaluate(()=>window.u14detail());await shot('monster-detail');await page.keyboard.press('Escape');
 await page.evaluate(()=>{const g=window.activeGame;const saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.player.weaknessAmount=0;g.player.maxStatus={};g.loadSnapshot(saved);window.u14m=g.monsters[0];g.needsRender=true;g.update();}).catch(async e=>{throw e;});
 const loaded=await shot('save-roundtrip');assert.equal(loaded.state.player.weaknessAmount,3);assert.equal(loaded.state.player.maxStatus.weakened,300);
 await page.evaluate(()=>window.u14negate());const negated=await shot('negation');assert.equal(negated.state.player.statuses.darkness,undefined);assert.equal(negated.state.player.weaknessAmount,3);assert(negated.state.player.statuses.nauseous>0);assert.equal(negated.monster.status.magical_fear,undefined);
 await page.evaluate(()=>window.u14cure());const cured=await shot('panacea');assert.equal(cured.state.player.weaknessAmount,0);assert.equal(cured.state.player.statuses.nauseous,1);
 await page.keyboard.press('Period');const expired=await shot('expiration');assert.equal(expired.state.player.statuses.nauseous,undefined);
 assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');console.log(`${states.length} browser scenarios, no console/page errors`);
} finally {await browser.close();}
