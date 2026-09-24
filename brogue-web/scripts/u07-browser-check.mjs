import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-07-evidence';
const browser=await chromium.launch({headless:false});const errors=[],states=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5197');
 await page.locator('.menu-card input[type=text]').fill('7007');
 await page.locator('.menu-card .actions').first().locator('button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text&&!!window.activeGame.onRenderRequested);
 await page.evaluate(async()=>{
  const [{Monster,MonsterState},md,{TerrainType:T,DungeonLayer:L},{rng},blink]=await Promise.all([
   import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Map/Grid.ts'),import('/src/engine/Random.ts'),import('/src/engine/Combat/MonsterBlink.ts')]);
  const g=window.activeGame;window.u07={blink,rng,T,L};
  window.u07Setup=(kind)=>{
   g.startNewGame({seed:7007,mode:'test'});g.mode='normal';g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);
    Object.assign(g.grid.getCell(x,y),{machineNumber:0,hasDormantMonster:false,isExplored:true,hasMemory:true});
   }
   g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.setStatusDuration('telepathy',100);
   const m=new Monster(14,10,md.default.find(m=>m.id==='imp'));
   m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');m.behaviorFlags.add('MONST_ALWAYS_HUNTING');
   m.movementSpeed=m.attackSpeed=100;m.ticksUntilTurn=0;m.state=MonsterState.HUNTING;
   if(kind==='flee'){m.hp=1;m.state=MonsterState.FLEEING;}
   if(kind==='ally'){m.isAlly=true;m.loc={x:5,y:10};g.player.loc={x:22,y:10};}
   if(kind==='blocked'){g.grid.setTerrain(17,10,T.FORCEFIELD);}
   if(kind==='follower'){
    g.player.loc={x:8,y:24};g.player.setStatusDuration('invisible',100);
    const leader=new Monster(28,10,md.default.find(m=>m.id==='rat'));
    leader.state=MonsterState.ASLEEP;leader.ticksUntilTurn=10000;g.monsters.push(leader);
    m.leader=leader;m.state=MonsterState.WANDERING;g.grid.setTerrain(21,10,T.WALL);
   }
   g.monsters.push(m);window.u07Monster=m;rng.seedRandomGenerator(707);
   g.scent.update(g.grid,g.player.x,g.player.y,Array.from({length:g.grid.width},()=>Array(g.grid.height).fill(true)));
   g.updateVision();g.needsRender=true;g.update();
  };
  window.u07Read=()=>({monster:{...window.u07Monster.loc,ticks:window.u07Monster.ticksUntilTurn,hp:window.u07Monster.hp},
   turns:g.stats.turns,rng:rng.randomNumbersGenerated,text:JSON.parse(window.render_game_to_text())});
 });
 const shot=async name=>{await page.waitForTimeout(250);const state=await page.evaluate(()=>window.u07Read());states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`});return state;};
 await page.evaluate(()=>window.u07Setup('flee'));const before=await shot('flee-before');
 await page.keyboard.press('.');const flee=await shot('flee-after');assert(flee.monster.x>before.monster.x+1);assert(flee.turns>0);
 await page.evaluate(()=>window.u07Setup('hunt'));await page.keyboard.press('.');const hunt=await shot('hunt-after');assert(hunt.monster.x<14-1);
 await page.evaluate(()=>window.u07Setup('ally'));await page.keyboard.press('.');const ally=await shot('ally-after');assert(ally.monster.x>5+1);assert(ally.monster.x<22);
 await page.evaluate(()=>{window.u07Setup('blocked');window.activeGame.castMonsterBlink(window.u07Monster,{x:19,y:10});window.activeGame.update();});
 const blocked=await shot('blocked');assert.deepEqual([blocked.monster.x,blocked.monster.y],[16,10]);
 await page.evaluate(()=>window.u07Setup('follower'));await page.keyboard.press('.');const follower=await shot('follower-after');assert(follower.monster.x>15);
 const failure=await page.evaluate(()=>{
  window.u07Setup('hunt');const m=window.u07Monster;m.ticksUntilTurn=17;
  const before=window.u07Read(),ok=window.u07.blink.monsterBlinkToPreferenceMap(window.activeGame,m,()=>0,true),after=window.u07Read();return{before,after,ok};
 });assert.equal(failure.ok,false);assert.deepEqual(failure.before,failure.after);states.push({name:'flat-failure',failure});
 assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
