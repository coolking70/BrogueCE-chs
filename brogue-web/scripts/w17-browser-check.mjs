// Explicit CE effect fixture: W-24 owns the missing wand identity/pool entry.
import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const dir='ai_docs/reports/w-17-evidence',browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],states=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5187');await page.locator('select').first().selectOption('test');await page.locator('.actions button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {Grid,TerrainType:T}=await import('/src/engine/Map/Grid.ts');const {EnvironmentManager}=await import('/src/engine/Environment/Gas.ts');
  const {LightMap}=await import('/src/engine/Lighting/LightMap.ts'),{FOVSys}=await import('/src/engine/Lighting/FOV.ts');
  const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts'),{Monster,MonsterState}=await import('/src/entities/Monster.ts');
  const {getBoltForItem,BoltEffect}=await import('/src/engine/Combat/Bolt.ts'),{CEBoltType}=await import('/src/engine/Combat/BoltCatalog.ts');
  const {default:data}=await import('/src/data/monsters.json'),{rng}=await import('/src/engine/Random.ts');
  const g=window.activeGame;g.grid=new Grid(g.grid.width,g.grid.height);
  for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
   g.grid.setTerrain(x,y,x>0&&x<18&&y>0&&y<12?T.FLOOR:T.GRANITE);Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true});
  }
  g.environment=new EnvironmentManager(g.grid);g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);
  g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.ticksUntilTurn=0;
  g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;g.player.inventory.items=[];
  g.dormantMonsters=[];g.items=[];g.monsters=[];g.pendingBoltFrames=[];g.floatingTexts=[];g.autoPath=[];g.isMouseTraveling=false;
  const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1);wand.charges=3;g.player.inventory.addItem(wand);window.w17Wand=wand;
  const cfg={...getBoltForItem('wand_of_slowness'),id:'w17-explicit-fixture',ceType:CEBoltType.DOMINATION,effect:BoltEffect.DOMINATION};
  const zap=g.zapBoltFromPlayer.bind(g);g.zapBoltFromPlayer=(_cfg,it,to)=>zap(cfg,it,to);
  window.w17Setup=(hp,captive=false)=>{
   const m=new Monster(9,5,data.find(d=>d.id==='goblin'));m.hp=hp;m.maxHp=100;m.state=MonsterState.HUNTING;m.ticksUntilTurn=100000;
   m.regenTurns=0;m.isCaged=captive;m.setStatusDuration('discordant',12);g.monsters=[m];g.items=[];
   if(captive){m.carriedItem=ItemLoader.spawnKey('iron_key',0,0);m.carriedItem.keyLoc=[{loc:{x:11,y:5},machine:7}];}
   window.w17Target=m;g.updateVision();g.needsRender=true;g.update();return m.id;
  };
  window.w17Cast=roll=>{
   const old=rng.randRange;rng.randRange=(lo,hi)=>lo===0&&hi===99?roll:old.call(rng,lo,hi);
   try{const r=g.zapBoltFromPlayer(cfg,wand,window.w17Target.loc);return {autoID:r.outcome.autoID,hits:r.hits.map(h=>h.creature.id)};}
   finally{rng.randRange=old;g.update();}
  };
  window.w17Setup(100);
 });
 const capture=async(name,extra={})=>{
  await page.waitForTimeout(350);await page.evaluate(()=>{window.activeGame.needsRender=true;window.activeGame.update();});await page.waitForTimeout(100);
  const state=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));states.push({name,state,...extra});await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;
 };
 let outcome=await page.evaluate(()=>window.w17Cast(0)),s=await capture('full-resists',{outcome});assert.equal(s.monsters[0].isAlly,false);assert.equal(s.monsters[0].discordant,12);assert.equal(outcome.autoID,true);
 await page.evaluate(()=>window.w17Setup(20));outcome=await page.evaluate(()=>window.w17Cast(80));s=await capture('twenty-resists',{outcome});assert.equal(s.monsters[0].isAlly,false);assert.equal(s.monsters[0].discordant,12);
 await page.evaluate(()=>window.w17Setup(20));outcome=await page.evaluate(()=>window.w17Cast(79));s=await capture('twenty-succeeds',{outcome});assert.equal(s.monsters[0].isAlly,true);assert.equal(s.monsters[0].discordant,0);
 await page.evaluate(()=>window.w17Setup(19,true));outcome=await page.evaluate(()=>window.w17Cast(99));s=await capture('captive-key',{outcome});assert.equal(s.monsters[0].isAlly,true);assert.equal(s.monsters[0].isCaged,false);assert.equal(s.items.length,1);
 await page.evaluate(()=>window.w17Target.takeTurn(window.activeGame,10));await capture('key-exposed');
 await page.evaluate(()=>{const g=window.activeGame;window.w17Saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(window.w17Saved);});s=await capture('restored');assert.equal(s.monsters[0].isAlly,true);assert.equal(s.monsters[0].dominated,true);assert.equal(s.monsters[0].discordant,0);assert.equal(s.items.length,1);
 await page.evaluate(()=>{const g=window.activeGame;window.w17Setup(19);window.w17Wand=g.player.inventory.items[0];window.w17Wand.charges=3;g.useArcanaItem(window.w17Wand);g.setArcanaTarget(9,5);});
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.w17Wand.charges),3);assert.equal(await page.evaluate(()=>window.w17Target.isAlly),false);
 await page.evaluate(()=>{window.activeGame.useArcanaItem(window.w17Wand);window.activeGame.setArcanaTarget(9,5);});await capture('targeting');await page.keyboard.press('Enter');s=await capture('confirmed');assert.equal(s.monsters[0].isAlly,true);assert.equal(await page.evaluate(()=>window.w17Wand.charges),2);
 // Exercise real combat after conversion, followed by an enemy retaliation.
 await page.evaluate(async()=>{const {Monster,MonsterState}=await import('/src/entities/Monster.ts');const {default:data}=await import('/src/data/monsters.json');const {rng}=await import('/src/engine/Random.ts');
  const g=window.activeGame,m=window.w17Target,enemy=new Monster(10,5,data.find(d=>d.id==='rat'));enemy.hp=enemy.maxHp=50;enemy.state=MonsterState.HUNTING;enemy.ticksUntilTurn=100000;g.monsters.push(enemy);
  m.onHitStatus=undefined;const before={ally:m.hp,enemy:enemy.hp},old=rng.randPercent;rng.randPercent=()=>true;try{m.takeTurn(g,10);enemy.takeTurn(g,10);}finally{rng.randPercent=old;}
  window.w17Combat={before,after:{ally:m.hp,enemy:enemy.hp}};g.updateVision();g.needsRender=true;g.update();
 });
 const combat=await page.evaluate(()=>window.w17Combat);s=await capture('combat',{combat});fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');assert.ok(combat.after.ally<combat.before.ally);assert.ok(combat.after.enemy<combat.before.enemy);
 fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');assert.deepEqual(errors,[]);console.log(JSON.stringify({scenarios:states.map(s=>s.name),errors}));
}finally{await browser.close();}
