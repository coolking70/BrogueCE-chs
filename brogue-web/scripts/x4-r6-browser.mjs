import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='output/x4-r6/browser',summary='ai_docs/reports/x4-r6-evidence/browser.json';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});const errors=[],results=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.goto('http://127.0.0.1:5196');await page.locator('.menu-card input[type=text]').fill('424242');
 await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.grid);
 await page.evaluate(async()=>{
  const [{TerrainType:T,DungeonLayer:L},{ItemLoader:Items},{Monster,MonsterState},{default:species},{logger},{rng},{generateItemDetail},{createItemDetailContext},{getTerrainDescription,tileFlavor}]=await Promise.all([
   import('/src/engine/Map/Grid.ts'),import('/src/engine/Items/ItemLoader.ts'),import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Systems/Logger.ts'),import('/src/engine/Random.ts'),import('/src/engine/UI/DetailGenerator.ts'),import('/src/engine/UI/ItemDetailContext.ts'),import('/src/engine/UI/TerrainTextCatalog.ts')]);
  window.r6={T,L,Items,Monster,MonsterState,species,logger,rng,generateItemDetail,createItemDetailContext,getTerrainDescription,tileFlavor};
  window.render_game_to_text=()=>JSON.stringify({mode:'playing',depth:window.activeGame.depth,turn:window.activeGame.absoluteTurnNumber,
   coordinates:'origin top-left; x right, y down',player:{...window.activeGame.player.loc,hp:window.activeGame.player.hp,maxHp:window.activeGame.player.maxHp},flavor:window.activeGame.flavorText,hover:window.activeGame.hoveredText});
  window.r6room=()=>{
   const g=window.activeGame;g.startNewGame({seed:46006,mode:'test'});g.animationEnabled=false;
   g.monsters=[];g.dormantMonsters=[];g.purgatory=[];g.items=[];g.player.inventory.items=[];g.player.equippedArmor=null;g.player.equippedWeapon=null;
   g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.regenCarry=-100;
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    const c=g.grid.getCell(x,y);c.layers=[x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR,T.NOTHING,T.NOTHING,T.NOTHING];c.refreshTerrainProperties();c.volume=0;c.machineNumber=0;c.hasDormantMonster=false;
   }
   g.updateVision();logger.reset();g.disturbed=true;g.needsRender=true;g.update();
  };
 });
 const shot=async name=>{await page.waitForTimeout(180);await page.screenshot({path:`${out}/${name}.png`});fs.writeFileSync(`${out}/${name}.state.json`,await page.evaluate(()=>window.render_game_to_text()));};
 // Natural CE58 map retained. Injured player and delayed actors are preconditions.
 const natural=await page.evaluate(()=>{
  const g=window.activeGame,{T}=window.r6;g.animationEnabled=false;const cells=[];
  for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)cells.push(g.grid.getCell(x,y));
  const pod=cells.find(c=>c.layers.includes(T.BLOODFLOWER_POD)&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>g.grid.getCell(c.x+dx,c.y+dy)?.isPassable));
  if(!pod)throw Error('seed 424242 has no natural bloodwort');
  const near=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>g.grid.getCell(pod.x+dx,pod.y+dy)).find(c=>c?.isPassable&&!c.isBurning);
  g.player.loc={x:near.x,y:near.y};g.player.maxHp=44;g.player.hp=10;g.player.regenCarry=-100;for(const m of g.monsters)m.ticksUntilTurn=100000;
  g.updateVision();window.r6move={x:pod.x-near.x,y:pod.y-near.y};window.r6pod={x:pod.x,y:pod.y};g.needsRender=true;g.update();
  return {seed:424242,pod:window.r6pod,near:g.player.loc,hp:g.player.hp,layers:[...pod.layers]};
 });
 await shot('01-natural-pod-before');
 const keyFor=({x,y})=>x===1?'ArrowRight':x===-1?'ArrowLeft':y===1?'ArrowDown':'ArrowUp';const key=keyFor(await page.evaluate(()=>window.r6move));
 await page.keyboard.press(key);await page.waitForTimeout(160);
 const burst=await page.evaluate(()=>({loc:{...window.activeGame.player.loc},layers:[...window.activeGame.grid.getCell(window.r6pod.x,window.r6pod.y).layers],hp:window.activeGame.player.hp}));
 assert.deepEqual(burst.loc,natural.near);assert(!burst.layers.includes(await page.evaluate(()=>window.r6.T.BLOODFLOWER_POD)));
 await page.keyboard.press(key);await page.waitForTimeout(160);
 const healing=await page.evaluate(()=>{const g=window.activeGame;return {loc:{...g.player.loc},hp:g.player.hp,messages:window.r6.logger.messages.map(m=>m.text),snapshot:JSON.parse(JSON.stringify(g.toSnapshot()))};});
 assert.deepEqual(healing.loc,natural.pod);assert.equal(healing.hp-burst.hp,2);assert(healing.messages.includes('你感觉好多了。'));await shot('02-natural-healing');
 const save=await page.evaluate(saved=>{const g=window.activeGame,{rng}=window.r6,before=JSON.stringify(rng.getState());if(!g.loadSnapshot(saved))throw Error('load failed');const after=JSON.stringify(rng.getState());return {hp:g.player.hp,rngSame:before===after,layers:[...g.grid.getCell(g.player.x,g.player.y).layers]};},healing.snapshot);
 assert.equal(save.hp,healing.hp);assert(save.rngSame);results.push({scene:'natural bloodwort keyboard bump/entry and JSON save-load',natural,burst,healing:{...healing,snapshot:undefined},save});
 // Capture the actual ephemeral DF inside the real turn boundary; call through.
 for(const hit of [false,true]){
  const result=await page.evaluate(hit=>{
   window.r6room();const g=window.activeGame,{T,L,Items,Monster,species,logger}=window.r6;
   const m=hit?new Monster(13,10,species.find(s=>s.id==='goblin')):null;if(m){m.hp=m.maxHp=100;m.ticksUntilTurn=100000;g.monsters.push(m);}
   const dart=Items.spawnWeapon('incendiary_dart',-1,-1);dart.quantity=3;g.player.inventory.addItem(dart);
   const end=g.playerTurnEnded;let impact;
   g.playerTurnEnded=function(...args){impact={layers:[...g.grid.getCell(13,10).layers],quantity:dart.quantity,monsterHp:m?.hp,burning:m?.statusDurations.burning};return end.apply(this,args);};
   try{g.executeItemCommand('throw',dart);g.executeCommand('mouse_travel',{x:13,y:10});}finally{g.playerTurnEnded=end;}
   g.update();return {hit,impact,dartExplosion:T.DART_EXPLOSION,remaining:dart.quantity,drops:g.items.filter(i=>i.identityId==='incendiary_dart'||i.identityId==='dart').length,burning:m?.statusDurations.burning,messages:logger.messages.map(m=>m.text)};
  },hit);
  assert(result.impact.layers.includes(result.dartExplosion));assert.equal(result.remaining,2);assert.equal(result.drops,0);if(hit){assert.equal(result.impact.monsterHp,100);assert(result.burning>0);}
  results.push({scene:`real incendiary throw: ${hit?'monster':'ground'}`,...result});await shot(hit?'04-dart-monster':'03-dart-ground');
 }
 const terrain=await page.evaluate(()=>{
  window.r6room();const g=window.activeGame,{T,L,getTerrainDescription,tileFlavor}=window.r6,results=[];
  for(const [i,tile] of [T.PLAIN_FIRE,T.POISON_GAS,T.HOLE,T.FORCEFIELD,T.ANCIENT_SPIRIT_VINES,T.ANCIENT_SPIRIT_GRASS].entries()){
   const x=11+i;g.grid.setTerrain(x,10,tile);g.grid.getCell(x,10).isVisible=true;g.updateHover(x,10);results.push({tile:T[tile],expected:getTerrainDescription(tile),actual:g.hoveredText});
  }
  g.player.loc={x:12,y:10};g.updateVision();g.disturbed=true;g.updateFlavorText();g.updateHover(14,10);g.needsRender=true;g.update();
  return {rows:results,flavor:g.flavorText,expectedFlavor:tileFlavor(g.grid.getCell(12,10).layers)};
 });
 for(const r of terrain.rows){assert(r.actual.includes(r.expected));assert.notEqual(r.actual,'地面');}assert.equal(terrain.flavor,terrain.expectedFlavor);results.push({scene:'actual hover/standing text',...terrain});await shot('05-terrain-text');
 // Real keyboard inspect and actual inventory button, with identical public context.
 await page.evaluate(()=>{
  window.r6room();const g=window.activeGame,{Items}=window.r6;const item=Items.spawnStaff('staff_of_haste',11,10);item.identified=true;item.enchantment=3;item.maxCharges=3;item.knownStaffUses=[0];Items.identify('staff_of_haste');g.items.push(item);g.updateVision();g.grid.getCell(11,10).isVisible=true;window.r6item=item;
 });
 await page.keyboard.press('Tab');await page.waitForTimeout(180);
 const keyboard=await page.evaluate(()=>window.activeGame.inspectTarget);assert(keyboard);assert(JSON.stringify(keyboard).includes('加速'));await shot('06-keyboard-detail');
 await page.keyboard.press('Tab');await page.waitForTimeout(180);assert.equal(await page.locator('.detail-overlay').count(),0);
 await page.keyboard.press('Tab');await page.waitForTimeout(180);assert.equal(await page.locator('.detail-overlay').count(),1);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{const g=window.activeGame;g.inspectTarget=null;g.handleInspectAt(11,10);window.r6location=JSON.parse(JSON.stringify(g.inspectTarget));g.inspectTarget=null;g.items=[];g.player.inventory.addItem(window.r6item);g.isInventoryOpen=true;});
 await page.waitForTimeout(180);await page.locator('.item-row').first().click();await page.getByRole('button',{name:'查看详情',exact:true}).first().click();await page.waitForTimeout(180);
 const inventory=await page.evaluate(()=>({detail:window.activeGame.inspectTarget,location:window.r6location,expected:window.r6.generateItemDetail(window.r6item,window.r6.createItemDetailContext(window.activeGame,window.r6item))}));
 assert.deepEqual(keyboard,inventory.location);assert.deepEqual(inventory.detail,inventory.expected);results.push({scene:'keyboard/location/inventory detail',keyboard,inventory});await shot('07-inventory-detail');
 const replayBefore=await page.evaluate(()=>{
  const g=window.activeGame;g.startNewGame({seed:424242});g.animationEnabled=false;g.executeCommand('wait');g.executeCommand('wait');
  g.loadReplay(g.exportRecording());window.r6replayBefore={knowledge:[...window.r6.Items.identifiedItems],rng:window.r6.rng.getState(),turn:g.absoluteTurnNumber};
  return window.r6replayBefore;
 });
 await page.getByLabel('全知物品详情',{exact:true}).check();
 const replay=await page.evaluate(()=>{
  const g=window.activeGame,immediate={knowledge:[...window.r6.Items.identifiedItems],rng:window.r6.rng.getState(),turn:g.absoluteTurnNumber};
  const enabled=g.replayOmniscientDetails;g.replaySeek(g.replayEvents.length);
  return {immediate,enabled,retained:g.replayOmniscientDetails,error:g.replayError,cursor:g.replayCursor,total:g.replayEvents.length};
 });
 assert.deepEqual(replay.immediate,replayBefore);assert(replay.enabled&&replay.retained);assert.equal(replay.error,null);assert.equal(replay.cursor,replay.total);
 results.push({scene:'explicit read-only replay omniscience and seek',...replay});await shot('08-replay-details-toggle');
 fs.writeFileSync(summary,JSON.stringify({results,errors,screenshots:out},null,2)+'\n');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({scenes:results.length,errors:errors.length,summary}));
}finally{fs.writeFileSync(`${out}/partial-results.json`,JSON.stringify({results,errors},null,2)+'\n');await browser.close();}
