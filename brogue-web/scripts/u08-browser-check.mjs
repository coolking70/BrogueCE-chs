import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-08-evidence';
const browser=await chromium.launch({headless:false});const errors=[],states=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5198');
 await page.locator('.menu-card input[type=text]').fill('8008');
 await page.locator('.menu-card .actions').first().locator('button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text&&!!window.activeGame.onRenderRequested);
 await page.evaluate(async()=>{
  const [{Monster,MonsterState},md,{TerrainType:T,DungeonLayer:L},{rng}]=await Promise.all([
   import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Map/Grid.ts'),import('/src/engine/Random.ts')]);
  const g=window.activeGame;window.u08={rng,T,L};
  window.u08Setup=kind=>{
   g.startNewGame({seed:8008,mode:'test'});g.mode='normal';g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);
    Object.assign(g.grid.getCell(x,y),{machineNumber:0,hasDormantMonster:false,isExplored:true,hasMemory:true});
   }
   g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=150;
   const m=new Monster(17,10,md.default.find(m=>m.id===(kind==='web'?'spider':'mangrove_dryad')));
   m.ticksUntilTurn=0;m.state=MonsterState.HUNTING;m.behaviorFlags.add('MONST_ALWAYS_HUNTING');
   g.monsters.push(m);window.u08Monster=m;
   if(kind==='monster'){
    g.player.loc={x:10,y:13};g.player.setStatusDuration('invisible',100);
    const rat=new Monster(10,10,md.default.find(m=>m.id==='rat'));rat.isAlly=true;rat.hp=rat.maxHp=150;rat.ticksUntilTurn=10000;
    g.monsters.push(rat);window.u08Target=rat;
   }
   rng.seedRandomGenerator(808);g.updateVision();g.needsRender=true;g.update();
  };
  window.u08Read=()=>({monster:{...window.u08Monster.loc,ticks:window.u08Monster.ticksUntilTurn,hp:window.u08Monster.hp},
   target:window.u08Target?{...window.u08Target.loc,hp:window.u08Target.hp}:null,
   surface:Array.from({length:g.grid.width},(_,x)=>Array.from({length:g.grid.height},(_,y)=>T[g.grid.getCell(x,y).layers[L.SURFACE]])),
   turns:g.stats.turns,text:JSON.parse(window.render_game_to_text())});
 });
 const shot=async name=>{await page.waitForTimeout(300);const state=await page.evaluate(()=>window.u08Read());states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`});return state;};
 await page.evaluate(()=>window.u08Setup('web'));await page.keyboard.press('.');const web=await shot('web');
 assert.equal(web.surface[10][10],'WEB');assert(web.turns>0);
 // Real player movement attempts consume turns through the existing web hold.
 await page.keyboard.press('ArrowDown');await shot('web-move');
 await page.evaluate(()=>window.u08Setup('vines'));await page.keyboard.press('.');const vines=await shot('vines-player');
 assert.equal(vines.surface[10][10],'ANCIENT_SPIRIT_GRASS');assert(vines.surface.flat().includes('ANCIENT_SPIRIT_VINES'));
 await page.evaluate(()=>{window.u08Setup('monster');window.u08Monster.tryUseBolt(window.activeGame);window.activeGame.update();});
 const monster=await shot('vines-monster');assert.equal(monster.surface[10][10],'ANCIENT_SPIRIT_VINES');assert.equal(monster.target.hp,150);
 await page.evaluate(()=>{const g=window.activeGame;g.applyEnvironmentalEffects();g.update();});
 const hurt=await shot('vines-damage');assert.equal(hurt.target.hp,140);
 await page.evaluate(()=>{const g=window.activeGame;g.environment.ignite(10,10);g.needsRender=true;g.update();});
 const fire=await shot('vines-burn');assert.equal(fire.surface[10][10],'PLAIN_FIRE');
 assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
