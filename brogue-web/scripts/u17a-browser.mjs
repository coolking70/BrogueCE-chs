import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='ai_docs/reports/u-17a-evidence',errors=[],results=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5198');
 await page.locator('.menu-card input[type=text]').fill('1717');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const snap=async name=>{await page.waitForTimeout(200);await page.screenshot({path:`${out}/browser-${name}.png`});results.push({name,state:JSON.parse(await page.evaluate(()=>window.render_game_to_text()))});};
 await snap('natural');
 const stairs=await page.evaluate(()=>{
  const g=window.activeGame;g.animationEnabled=false;g.monsters=[];
  const to={...g.levelSeeds[0].downStairsLoc};
  const from=[[0,-1],[0,1],[-1,0],[1,0]].map(([dx,dy])=>({x:to.x+dx,y:to.y+dy})).find(p=>g.canMoveTo(p.x,p.y));
  if(!from)throw Error('stairs have no accessible neighbor');g.player.loc=from;
  g.handlePlayerAction('move',{x:to.x-from.x,y:to.y-from.y},'system');g.update();return{depth:g.depth,loc:g.player.loc};
 });assert.equal(stairs.depth,2);results.push({stairs});await snap('stairs-d2');
 async function scene(){await page.evaluate(async()=>{
  const g=window.activeGame;g.startNewGame({seed:1717,mode:'test'});g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];g.items=[];
  const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++)g.grid.setTerrain(x,y,T.FLOOR);
  g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.bindDormantAwakener();g.updateVision();g.update();g.onRenderRequested();
 });}
 await scene();
 const obstruction=await page.evaluate(async()=>{
  const g=window.activeGame;const {spawnObstruction}=await import('/src/engine/Map/Promotion.ts');
  const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');
  const result=spawnObstruction(g.grid,10,10,2,p=>p.x===g.player.x&&p.y===g.player.y);g.updateVision();g.update();g.onRenderRequested();
  return{built:result.builtCells.length,playerSurface:g.grid.getCell(g.player.x,g.player.y).layers[L.SURFACE],nothing:T.NOTHING,loc:{...g.player.loc}};
 });assert.equal(obstruction.playerSurface,obstruction.nothing);assert(obstruction.built>1);assert.deepEqual(obstruction.loc,{x:10,y:10});results.push({obstruction});await snap('obstruction');
 await scene();
 const evacuation=await page.evaluate(async()=>{
  const g=window.activeGame;const {spawnDungeonFeature,catalogFeature}=await import('/src/engine/Map/DungeonFeature.ts');const {DF}=await import('/src/engine/Map/DungeonFeatureCatalog.ts');
  spawnDungeonFeature(g.grid,10,10,catalogFeature(DF.DF_REPEL_CREATURES),false);g.updateVision();g.update();g.onRenderRequested();return{loc:g.player.loc};
 });assert.notDeepEqual(evacuation.loc,{x:10,y:10});results.push({evacuation});await snap('evacuation');
 await scene();
 const fire=await page.evaluate(async()=>{
  const g=window.activeGame;g.player.loc={x:8,y:10};
  const {Monster}=await import('/src/entities/Monster.ts');const {default:rows}=await import('/src/data/monsters.json');const {Item,ItemCategory}=await import('/src/engine/Items/Item.ts');
  const {spawnDungeonFeature,catalogFeature}=await import('/src/engine/Map/DungeonFeature.ts');const {DF}=await import('/src/engine/Map/DungeonFeatureCatalog.ts');
  const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');
  const m=new Monster(14,10,rows.find(m=>m.id==='rat'));m.hp=m.maxHp=100;g.monsters.push(m);
  const scroll=new Item('卷轴','?',0xffffff,ItemCategory.SCROLL);scroll.loc={x:14,y:10};g.items.push(scroll);g.updateVision();
  spawnDungeonFeature(g.grid,14,10,catalogFeature(DF.DF_BLOAT_EXPLOSION),false);g.updateVision();g.update();g.onRenderRequested();
  return{hp:m.hp,burning:g.burningDuration(m),items:g.items.length,pendingFlares:g.activeFlares.length,itemFire:g.grid.getCell(14,10).layers[L.SURFACE]===T.ITEM_FIRE};
 });assert.equal(fire.hp,50);assert(fire.burning>0);assert.equal(fire.items,0);assert.equal(fire.itemFire,true);results.push({fire});await snap('instant-fire');
 await scene();
 const alarm=await page.evaluate(async()=>{
  const g=window.activeGame;const {Monster,MonsterState}=await import('/src/entities/Monster.ts');const {default:rows}=await import('/src/data/monsters.json');
  const {spawnDungeonFeature,catalogFeature}=await import('/src/engine/Map/DungeonFeature.ts');const {DF,DFF_AGGRAVATES_MONSTERS}=await import('/src/engine/Map/DungeonFeatureCatalog.ts');const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const m=new Monster(14,10,rows.find(m=>m.id==='rat'));m.state=MonsterState.ASLEEP;g.monsters.push(m);g.updateVision();
  window.u17TickFlare=g.tickFlareAnimation.bind(g);g.tickFlareAnimation=()=>false;
  spawnDungeonFeature(g.grid,10,10,{...catalogFeature(DF.DF_REPEL_CREATURES),flags:DFF_AGGRAVATES_MONSTERS,tile:T.NOTHING,effectRadius:6,flashColor:'darkBlue'},false);
  g.update();g.onRenderRequested();return{state:m.state,hunting:MonsterState.HUNTING,status:g.player.getStatusDuration('aggravating'),flash:g.terrainFlashAt(10,10),scent:g.scent.get(14,10)};
 });assert.equal(alarm.state,alarm.hunting);assert.equal(alarm.status,6);assert(alarm.flash.b>0);results.push({alarm});await snap('alarm-flash');
 await page.evaluate(()=>{const g=window.activeGame;g.tickFlareAnimation=window.u17TickFlare;g.tickFlareAnimation(1000);g.onRenderRequested();});await snap('flash-cleared');
 await page.setViewportSize({width:700,height:900});await snap('narrow');
 await scene();
 const lethal=await page.evaluate(async()=>{
  const g=window.activeGame;g.player.loc={x:4,y:5};g.player.hp=1;
  const {spawnDungeonFeature,catalogFeature}=await import('/src/engine/Map/DungeonFeature.ts');const {DF}=await import('/src/engine/Map/DungeonFeatureCatalog.ts');
  const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');
  g.grid.setTerrainLayer(4,5,L.GAS,T.CONFUSION_GAS);
  spawnDungeonFeature(g.grid,5,5,{...catalogFeature(DF.DF_BLOAT_EXPLOSION),startProbability:100,probabilityDecrement:100,subsequentDF:DF.DF_EMBERS},false);
  g.update();g.onRenderRequested();return{gameOver:g.isGameOver,hp:g.player.hp,confused:g.player.hasStatus('confused'),later:g.grid.getCell(6,5).layers[L.SURFACE],nothing:T.NOTHING};
 });assert(lethal.gameOver);assert(lethal.hp<=0);assert.equal(lethal.confused,false);assert.equal(lethal.later,lethal.nothing);results.push({lethal});await snap('lethal-contact');
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/browser.json`,JSON.stringify({results,errors},null,2));
}finally{await browser.close();}
