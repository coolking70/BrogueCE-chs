// Effect fixture only: staff identity/generation remains W-25.
import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const dir='ai_docs/reports/w-18-evidence',browser=await chromium.launch({headless:false});
const states=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5188');await page.locator('select').first().selectOption('test');await page.locator('.actions button').first().click();await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {Grid,TerrainType:T}=await import('/src/engine/Map/Grid.ts'),{EnvironmentManager}=await import('/src/engine/Environment/Gas.ts');
  const {LightMap}=await import('/src/engine/Lighting/LightMap.ts'),{FOVSys}=await import('/src/engine/Lighting/FOV.ts');
  const {Monster,MonsterState}=await import('/src/entities/Monster.ts'),{ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');
  const {getBoltForItem,BoltEffect}=await import('/src/engine/Combat/Bolt.ts'),{CEBoltType}=await import('/src/engine/Combat/BoltCatalog.ts');
  const {default:data}=await import('/src/data/monsters.json'),{rng}=await import('/src/engine/Random.ts');
  const originalPercent=rng.randPercent;const g=window.activeGame;g.animationEnabled=false;window.w18T=T;
  const cfg={...getBoltForItem('staff_of_haste'),id:'w18-explicit-fixture',ceType:CEBoltType.ENTRANCEMENT,effect:BoltEffect.ENTRANCEMENT};
  const zap=g.zapBoltFromPlayer.bind(g);g.zapBoltFromPlayer=(_cfg,it,to)=>zap(cfg,it,to);
  window.w18Setup=(id='rat',x=10,y=5)=>{
   rng.randPercent=originalPercent;
   g.grid=new Grid(g.grid.width,g.grid.height);
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x>0&&x<18&&y>0&&y<12?T.FLOOR:T.GRANITE);Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true,isDiscovered:true});
   }
   g.environment=new EnvironmentManager(g.grid);g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.ticksUntilTurn=0;g.player.refreshSpeeds();g.ticksTillUpdateEnvironment=100;
   g.player.inventory.items=[];g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;g.isInventoryOpen=false;g.pendingArcana=null;g.dormantMonsters=[];g.items=[];g.pendingBoltFrames=[];g.floatingTexts=[];g.autoPath=[];g.isMouseTraveling=false;
   const staff=ItemLoader.spawnStaff('staff_of_haste',-1,-1);staff.enchantment=8;staff.charges=3;g.player.inventory.addItem(staff);window.w18Staff=staff;
   const m=new Monster(x,y,data.find(d=>d.id===id));m.hp=m.maxHp=100;m.regenTurns=0;m.state=MonsterState.HUNTING;m.ticksUntilTurn=100000;m.onHitStatus=undefined;g.monsters=[m];window.w18Target=m;
   g.updateVision();g.needsRender=true;g.update();
  };
  window.w18Cast=()=>{const r=g.zapBoltFromPlayer(cfg,window.w18Staff,window.w18Target.loc);g.update();return r.outcome;};
  window.w18ForceHit=()=>{rng.randPercent=()=>true;};window.w18Setup();
 });
 const capture=async name=>{await page.waitForTimeout(450);await page.evaluate(()=>{const g=window.activeGame;g.pendingBoltFrames=[];g.needsRender=true;g.update();});await page.waitForTimeout(100);const state=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;};
 await page.evaluate(()=>{window.activeGame.useArcanaItem(window.w18Staff);window.activeGame.setArcanaTarget(10,5);});await capture('targeting');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.w18Staff.charges),3);
 await page.evaluate(()=>{window.activeGame.useArcanaItem(window.w18Staff);window.activeGame.setArcanaTarget(10,5);});await page.keyboard.press('Enter');let s=await capture('entranced');assert.equal(s.monsters[0].entranced,23);assert.equal(s.monsters[0].x,10);
 await page.keyboard.press('ArrowRight');s=await capture('opposite-step');assert.equal(s.player.x,5);assert.equal(s.monsters[0].x,9);
 await page.keyboard.press('.');s=await capture('wait');assert.equal(s.monsters[0].x,9);
 await page.evaluate(()=>window.activeGame.grid.setTerrain(8,5,window.w18T.GRANITE));await page.keyboard.press('ArrowRight');s=await capture('follower-wall');assert.equal(s.player.x,6);assert.equal(s.monsters[0].x,9);
 const before=s.monsters[0].entranced;await page.keyboard.press('i');s=await capture('inventory');assert.equal(s.mode,'inventory');assert.equal(s.monsters[0].entranced,before);assert.equal(s.monsters[0].x,9);await page.keyboard.press('Escape');
 await page.evaluate(()=>{const g=window.activeGame;g.grid.setTerrain(7,5,window.w18T.GRANITE);});await page.keyboard.press('ArrowRight');s=await capture('player-wall');assert.equal(s.player.x,6);assert.equal(s.monsters[0].entranced,before);
 await page.evaluate(()=>{window.w18Setup('rat',5,5);window.w18Cast();window.w18Target.ticksUntilTurn=1000;window.w18ForceHit();});await page.keyboard.press('ArrowRight');s=await capture('hit-releases');assert.equal(s.monsters[0].entranced,0);assert.ok(s.monsters[0].hp<100);
 await page.evaluate(()=>window.w18Target.ticksUntilTurn=1);await page.keyboard.press('.');s=await capture('released-attacks');assert.ok(s.player.hp<100);
 await page.evaluate(()=>{window.w18Setup('stone_guardian',8,5);window.w18Cast();});s=await capture('reflection');assert.equal(s.player.statuses.confused,24);assert.equal(s.monsters[0].entranced,0);
 await page.evaluate(()=>{window.w18Setup();window.w18Cast();const g=window.activeGame;g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));});await page.keyboard.press('ArrowRight');s=await capture('restored-step');assert.equal(s.monsters[0].x,9);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({scenarios:states.map(s=>s.name),errors}));
}finally{fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
