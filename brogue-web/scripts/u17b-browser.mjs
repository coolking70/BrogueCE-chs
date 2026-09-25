import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-17b-evidence',errors=[],results=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('dialog',dialog=>dialog.accept());
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('1718');await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const snap=async name=>{await page.waitForTimeout(160);await page.screenshot({path:`${out}/browser-${name}.png`});results.push({name,state:JSON.parse(await page.evaluate(()=>window.render_game_to_text()))});};
 await snap('natural');
 async function scene(){await page.evaluate(async()=>{
  const g=window.activeGame;g.startNewGame({seed:1718,mode:'test'});g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];g.items=[];
  const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){
   const c=g.grid.getCell(x,y);c.layers=[T.FLOOR,T.NOTHING,T.NOTHING,T.NOTHING];c.volume=0;c.machineNumber=0;c.isPassable=true;c.isOpaque=false;
  }
  g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.bindDormantAwakener();g.updateVision();g.update();g.onRenderRequested();
 });}
 await scene();await page.evaluate(async()=>{const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;for(let x=11;x<=15;x++)for(let y=9;y<=11;y++)g.grid.setTerrainLayer(x,y,L.SURFACE,T.FOLIAGE);g.updateVision();g.update();});await snap('foliage-before');
 await page.keyboard.press('ArrowRight');
 const trampled=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;return{loc:{...g.player.loc},tile:g.grid.getCell(11,10).layers[3],expected:T.TRAMPLED_FOLIAGE,opaque:g.grid.getCell(11,10).isOpaque};});assert.equal(trampled.tile,trampled.expected);assert.equal(trampled.opaque,false);results.push({trampled});await snap('foliage-trampled');
 await page.keyboard.press('ArrowLeft');await snap('foliage-cleared');
 const regrowth=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;let turns=0;for(;turns<1500&&g.grid.getCell(11,10).layers[3]!==T.FOLIAGE;turns++)g.handlePlayerAction('wait',undefined,'system');g.update();return{turns,tile:g.grid.getCell(11,10).layers[3],expected:T.FOLIAGE};});assert.equal(regrowth.tile,regrowth.expected);results.push({regrowth});await snap('foliage-regrown');
 await scene();await page.evaluate(async()=>{const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;g.grid.setTerrainLayer(13,10,L.LIQUID,T.INERT_BRIMSTONE);g.updateVision();g.update();});
 const activation=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;let turns=0;for(;turns<150&&g.grid.getCell(13,10).layers[1]!==T.ACTIVE_BRIMSTONE;turns++)g.handlePlayerAction('wait',undefined,'system');g.update();return{turns,tile:g.grid.getCell(13,10).layers[1],expected:T.ACTIVE_BRIMSTONE};});assert.equal(activation.tile,activation.expected);results.push({activation});await snap('brimstone-active');
 async function aim(x,y){await page.evaluate(async({x,y})=>{
  const g=window.activeGame;const {Item,ItemCategory}=await import('/src/engine/Items/Item.ts');const i=new Item('火焰法杖','/',0xff6600,ItemCategory.STAFF);
  Object.assign(i,{identityId:'staff_of_fire',enchantment:2,charges:2,maxCharges:2,identified:true,arcanaInstanceVersion:1});g.player.inventory.addItem(i);window.u17bStaff=i;g.useArcanaItem(i);g.setArcanaTarget(x,y);g.update();
 },{x,y});}
 await aim(13,10);await snap('brimstone-aim');await page.keyboard.press('Enter');
 const sulfur=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;return{tile:g.grid.getCell(13,10).layers[1],expected:T.INERT_BRIMSTONE,fire:g.grid.getCell(13,10).layers[3],fireExpected:T.BRIMSTONE_FIRE,charges:window.u17bStaff.charges};});assert.equal(sulfur.tile,sulfur.expected);assert.equal(sulfur.fire,sulfur.fireExpected);assert.equal(sulfur.charges,1);results.push({sulfur});await snap('sulfur-fire');
 await scene();await page.evaluate(async()=>{const g=window.activeGame;const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const {Item,ItemCategory}=await import('/src/engine/Items/Item.ts');g.grid.setTerrain(11,10,T.LOCKED_DOOR);const i=new Item('铁钥匙','k',0xffff99,ItemCategory.KEY);i.originDepth=g.depth;i.keyLoc=[{loc:{x:11,y:10},machine:0,disposableHere:true}];g.player.inventory.addItem(i);window.u17bKey=i;g.updateVision();g.update();});await snap('iron-door-locked');
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 const iron=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;return{loc:{...g.player.loc},tile:g.grid.getCell(11,10).layers[0],expected:T.OPEN_IRON_DOOR_INERT,consumed:!g.player.inventory.items.includes(window.u17bKey)};});assert.deepEqual(iron.loc,{x:11,y:10});assert.equal(iron.tile,iron.expected);assert.equal(iron.consumed,true);results.push({iron});await page.keyboard.press('ArrowRight');await snap('iron-door-open');
 await scene();await page.evaluate(async()=>{
  const g=window.activeGame;const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');const {Item,ItemCategory}=await import('/src/engine/Items/Item.ts');const {Monster}=await import('/src/entities/Monster.ts');const {default:rows}=await import('/src/data/monsters.json');
  for(let x=11;x<=18;x++)g.grid.setTerrainLayer(x,10,L.LIQUID,T.BRIDGE);g.player.loc={x:11,y:7};
  const i=new Item('长剑',')',0xffffff,ItemCategory.WEAPON);i.loc={x:15,y:10};g.items.push(i);window.u17bFallenItem=i;
  const m=new Monster(14,10,rows.find(m=>m.id==='rat'));m.hp=m.maxHp=100;m.applyStatus('paralyzed',100);g.monsters.push(m);window.u17bFallenMonster=m;g.updateVision();g.update();
 });await snap('bridge-before');await aim(11,10);await page.keyboard.press('Enter');await snap('bridge-collapsing');
 for(let n=0;n<9;n++)await page.keyboard.press('.');
 const bridge=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;return{tiles:Array.from({length:8},(_,i)=>g.grid.getCell(i+11,10).layers[1]),expected:T.CHASM,itemQueued:g.pendingFallenItemsByDepth.get(2)?.some(i=>i.id===window.u17bFallenItem.id),monsterQueued:g.pendingFallenByDepth.get(2)?.some(m=>m.id===window.u17bFallenMonster.id)};});assert(bridge.tiles.every(t=>t===bridge.expected));assert.equal(bridge.itemQueued,true);assert.equal(bridge.monsterQueued,true);results.push({bridge});await snap('bridge-fallen');
 await page.setViewportSize({width:700,height:900});await snap('narrow');
 await page.setViewportSize({width:1280,height:900});
 const checkpoint=await page.evaluate(()=>{const g=window.activeGame,s=JSON.parse(JSON.stringify(g.toSnapshot()));const ok=g.loadSnapshot(s);g.mode='normal';g.player.loc={x:11,y:9};g.updateVision();g.update();return{ok,queued:g.pendingFallenItemsByDepth.get(2).map(i=>i.id)};});assert(checkpoint.ok);results.push({checkpoint});
 await page.keyboard.press('ArrowDown');
 const landed=await page.evaluate(()=>{const g=window.activeGame;return{depth:g.depth,items:g.items.filter(i=>i.id===window.u17bFallenItem.id).map(i=>({id:i.id,loc:{...i.loc},spawnTurnNumber:i.spawnTurnNumber})),queue:g.pendingFallenItemsByDepth.has(2)};});assert.equal(landed.depth,2);assert.equal(landed.items.length,1);assert.equal(landed.queue,false);results.push({landed});await snap('fallen-items-d2');
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2)+'\n');console.log('Browser carrier scenarios passed');
}finally{await browser.close();}
