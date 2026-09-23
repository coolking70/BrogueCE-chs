// Actual empowerment wand/target/submit paths; charges=3 is a repeat-cast fixture.
import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const dir='ai_docs/reports/w-21-evidence',browser=await chromium.launch({headless:false});const states=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5191');await page.locator('select').first().selectOption('test');await page.locator('.actions button').first().click();await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {Grid,TerrainType:T}=await import('/src/engine/Map/Grid.ts'),{EnvironmentManager}=await import('/src/engine/Environment/Gas.ts'),{LightMap}=await import('/src/engine/Lighting/LightMap.ts'),{FOVSys}=await import('/src/engine/Lighting/FOV.ts');
  const {Monster,MonsterState}=await import('/src/entities/Monster.ts'),{ItemLoader}=await import('/src/engine/Items/ItemLoader.ts'),{getBoltForItem,BoltEffect}=await import('/src/engine/Combat/Bolt.ts'),{CEBoltType}=await import('/src/engine/Combat/BoltCatalog.ts'),{default:data}=await import('/src/data/monsters.json');
  const g=window.activeGame;g.animationEnabled=false;const cfg=getBoltForItem('wand_of_empowerment');
  window.w21Setup=(id='rat',ally=false)=>{
   g.grid=new Grid(g.grid.width,g.grid.height);for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){g.grid.setTerrain(x,y,x>0&&x<18&&y>0&&y<12?T.FLOOR:T.GRANITE);Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true,isDiscovered:true});}
   g.environment=new EnvironmentManager(g.grid);g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.ticksUntilTurn=0;g.player.refreshSpeeds();g.ticksTillUpdateEnvironment=100;
   g.player.inventory.items=[];g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;g.isInventoryOpen=false;g.inspectTarget=null;g.pendingArcana=null;g.dormantMonsters=[];g.items=[];g.pendingBoltFrames=[];g.floatingTexts=[];g.autoPath=[];g.isMouseTraveling=false;g.levels.clear();
   const wand=ItemLoader.spawnWand('wand_of_empowerment',-1,-1);wand.charges=3;g.player.inventory.addItem(wand);window.w21Wand=wand;
   const m=new Monster(8,5,data.find(d=>d.id===id));m.state=MonsterState.HUNTING;m.ticksUntilTurn=100000;m.isAlly=ally;g.monsters=[m];window.w21Target=m;g.updateVision();g.needsRender=true;g.update();
  };
  window.w21Cast=()=>g.zapBoltFromPlayer(cfg,window.w21Wand,window.w21Target.loc).outcome;
  window.w21Setup();
 });
 const capture=async name=>{await page.waitForTimeout(300);await page.evaluate(()=>{const g=window.activeGame;g.needsRender=true;g.update();});await page.waitForTimeout(60);const state=await page.evaluate(()=>({text:JSON.parse(window.render_game_to_text()),monsters:window.activeGame.monsters.map(m=>({id:m.id,type:m.typeId,hp:m.hp,maxHp:m.maxHp,accuracy:m.accuracy,defense:m.defense,damage:m.damageString,newPowerCount:m.newPowerCount,totalPowerCount:m.totalPowerCount,status:{...m.statusDurations},poisonAmount:m.poisonAmount,ally:m.isAlly})),charges:window.w21Wand.charges,frames:window.activeGame.pendingBoltFrames}));states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;};
 await page.evaluate(()=>{window.activeGame.useArcanaItem(window.w21Wand);window.activeGame.setArcanaTarget(8,5);});await capture('targeting');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.w21Wand.charges),3);
 await page.evaluate(()=>{window.w21Target.hp=1;window.activeGame.useArcanaItem(window.w21Wand);window.activeGame.setArcanaTarget(8,5);});await page.keyboard.press('Enter');let s=await capture('first-hit');assert.equal(s.monsters[0].maxHp,18);assert.equal(s.monsters[0].totalPowerCount,1);assert.equal(s.charges,2);
 await page.evaluate(()=>{const g=window.activeGame;g.pendingBoltFrames=[];g.useArcanaItem(window.w21Wand);g.setArcanaTarget(8,5);});await page.keyboard.press('Enter');s=await capture('second-hit');assert.equal(s.monsters[0].maxHp,30);assert.equal(s.monsters[0].totalPowerCount,2);assert.equal(s.monsters[0].damage,'3-5');assert.equal(s.text.monsters[0].newPowerCount,2);assert.equal(s.charges,1);
 await page.evaluate(()=>{window.w21Setup('rat',true);const m=window.w21Target;m.hp=1;m.statusDurations={confused:30,slowed:30,poisoned:9,weakened:9,paralyzed:7,entranced:8,shielded:200};m.poisonAmount=3;m.maxShield=200;m.refreshSpeeds();window.w21Cast();});s=await capture('panacea');assert.equal(s.monsters[0].status.confused,1);assert.equal(s.monsters[0].status.slowed,1);assert.equal(s.monsters[0].poisonAmount,0);assert.equal(s.monsters[0].status.paralyzed,7);
 await page.evaluate(()=>{const g=window.activeGame;window.w21Target.tickStatuses();g.handleInspectAt(8,5);});await capture('pending-talent-detail');assert.ok(await page.getByText('似乎已准备好学习 1 项新能力。').count());
 await page.locator('.detail-close').click();
 await page.evaluate(()=>{const g=window.activeGame;g.inspectTarget=null;g.cloneMonster(window.w21Target);g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));});s=await capture('clone-and-save');assert.equal(s.monsters.length,2);assert.ok(s.monsters.every(m=>m.totalPowerCount===1&&m.maxHp===18));
 await page.evaluate(()=>{window.w21Setup('stone_guardian');window.activeGame.player.hp=1;window.w21Cast();});s=await capture('reflected-player');assert.equal(s.text.player.hp,1);assert.equal(s.monsters[0].totalPowerCount,0);
 await page.evaluate(()=>{window.w21Setup('arrow_turret');window.w21Target.hp=1;window.w21Cast();});s=await capture('inanimate');assert.equal(s.monsters[0].hp,1);assert.equal(s.monsters[0].totalPowerCount,0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({scenarios:states.map(s=>s.name),errors}));
}finally{fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
