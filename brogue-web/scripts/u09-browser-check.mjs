import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-09-evidence';
const browser=await chromium.launch({headless:false}),states=[],errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');
 await page.locator('.menu-card input[type=text]').fill('9009');await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text&&!!window.activeGame.onRenderRequested);
 await page.evaluate(async()=>{
  const [{Monster,MonsterState},md,{TerrainType:T},{rng}]=await Promise.all([import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Map/Grid.ts'),import('/src/engine/Random.ts')]);
  const g=window.activeGame;
  const cast=g.castMonsterBolt.bind(g);
  g.castMonsterBolt=(caster,target,name)=>{const result=cast(caster,target,name);window.u09.casts.push(name);return result;};
  window.u09Setup=name=>{
   g.startNewGame({seed:9009,mode:'test'});g.mode='normal';g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);
    Object.assign(g.grid.getCell(x,y),{machineNumber:0,hasDormantMonster:false,isExplored:true,hasMemory:true});
   }
   g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=300;
   const caster=new Monster(17,10,md.default.find(m=>m.id==='rat')),target=new Monster(13,10,md.default.find(m=>m.id==='rat'));
   caster.isAlly=name!=='INVISIBILITY';caster.bolts=[name];caster.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');caster.behaviorFlags.add('MONST_ALWAYS_HUNTING');
   caster.state=MonsterState.HUNTING;caster.ticksUntilTurn=100;caster.newPowerCount=2;caster.totalPowerCount=3;
   target.state=MonsterState.HUNTING;target.hp=name==='DOMINATION'?1:100;target.maxHp=100;target.ticksUntilTurn=10000;
   g.monsters.push(caster,target);window.u09={caster,target,casts:[]};
   if(name==='TELEPORT')for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(25,y,T.WALL);
   rng.seedRandomGenerator(909);g.updateVision();g.needsRender=true;g.update();
  };
  window.u09Read=()=>{
   const entity=m=>({id:m.id,typeId:m.typeId,hp:m.hp,loc:{...m.loc},isAlly:m.isAlly,status:{...m.statusDurations},weakness:m.weaknessAmount,poison:m.poisonAmount,bolts:[...m.bolts],newPowerCount:m.newPowerCount,totalPowerCount:m.totalPowerCount,visible:g.visibleMonsters.has(m)});
   return {casts:[...window.u09.casts],caster:entity(window.u09.caster),target:entity(window.u09.target),blades:g.monsters.filter(m=>m.typeId==='spectral_blade').map(m=>({loc:m.loc,isAlly:m.isAlly,boundToPlayer:m.boundToPlayer})),text:JSON.parse(window.render_game_to_text())};
  };
 });
 const shot=async name=>{await page.waitForFunction(()=>!window.activeGame.isAdvancing&&window.activeGame.pendingBoltFrames.length===0);await page.waitForTimeout(100);const state=await page.evaluate(()=>window.u09Read());states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`});return state;};
 for(const name of ['TELEPORT','SLOW','POLYMORPH','DOMINATION','INVISIBILITY','LIGHTNING','POISON','ENTRANCEMENT','CONJURATION']) {
  await page.evaluate(name=>window.u09Setup(name),name);await page.keyboard.press('.');const s=await shot(name.toLowerCase());
  assert.deepEqual(s.casts,[name]);
  assert.deepEqual([s.caster.newPowerCount,s.caster.totalPowerCount],[2,3]);
  if(name==='TELEPORT')assert.notDeepEqual(s.target.loc,{x:13,y:10});
  if(name==='SLOW')assert(s.target.status.slowed>0);
  if(name==='POLYMORPH')assert.notEqual(s.target.typeId,'rat');
  if(name==='DOMINATION')assert(s.target.isAlly);
  if(name==='INVISIBILITY')assert(s.target.status.invisible>0); // U21/K17 display gap recorded below.
  if(name==='LIGHTNING')assert(s.target.hp<100);
  if(name==='POISON')assert(s.target.status.poisoned>0&&s.target.poison===1);
  if(name==='ENTRANCEMENT')assert(s.target.status.entranced>0);
  if(name==='CONJURATION'){assert.equal(s.blades.length,15);assert(s.blades.every(b=>b.isAlly&&b.boundToPlayer));}
 }
 await page.evaluate(()=>{
  window.u09Setup('SLOW');const g=window.activeGame,m=window.u09.target;window.u09.caster.bolts=[];
  for(const flag of ['MONST_FLIES','MONST_IMMUNE_TO_FIRE','MONST_INVISIBLE','MONST_REFLECT_50'])m.behaviorFlags.add(flag);
  m.syncFlagDerivedStatuses(true);m.tickStatuses();g.needsRender=true;g.update();
 });
 const hidden=await shot('permanent-invisible');assert.equal(hidden.target.status.invisible,1000);assert(!hidden.target.visible);
 await page.evaluate(()=>{const g=window.activeGame;g.negateCreatureMagic(window.u09.target);g.needsRender=true;g.update();});
 const visible=await shot('negated-visible');assert(!visible.target.status.invisible);assert(visible.target.visible);
 await page.evaluate(()=>{
  window.u09Setup('SLOW');const g=window.activeGame,m=window.u09.target;window.u09.caster.bolts=[];
  m.behaviorFlags.add('MONST_FIERY');m.behaviorFlags.add('MONST_IMMUNE_TO_FIRE');m.behaviorFlags.add('MONST_REFLECT_50');
  m.syncFlagDerivedStatuses(true);m.tickStatuses();g.needsRender=true;g.update();
 });
 const fiery=await shot('learned-with-fiery');assert.equal(fiery.target.status.burning,1000);
 await page.evaluate(()=>{const g=window.activeGame;g.negateCreatureMagic(window.u09.target);g.needsRender=true;g.update();});
 const extinguished=await shot('negated-fiery');assert(!extinguished.target.status.burning);
 assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors,knownVisibilityGap:'U21/K17: temporary invisibility still enters visibleMonsters; GameCanvas/Appearance draw from cellVisible without consuming invisible. Permanent flag hides discovery, but not that renderer.'},null,2)+'\n');await browser.close();}
