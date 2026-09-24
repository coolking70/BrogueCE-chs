import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-25-evidence', browser = await chromium.launch({headless:false});
const states = [], errors = [];
try {
 const page = await browser.newPage({ viewport:{width:1280,height:900} });
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5194');await page.locator('select').first().selectOption('test');await page.locator('.actions button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {Grid,TerrainType:T}=await import('/src/engine/Map/Grid.ts');const {rng}=await import('/src/engine/Random.ts');const {EnvironmentManager}=await import('/src/engine/Environment/Gas.ts');
  const {LightMap}=await import('/src/engine/Lighting/LightMap.ts');const {FOVSys}=await import('/src/engine/Lighting/FOV.ts');
  const {Monster,MonsterState}=await import('/src/entities/Monster.ts');const {ItemLoader:L}=await import('/src/engine/Items/ItemLoader.ts');const {default:data}=await import('/src/data/monsters.json');
  window.w25L=L;const g=window.activeGame;g.startNewGame({seed:2525,mode:'test'});g.animationEnabled=false;
  window.w25Setup=(id='rat')=>{
   rng.seedRandomGenerator(2525);L.initConsumables();g.grid=new Grid(g.grid.width,g.grid.height);
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x>0&&x<38&&y>0&&y<12?T.FLOOR:T.GRANITE);Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true,isDiscovered:true});
   }
   g.environment=new EnvironmentManager(g.grid);g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);
   g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.poisonAmount=0;
   g.player.ticksUntilTurn=0;g.player.refreshSpeeds();g.ticksTillUpdateEnvironment=100;
   g.player.inventory.items=[];g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;
   g.isInventoryOpen=false;g.inspectTarget=null;g.pendingArcana=null;g.dormantMonsters=[];g.items=[];
   g.pendingBoltFrames=[];g.floatingTexts=[];g.autoPath=[];g.isMouseTraveling=false;g.levels.clear();
   const m=new Monster(8,5,data.find(d=>d.id===id));m.state=MonsterState.HUNTING;m.ticksUntilTurn=100000;g.monsters=[m];window.w25Target=m;
   g.updateVision();g.needsRender=true;g.update();
  };window.w25Setup();
 });
 const capture=async name=>{
  await page.evaluate(()=>{const g=window.activeGame;g.needsRender=true;g.update();});await page.waitForTimeout(250);
  const state=await page.evaluate(()=>({text:JSON.parse(window.render_game_to_text()),
   inventory:window.activeGame.player.inventory.items.map(w=>({id:w.identityId,display:w.displayName,charges:w.charges,known:window.w25L.identifiedItems.has(w.identityId)})),
   monsters:window.activeGame.monsters.map(m=>({id:m.typeId,hp:m.hp,ally:m.isAlly,dominated:m.dominated,bolts:m.bolts,statuses:m.statusDurations,negated:m.wasNegated}))}));
  states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;
 };
 await page.evaluate(()=>{const g=window.activeGame,L=window.w25L;for(const cfg of L.genStaffs){const w=L.spawnStaff(cfg.id,-1,-1);g.player.inventory.addItem(w);L.detectMagicOnItem(w);}g.isInventoryOpen=true;});
 await page.locator('.item-row').first().waitFor();let s=await capture('nine-unknown-polarities');assert.equal(s.inventory.length,9);
 assert.deepEqual(await page.locator('.item-sigil').allTextContents(),['⧳','⧳','⧳','⧳','⧳','⧳','⧳','⧲','⧲']);
 await page.evaluate(()=>{const g=window.activeGame,L=window.w25L;for(const w of g.player.inventory.items)L.identifyInstance(w);});
 s=await capture('nine-identified');assert.ok(s.inventory.every(w=>w.known));
 for(const suffix of ['tunneling','blinking','entrancement']){
  await page.evaluate(async suffix=>{window.w25Setup();const g=window.activeGame,L=window.w25L;const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
   if(suffix!=='entrancement')g.monsters=[];
   if(suffix==='tunneling')for(let x=6;x<=9;x++)g.grid.setTerrain(x,5,T.WALL);
   const w=L.spawnStaff('staff_of_'+suffix,-1,-1);Object.assign(w,{enchantment:3,maxCharges:3,charges:3});g.player.inventory.addItem(w);
   window.w25Before={charges:w.charges,turns:g.stats.turns};g.isInventoryOpen=true;
  },suffix);
  await page.waitForTimeout(150);await page.locator('.item-row').first().click();await page.getByRole('button',{name:'Use',exact:true}).click();
  assert.equal(await page.evaluate(()=>!!window.activeGame.pendingArcana),true);
  await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>({charges:window.activeGame.player.inventory.items[0].charges,turns:window.activeGame.stats.turns})),await page.evaluate(()=>window.w25Before));
  await page.evaluate(()=>{const g=window.activeGame;g.useArcanaItem(g.player.inventory.items[0]);g.setArcanaTarget(g.player.inventory.items[0].identityId==='staff_of_entrancement'?8:25,5);});await capture(`${suffix}-aim`);
  await page.keyboard.press('Enter');s=await capture(`${suffix}-after`);assert.equal(s.inventory[0].charges,2);
  assert.equal(await page.evaluate(()=>window.activeGame.stats.turns),await page.evaluate(()=>window.w25Before.turns+1));
  if(suffix==='blinking')assert.equal(s.text.player.x,12);
  if(suffix==='tunneling')assert.deepEqual(await page.evaluate(async()=>{const {DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');return [6,7,8,9].map(x=>T[window.activeGame.grid.getCell(x,5).layers[L.DUNGEON]]);}),['FLOOR','FLOOR','FLOOR','WALL']);
  if(suffix==='entrancement'){assert.equal(s.monsters[0].statuses.entranced,8);await page.keyboard.press('ArrowRight');await capture('entrancement-follow');assert.equal(await page.evaluate(()=>window.w25Target.x),7);}
 }
 for(const e of [2,8]){
  await page.evaluate(e=>{window.w25Setup();const g=window.activeGame,L=window.w25L;g.monsters=[];const w=L.spawnStaff('staff_of_blinking',-1,-1);Object.assign(w,{enchantment:e,maxCharges:e,charges:e});g.player.inventory.addItem(w);L.identifyInstance(w);g.useArcanaItem(w);g.setArcanaTarget(30,5);},e);
  s=await capture(`blink-E${e}-preview`);assert.equal(s.text.arcanaPreview.maxDistance,2+2*e);assert.equal(s.text.arcanaPreview.path.length,2+2*e);
  assert.match(await page.locator('.arcana-prompt').textContent(),new RegExp(`最远 ${2+2*e} 格`));
  assert.ok(!(await page.locator('.arcana-prompt').textContent()).includes('&#'));
  await page.keyboard.press('Enter');s=await capture(`blink-E${e}-after`);assert.equal(s.text.player.x,6+2*e);
 }
 await page.evaluate(async()=>{window.w25Setup();const g=window.activeGame,L=window.w25L;const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');g.monsters=[];
  const w=L.spawnStaff('staff_of_blinking',-1,-1);Object.assign(w,{enchantment:2,maxCharges:2,charges:2});g.player.inventory.addItem(w);L.identifyInstance(w);g.grid.setTerrain(10,5,T.LAVA);g.useArcanaItem(w);g.setArcanaTarget(25,5);
 });
 await page.keyboard.press('Enter');s=await capture('blink-lethal-rejected');assert.equal(s.text.player.x,4);assert.equal(s.inventory[0].charges,2);
 await page.evaluate(()=>{const g=window.activeGame,w=g.player.inventory.items[0];w.identified=false;w.maxChargesKnown=false;g.useArcanaItem(w);g.setArcanaTarget(25,5);});
 const dialog=page.waitForEvent('dialog');const enter=page.keyboard.press('Enter');const d=await dialog;assert.match(d.message(),/射程未知/);await d.dismiss();await enter;
 s=await capture('blink-lava-cancel');assert.equal(s.inventory[0].charges,2);assert.equal(s.text.player.x,4);
 await page.evaluate(()=>{const g=window.activeGame;window.w25Saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(window.w25Saved);g.isInventoryOpen=true;});
 await capture('save-restored');assert.deepEqual(await page.evaluate(()=>window.activeGame.toSnapshot().staffFlavors),await page.evaluate(()=>window.w25Saved.staffFlavors));
 assert.deepEqual(errors,[]);
} finally {fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
