import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = 'ai_docs/reports/x3-u8b-evidence', results = [], errors = [];
const browser = await chromium.launch({headless:false});
try {
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.goto('http://127.0.0.1:5188');
 await page.locator('.menu-card input[type=text]').fill('33008');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested&&!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const {logger}=await import('/src/engine/Systems/Logger.ts');
  const {Item,ItemCategory:C}=await import('/src/engine/Items/Item.ts');
  const {rng}=await import('/src/engine/Random.ts');
  const {timeSystem}=await import('/src/engine/Systems/Time.ts');
  window.u8b={T,logger,Item,C,rng,timeSystem};
  window.u8setup=()=>{
   const g=window.activeGame;g.startNewGame({seed:33008,mode:'test'});g.animationEnabled=false;
   g.monsters=[];g.dormantMonsters=[];g.items=[];g.player.inventory.items=[];
   g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;
   g.player.loc={x:10,y:10};g.visibleMonsters.clear();g.visibleItems.clear();g.everSeenMonsters.clear();
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x>=8&&x<=18&&y>=8&&y<=12?T.FLOOR:T.GRANITE);
    const c=g.grid.getCell(x,y);Object.assign(c,{isVisible:true,isExplored:true,hasMemory:true,isMagicMapped:false,rememberedLayers:[...c.layers],rememberedItem:null});
   }
   logger.reset();g.disturbed=false;g.needsRender=true;g.update();
  };
  window.u8rings=()=>{
   window.u8setup();const g=window.activeGame;
   for(const name of ['左侧戒指','右侧戒指','替换戒指'])g.player.inventory.addItem(new Item(name,'=',0xffcc44,C.RING));
   [g.player.ringLeft,g.player.ringRight]=g.player.inventory.items;g.isInventoryOpen=true;g.needsRender=true;g.update();
  };
 });
 const shot=async name=>{await page.waitForTimeout(180);await page.screenshot({path:`${out}/${name}.png`});};
 const read=()=>page.evaluate(()=>{const g=window.activeGame,{logger,rng,timeSystem}=window.u8b;return {turn:g.absoluteTurnNumber,tick:timeSystem.currentTick,rng:rng.getState(),left:g.player.ringLeft?.name,right:g.player.ringRight?.name,pack:g.player.inventory.items.map(i=>({name:i.name,flags:i.flags})),floor:g.items.map(i=>({name:i.name,flags:i.flags})),messages:logger.messages.map(m=>m.text),text:JSON.parse(window.render_game_to_text())};});
 for(const slot of ['left','right']){
  await page.evaluate(()=>window.u8rings());await page.locator('.inventory-modal').waitFor();
  await page.locator('.item-row').filter({hasText:'替换戒指'}).click();
  await page.locator('.item-actions button').filter({hasText:/^装备$/}).click();
  await page.getByText('你已经戴着两枚戒指；先取下哪一枚？',{exact:true}).first().waitFor();
  assert.equal((await read()).turn,0);await shot(`browser-rings-${slot}-prompt`);
  await page.locator('.ring-replacement-candidate').filter({hasText:slot==='left'?'左侧戒指':'右侧戒指'}).click();
  await page.locator('.inventory-modal').waitFor({state:'hidden'});
  const s=await read();assert.equal(s[slot],'替换戒指');assert.equal(s.turn,1);results.push({scene:`replace ${slot}`,state:s});
 }
 await page.evaluate(()=>window.u8rings());await page.locator('.inventory-modal').waitFor();
 await page.locator('.item-row').filter({hasText:'替换戒指'}).click();await page.locator('.item-actions button').filter({hasText:/^装备$/}).click();
 await page.locator('.ring-replacement-candidate').first().waitFor();const before=await read();
 await page.locator('.inventory-modal .close-btn').click();await page.locator('.inventory-modal').waitFor({state:'hidden'});
 const canceled=await read();assert.equal(canceled.turn,before.turn);assert.deepEqual(canceled.rng,before.rng);assert.equal(canceled.left,'左侧戒指');results.push({scene:'cancel replacement',state:canceled});
 await page.evaluate(()=>window.u8rings());await page.locator('.inventory-modal').waitFor();
 await page.locator('.item-row').filter({hasText:'替换戒指'}).click();await page.locator('.item-actions button').filter({hasText:/^装备$/}).click();
 await page.locator('.ring-replacement-candidate').first().waitFor();
 await page.evaluate(()=>window.activeGame.executeCommand('inventory_action','drop'));
 await page.waitForFunction(()=>document.querySelectorAll('.ring-replacement-candidate').length===0);
 await page.locator('.item-row').filter({hasText:'替换戒指'}).click();await page.locator('.inventory-modal').waitFor({state:'hidden'});
 const switched=await read();assert.equal(switched.left,'左侧戒指');assert.equal(switched.right,'右侧戒指');assert.equal(switched.floor[0].name,'替换戒指');results.push({scene:'switch pending replacement to drop',state:switched});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{window.u8rings();window.activeGame.player.ringLeft.isCursed=true;});
 await page.locator('.inventory-modal').waitFor();await page.locator('.item-row').filter({hasText:'替换戒指'}).click();
 await page.locator('.item-actions button').filter({hasText:/^装备$/}).click();await shot('browser-mobile-rings');
 await page.locator('.ring-replacement-candidate').filter({hasText:'左侧戒指'}).click();await page.locator('.inventory-modal').waitFor({state:'hidden'});
 const cursed=await read();assert.equal(cursed.turn,0);assert.equal(cursed.left,'左侧戒指');assert(cursed.messages.some(m=>m.includes('诅咒')));results.push({scene:'mobile cursed replacement',state:cursed});
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{window.u8setup();const g=window.activeGame,{Item,C}=window.u8b;
  for(const [name,category]of [['重剑',C.WEAPON],['重甲',C.ARMOR]]){const i=new Item(name,category===C.WEAPON?'/':'[',0xffcc88,category);i.strengthRequired=18;g.player.inventory.addItem(i);g.executeItemCommand('equip',i);}g.needsRender=true;g.update();});
 const strength=await read();assert(strength.messages.some(m=>m.includes('几乎举不起')));assert(strength.messages.some(m=>m.includes('摇摇欲坠')));await shot('browser-strength');results.push({scene:'strength warnings',state:strength});
 await page.evaluate(()=>{window.u8setup();const g=window.activeGame,{Item,C}=window.u8b;
  const food=new Item('口粮',':',0xffcc88,C.FOOD);food.quantity=26;g.player.inventory.addItem(food);
  const loot=new Item('药水','!',0x88ffaa,C.POTION);loot.loc={x:11,y:10};g.items.push(loot);g.executeCommand('move',{x:1,y:0});g.update();});
 const full=await read();assert(full.messages.some(m=>m.includes('背包太满')));assert(full.floor[0].flags.includes('ITEM_PLAYER_AVOIDS'));await shot('browser-full-pack');results.push({scene:'full pack',state:full});
 await page.evaluate(()=>{window.u8setup();const g=window.activeGame,{Item,C}=window.u8b;
  const food=new Item('口粮',':',0xffcc88,C.FOOD);g.player.inventory.addItem(food);g.executeItemCommand('drop',food);g.executeCommand('move',{x:1,y:0});g.executeCommand('auto_explore');g.update();});
 const drop=await read();assert(drop.floor[0].flags.includes('ITEM_PLAYER_AVOIDS'));assert.equal(drop.pack.length,0);await shot('browser-drop-explore');results.push({scene:'drop then explore',state:drop});
 await page.evaluate(()=>{window.u8setup();const g=window.activeGame,{Item,C,T}=window.u8b;
  const food=new Item('口粮',':',0xffcc88,C.FOOD);g.player.inventory.addItem(food);g.grid.setTerrain(10,10,T.GRANITE);g.executeItemCommand('drop',food);g.update();});
 const obstructed=await read();assert.equal(obstructed.turn,0);assert.equal(obstructed.pack.length,1);assert(obstructed.messages.includes('那里已经有东西了。'));await shot('browser-drop-refused');results.push({scene:'drop obstruction',state:obstructed});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2)+'\n');
 console.log(JSON.stringify({scenes:results.length,errors},null,2));
} finally {await browser.close();}
