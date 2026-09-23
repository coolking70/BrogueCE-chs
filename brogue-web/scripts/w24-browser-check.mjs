import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/w-24-evidence', browser = await chromium.launch({headless:false});
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
  window.w24L=L;const g=window.activeGame;g.startNewGame({seed:2424,mode:'test'});g.animationEnabled=false;
  window.w24Setup=(id='rat')=>{
   rng.seedRandomGenerator(2424);L.initConsumables();g.grid=new Grid(g.grid.width,g.grid.height);
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x>0&&x<18&&y>0&&y<12?T.FLOOR:T.GRANITE);Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true,isDiscovered:true});
   }
   g.environment=new EnvironmentManager(g.grid);g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);
   g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.poisonAmount=0;
   g.player.ticksUntilTurn=0;g.player.refreshSpeeds();g.ticksTillUpdateEnvironment=100;
   g.player.inventory.items=[];g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;
   g.isInventoryOpen=false;g.inspectTarget=null;g.pendingArcana=null;g.dormantMonsters=[];g.items=[];
   g.pendingBoltFrames=[];g.floatingTexts=[];g.autoPath=[];g.isMouseTraveling=false;g.levels.clear();
   const m=new Monster(8,5,data.find(d=>d.id===id));m.state=MonsterState.HUNTING;m.ticksUntilTurn=100000;g.monsters=[m];window.w24Target=m;
   g.updateVision();g.needsRender=true;g.update();
  };window.w24Setup();
 });
 const capture=async name=>{
  await page.evaluate(()=>{const g=window.activeGame;g.needsRender=true;g.update();});await page.waitForTimeout(250);
  const state=await page.evaluate(()=>({text:JSON.parse(window.render_game_to_text()),
   inventory:window.activeGame.player.inventory.items.map(w=>({id:w.identityId,display:w.displayName,charges:w.charges,known:window.w24L.identifiedItems.has(w.identityId)})),
   monsters:window.activeGame.monsters.map(m=>({id:m.typeId,hp:m.hp,ally:m.isAlly,dominated:m.dominated,bolts:m.bolts,statuses:m.statusDurations,negated:m.wasNegated}))}));
  states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;
 };
 await page.evaluate(()=>{const g=window.activeGame,L=window.w24L;for(const cfg of L.genWands){const w=L.spawnWand(cfg.id,-1,-1);g.player.inventory.addItem(w);L.detectMagicOnItem(w);}g.isInventoryOpen=true;});
 await page.locator('.item-row').first().waitFor();let s=await capture('nine-unknown-polarities');assert.equal(s.inventory.length,9);
 assert.deepEqual(await page.locator('.item-sigil').allTextContents(),['⧳','⧳','⧳','⧳','⧳','⧳','⧲','⧲','⧲']);
 await page.evaluate(()=>{const g=window.activeGame,L=window.w24L;for(const w of g.player.inventory.items)L.identifyInstance(w);});
 s=await capture('nine-identified');assert.ok(s.inventory.every(w=>w.known));
 for(const [suffix,type] of [['polymorphism','rat'],['negation','dar_priestess'],['domination','rat'],['plenty','rat']]){
  await page.evaluate(({suffix,type})=>{window.w24Setup(type);const g=window.activeGame,m=window.w24Target,L=window.w24L;
   if(suffix==='domination')m.hp=1;if(suffix==='plenty'){m.isAlly=true;m.hp=5;}
   const w=L.spawnWand('wand_of_'+suffix,-1,-1);g.player.inventory.addItem(w);window.w24Before={charges:w.charges,turns:g.stats.turns};g.isInventoryOpen=true;
  },{suffix,type});
  await page.waitForTimeout(150);await page.locator('.item-row').first().click();await page.getByRole('button',{name:'Use',exact:true}).click();
  assert.equal(await page.evaluate(()=>!!window.activeGame.pendingArcana),true);
  await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>({charges:window.activeGame.player.inventory.items[0].charges,turns:window.activeGame.stats.turns})),await page.evaluate(()=>window.w24Before));
  await page.evaluate(()=>{const g=window.activeGame;g.useArcanaItem(g.player.inventory.items[0]);g.setArcanaTarget(8,5);});await capture(`${suffix}-aim`);
  await page.keyboard.press('Enter');s=await capture(`${suffix}-after`);
  assert.equal(s.inventory[0].charges,await page.evaluate(()=>window.w24Before.charges-1));
  if(suffix==='polymorphism')assert.notEqual(s.monsters[0].id,'rat');
  if(suffix==='negation'){assert.deepEqual(s.monsters[0].bolts,[]);assert.equal(s.monsters[0].negated,true);}
  if(suffix==='domination')assert.ok(s.monsters[0].ally&&s.monsters[0].dominated);
  if(suffix==='plenty')assert.deepEqual(s.monsters.map(m=>m.hp),[3,3]);
 }
 await page.evaluate(()=>{const g=window.activeGame;window.w24Saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(window.w24Saved);g.isInventoryOpen=true;});
 await capture('save-restored');assert.deepEqual(await page.evaluate(()=>window.activeGame.toSnapshot().wandFlavors),await page.evaluate(()=>window.w24Saved.wandFlavors));
 assert.deepEqual(errors,[]);
} finally {fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');await browser.close();}
