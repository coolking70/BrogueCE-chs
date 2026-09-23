// Explicit effect fixture only; polymorphism wand identity/generation stays W-24.
import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const dir='ai_docs/reports/w-19-evidence',browser=await chromium.launch({headless:false});
const states=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5189');await page.locator('select').first().selectOption('test');await page.locator('.actions button').first().click();await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {Grid,TerrainType:T}=await import('/src/engine/Map/Grid.ts'),{EnvironmentManager}=await import('/src/engine/Environment/Gas.ts');
  const {LightMap}=await import('/src/engine/Lighting/LightMap.ts'),{FOVSys}=await import('/src/engine/Lighting/FOV.ts');
  const {Monster,MonsterState}=await import('/src/entities/Monster.ts'),{ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');
  const {getBoltForItem,BoltEffect}=await import('/src/engine/Combat/Bolt.ts'),{CEBoltType}=await import('/src/engine/Combat/BoltCatalog.ts');
  const {default:data}=await import('/src/data/monsters.json'),{rng}=await import('/src/engine/Random.ts');
  const originalRange=rng.randRange.bind(rng),originalPercent=rng.randPercent.bind(rng);const g=window.activeGame;g.animationEnabled=false;
  const cfg={...getBoltForItem('wand_of_slowness'),id:'w19-explicit-fixture',ceType:CEBoltType.POLYMORPH,effect:BoltEffect.POLYMORPH};
  const zap=g.zapBoltFromPlayer.bind(g);g.zapBoltFromPlayer=(_cfg,it,to)=>zap(cfg,it,to);
  window.w19Setup=(id='rat',next='dragon',ally=true)=>{
   rng.randRange=originalRange;rng.randPercent=originalPercent;
   g.grid=new Grid(g.grid.width,g.grid.height);
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x>0&&x<18&&y>0&&y<12?T.FLOOR:T.GRANITE);Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true,isDiscovered:true});
   }
   g.environment=new EnvironmentManager(g.grid);g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.ticksUntilTurn=0;g.player.refreshSpeeds();g.ticksTillUpdateEnvironment=100;
   g.player.inventory.items=[];g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;g.isInventoryOpen=false;g.pendingArcana=null;g.dormantMonsters=[];g.items=[];g.pendingBoltFrames=[];g.floatingTexts=[];g.autoPath=[];g.isMouseTraveling=false;g.levels.clear();
   const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1);wand.charges=3;g.player.inventory.addItem(wand);window.w19Wand=wand;
   const m=new Monster(8,5,data.find(d=>d.id===id));m.state=MonsterState.HUNTING;m.ticksUntilTurn=100000;m.isAlly=ally;m.dominated=ally;g.monsters=[m];window.w19Target=m;window.w19OriginalId=m.id;
   const selected=data.findIndex(d=>d.id===next)+1;rng.randRange=(lo,hi)=>lo===1&&hi===67?selected:originalRange(lo,hi);
   g.updateVision();g.needsRender=true;g.update();
  };
  window.w19Cast=()=>{const r=g.zapBoltFromPlayer(cfg,window.w19Wand,window.w19Target.loc);g.update();return r.outcome;};
  window.w19Setup();
 });
 const capture=async name=>{await page.waitForTimeout(400);await page.evaluate(()=>{const g=window.activeGame;g.pendingBoltFrames=[];g.needsRender=true;g.update();});await page.waitForTimeout(100);const state=await page.evaluate(()=>({text:JSON.parse(window.render_game_to_text()),monsters:window.activeGame.monsters.map(m=>({id:m.id,type:m.typeId,hp:m.hp,maxHp:m.maxHp,ally:m.isAlly,leader:m.leader?.id??null,status:{...m.statusDurations},move:m.moveSpeed,attack:m.attackSpeed,ticks:m.ticksUntilTurn,key:m.carriedItem?.id??null})),charges:window.w19Wand.charges}));states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;};
 await page.evaluate(()=>{window.activeGame.useArcanaItem(window.w19Wand);window.activeGame.setArcanaTarget(8,5);});await capture('targeting');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.w19Wand.charges),3);
 await page.evaluate(()=>{window.activeGame.useArcanaItem(window.w19Wand);window.activeGame.setArcanaTarget(8,5);});await page.keyboard.press('Enter');let s=await capture('ally-to-dragon');assert.equal(s.monsters[0].type,'dragon');assert.equal(s.monsters[0].ally,false);assert.equal(s.charges,2);assert.equal(s.monsters[0].id,await page.evaluate(()=>window.w19OriginalId));
 await page.evaluate(()=>{window.w19Setup('ogre','jackal',false);window.w19Target.hp=28;window.w19Target.statusDurations={hasted:12,poisoned:8,shielded:200};window.w19Target.poisonAmount=4;window.w19Target.maxShield=200;window.w19Cast();});s=await capture('injured-hasted');assert.equal(s.monsters[0].hp,4);assert.equal(s.monsters[0].move,25);assert.equal(s.monsters[0].attack,50);assert.deepEqual(s.monsters[0].status,{});
 await page.evaluate(()=>{const g=window.activeGame;g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));});s=await capture('restored');assert.equal(s.monsters[0].type,'jackal');assert.equal(s.monsters[0].move,25);assert.equal(s.monsters[0].hp,4);
 await page.evaluate(()=>{window.w19Setup('rat','phantom',true);window.w19Cast();});s=await capture('invisible-form');assert.equal(s.monsters[0].status.invisible,1000);assert.equal(s.monsters[0].ally,false);
 await page.evaluate(async()=>{window.w19Setup('rat','jackal',false);const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');window.w19Target.isCaged=true;window.w19Target.carriedItem=ItemLoader.spawnKey('iron_key',8,5);window.w19Cast();});s=await capture('captive-keeps-key');assert.ok(s.monsters[0].key);assert.equal(s.monsters[0].ally,false);
 await page.evaluate(()=>{window.w19Target.takeDamage(window.w19Target.hp,true);window.activeGame.removeDeadMonsters();window.activeGame.updateVision();});s=await capture('death-drops-key');assert.equal(s.monsters.length,0);assert.equal(await page.evaluate(()=>window.activeGame.items.length),1);
 await page.evaluate(()=>{window.w19Setup('stone_guardian','jackal',false);window.w19Cast();});s=await capture('reflection');assert.equal(s.monsters[0].type,'stone_guardian');assert.equal(s.text.player.hp,100);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({scenarios:states.map(s=>s.name),errors}));
}finally{fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
