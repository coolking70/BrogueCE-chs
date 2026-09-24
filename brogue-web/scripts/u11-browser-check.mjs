import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-11-evidence',states=[],errors=[];
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');
 await page.locator('.menu-card input[type=text]').fill('1111');await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text&&!!window.activeGame.onRenderRequested);
 await page.evaluate(async()=>{
  const [{Monster,MonsterState},md,{TerrainType:T,DungeonLayer:L},{getBoltForItem},{ItemLoader},{logger},{rng},{ScentMap}]=await Promise.all([
   import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Map/Grid.ts'),import('/src/engine/Combat/Bolt.ts'),import('/src/engine/Items/ItemLoader.ts'),import('/src/engine/Systems/Logger.ts'),import('/src/engine/Random.ts'),import('/src/engine/Map/Scent.ts')]);
  window.u11Setup=(kind)=>{
   const g=window.activeGame;g.startNewGame({seed:1111,mode:'test'});g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);
    Object.assign(g.grid.getCell(x,y),{isExplored:true,hasMemory:true,machineNumber:0,hasDormantMonster:false});
   }
   g.player.loc={x:4,y:8};g.player.hp=g.player.maxHp=1000;
   const m=new Monster(8,8,md.default.find(m=>m.id==='rat'));m.isAlly=true;m.state=MonsterState.HUNTING;m.ticksUntilTurn=100;
   const donor=new Monster(5,8,md.default.find(m=>m.id===({weakness:'centipede',blink:'imp',vines:'mangrove_dryad',flight:'fury'})[kind]));donor.hp=1;donor.ticksUntilTurn=10000;
   g.monsters=[m];g.zapBoltFromPlayer(getBoltForItem('wand_of_empowerment'),ItemLoader.spawnWand('wand_of_empowerment',-1,-1),m.loc);g.monsters.push(donor);
   window.u11Id=m.id;window.u11Kind=kind;window.u11Victim=null;rng.seedRandomGenerator(1111);
   g.updateVision();g.needsRender=true;g.update();
  };
  window.u11Read=()=>{const g=window.activeGame,m=g.monsters.find(a=>a.id===window.u11Id);return {kind:window.u11Kind,loc:{...m.loc},target:m.targetCorpseLoc,counter:m.corpseAbsorptionCounter,absorbing:m.isAbsorbing,slots:m.newPowerCount,total:m.totalPowerCount,bolts:m.bolts,flags:[...m.behaviorFlags],abilities:[...m.abilityFlags],turns:g.stats.turns,detail:g.inspectTarget,logs:logger.messages,text:JSON.parse(window.render_game_to_text())};};
  window.u11Inspect=()=>{const g=window.activeGame,m=g.monsters.find(a=>a.id===window.u11Id);g.updateVision();g.needsRender=true;g.update();g.handleInspectAt(m.x,m.y);};
  window.u11Use=()=>{
   const g=window.activeGame,m=g.monsters.find(a=>a.id===window.u11Id);m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');m.ticksUntilTurn=100;
   if(window.u11Kind==='blink') {g.player.loc={x:23,y:8};g.scent=new ScentMap(g.grid.width,g.grid.height);g.scent.update(g.grid,23,8,Array.from({length:g.grid.width},()=>Array(g.grid.height).fill(true)));}
   else if(window.u11Kind==='flight'){g.player.loc={x:12,y:8};g.grid.setTerrain(6,8,T.WATER_DEEP);}
   else {const target=new Monster(9,8,md.default.find(m=>m.id==='ogre'));target.hp=target.maxHp=100;target.ticksUntilTurn=10000;g.monsters.push(target);window.u11Victim=target;}
   g.updateVision();g.needsRender=true;g.update();
  };
  window.u11Effect=()=>{const g=window.activeGame,m=g.monsters.find(a=>a.id===window.u11Id),v=window.u11Victim;return {loc:{...m.loc},levitation:m.getStatusDuration('levitating'),vines:v&&g.grid.getCell(v.x,v.y).layers[L.SURFACE]===T.ANCIENT_SPIRIT_VINES,weakness:v?.weaknessAmount};};
 });
 const wait=async(n=1)=>{for(let i=0;i<n;i++){await page.keyboard.press('.');await page.waitForTimeout(35);}};
 const shot=async(name,detail=true)=>{
  if(detail)await page.evaluate(()=>window.u11Inspect());await page.waitForTimeout(250);
  const s=await page.evaluate(()=>window.u11Read());const rendered=s.text.monsters.find(m=>m.isAlly&&m.typeId==='rat');if(rendered){assert.equal(rendered.corpseAbsorptionCounter,s.counter);assert.equal(rendered.isAbsorbing,s.absorbing);}states.push({name,state:s});await page.screenshot({animations:'disabled',path:`${dir}/browser-${name}.png`});
  if(detail)await page.keyboard.press('Escape');return s;
 };
 for(const kind of ['weakness','blink','vines','flight']){
  await page.evaluate(k=>window.u11Setup(k),kind);
  // A real directional player input kills the one-HP donor. Retry only a miss,
  // never inject a learning task or ability into the learner.
  for(let tries=0;tries<8;tries++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(50);if((await page.evaluate(()=>window.u11Read())).target)break;}
  const walking=await shot(`${kind}-walking`);assert(walking.target);assert.equal(walking.slots,1);
  for(let n=0;n<10;n++){if((await page.evaluate(()=>window.u11Read())).absorbing)break;await wait();}
  const started=await shot(`${kind}-20`);assert.equal(started.counter,20);assert.equal(started.absorbing,true);
  if(kind==='weakness'){
   await wait(7);const at13=await shot('weakness-13');assert.equal(at13.counter,13);
   await page.evaluate(()=>{const g=window.activeGame;const assertLoad=g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));if(!assertLoad)throw Error('load failed');});
   await page.setViewportSize({width:700,height:800});const loaded=await shot('weakness-loaded-narrow');assert.equal(loaded.counter,13);
   await page.evaluate(()=>{const m=window.activeGame.monsters.find(a=>a.id===window.u11Id);m.applyShield(1000);m.takeDamage(1);});
   const interrupted=await shot('weakness-interrupted');assert.equal(interrupted.absorbing,false);assert.equal(interrupted.counter,13);
   await wait();const restarted=await shot('weakness-restarted');assert.equal(restarted.counter,20);await page.setViewportSize({width:1280,height:900});
  }
  await wait(19);const one=await shot(`${kind}-1`);assert.equal(one.counter,1);assert.equal(one.slots,1);
  await wait();const done=await shot(`${kind}-learned`);assert.equal(done.slots,0);assert.equal(done.absorbing,false);assert.equal(done.target,null);
  await page.evaluate(()=>window.u11Use());const before=await page.evaluate(()=>window.u11Effect());
  if(kind==='weakness'){await page.evaluate(()=>{const g=window.activeGame,m=g.monsters.find(a=>a.id===window.u11Id);window.u11Victim.loc={x:m.x+1,y:m.y};m.accuracy=10000;});}
  await wait();const effect=await page.evaluate(()=>window.u11Effect());states.push({name:`${kind}-consumer`,before,effect});
  if(kind==='blink')assert(effect.loc.x>before.loc.x+1);
  if(kind==='vines')assert(effect.vines);
  if(kind==='flight'){assert.equal(effect.loc.x,6);assert.equal(effect.levitation,1000);}
  if(kind==='weakness')assert(effect.weakness>0);
  await shot(`${kind}-used`,false);
 }
 assert.deepEqual(errors,[]);
}finally {fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
