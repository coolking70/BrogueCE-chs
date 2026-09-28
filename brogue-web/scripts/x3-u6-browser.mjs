import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='ai_docs/reports/x3-u6-evidence', results=[], errors=[];
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('https://fonts.googleapis.com/**', route=>route.fulfill({status:200,contentType:'text/css',body:''}));
 await page.goto('http://127.0.0.1:5178');
 await page.locator('.menu-card input[type=text]').fill('33006');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested&&!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const {logger}=await import('/src/engine/Systems/Logger.ts');
  const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');
  const {rng}=await import('/src/engine/Random.ts');
  window.u6setup=()=>{
   const g=window.activeGame;g.startNewGame({seed:33006,mode:'test'});g.animationEnabled=false;
   g.monsters=[];g.dormantMonsters=[];g.items=[];g.player.statusDurations={};g.player.maxStatus={};
   g.player.inventory.items=[];g.player.equippedWeapon=null;g.player.equippedArmor=null;g.player.refreshSpeeds();
   g.player.loc={x:10,y:10};g.visibleMonsters.clear();g.visibleItems.clear();g.everSeenMonsters.clear();
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
    g.grid.setTerrain(x,y,x>=4&&x<=30&&y>=4&&y<=20?T.FLOOR:T.GRANITE);
    const c=g.grid.getCell(x,y);Object.assign(c,{isVisible:true,isExplored:true,hasMemory:true,isMagicMapped:false,autoSearched:true,rememberedLayers:[...c.layers],rememberedItem:null});
   }
   logger.reset();g.disturbed=false;g.updateVision();g.needsRender=true;g.update();
  };
  window.u6read=()=>({player:{...window.activeGame.player.loc},turn:window.activeGame.stats.turns,
   events:window.activeGame.recordedInputEvents,log:logger.getState(),rng:rng.getState().streams[0],
   rngCount:rng.randomNumbersGenerated,path:window.activeGame.autoPath});
  window.u6tools={T,logger,ItemLoader};
 });
 const read=()=>page.evaluate(()=>window.u6read());
 const modal=page.locator('.message-ack');
 await page.evaluate(()=>{window.u6setup();window.activeGame.logHungerTransition('weak');});
 await modal.waitFor();let before=await read();
 assert.match(await modal.innerText(),/没有食物/);
 assert.equal(await page.evaluate(()=>JSON.parse(window.render_game_to_text()).acknowledgment),before.log.messages.at(-1).text);
 await page.screenshot({path:`${out}/browser-desktop-warning.png`});
 await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowRight');await page.keyboard.up('ArrowRight');
 await modal.waitFor({state:'hidden'});assert.deepEqual(await read(),before);
 await page.keyboard.press('ArrowRight');assert.equal((await read()).player.x,before.player.x+1);
 results.push({scene:'desktop key acknowledgment, held-repeat and next move',before,after:await read()});
 await page.evaluate(()=>{window.u6setup();window.activeGame.logHungerTransition('weak');window.activeGame.logHungerTransition('faint');});
 await modal.waitFor();before=await read();await page.keyboard.press('Space');
 await page.waitForFunction(()=>document.querySelector('#ack-message')?.textContent?.includes('昏'));
 await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.deepEqual(await read(),before);
 results.push({scene:'two queued warnings, Space then Escape, no commands',state:before});
 await page.evaluate(()=>{
  window.u6setup();const g=window.activeGame,{T}=window.u6tools;
  for(let x=11;x<20;x++)for(let y=4;y<=20;y++){g.grid.setTerrain(x,y,T.WATER_DEEP);const c=g.grid.getCell(x,y);c.rememberedLayers=[...c.layers];}
  g.player.setStatusDuration('levitating',4);g.executeCommand('mouse_travel',{x:13,y:10});
 });
 await modal.waitFor();await page.waitForFunction(()=>window.activeGame.autoPath.length===0);
 before=await read();assert.equal(before.turn,2);assert.equal(before.player.x,12);assert.equal(before.path.length,0);
 await page.screenshot({path:`${out}/browser-auto-shore.png`});
 await page.waitForTimeout(200);assert.deepEqual(await read(),before);await modal.locator('button').click();
 await modal.waitFor({state:'hidden'});assert.deepEqual(await read(),before);
 results.push({scene:'automatic travel stops at shore warning and stays stopped after click',state:before});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{window.u6setup();const g=window.activeGame,{T}=window.u6tools;
  for(let x=9;x<=11;x++)for(let y=9;y<=11;y++)g.grid.setTerrain(x,y,T.CHASM);
  g.player.setStatusDuration('levitating',1);g.checkShoreWarning();g.needsRender=true;g.update();
 });
 await modal.waitFor();assert.match(await modal.innerText(),/来不及/);before=await read();
 await page.screenshot({path:`${out}/browser-mobile-warning.png`});
 const box=await modal.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
 await modal.locator('button').click();await modal.waitFor({state:'hidden'});assert.deepEqual(await read(),before);
 await page.screenshot({path:`${out}/browser-mobile-history.png`});
 results.push({scene:'mobile point-of-no-return warning, click, persistent strip highlight',state:before});
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{window.u6setup();const g=window.activeGame,{ItemLoader}=window.u6tools;
  const scroll=ItemLoader.spawnScroll('scroll_of_identify',-1,-1),potion=ItemLoader.spawnPotion('potion_of_strength',-1,-1);
  g.player.inventory.addItem(scroll);g.player.inventory.addItem(potion);g.executeItemCommand('read',scroll);
 });
 await modal.waitFor();before=await read();assert.match(await modal.innerText(),/鉴定/);
 await page.screenshot({path:`${out}/browser-identify-warning.png`});
 await page.keyboard.press('Enter');await modal.waitFor({state:'hidden'});assert.deepEqual(await read(),before);
 assert.equal(await page.evaluate(()=>window.activeGame.pendingIdentify),true);
 results.push({scene:'identify self-description precedes target selection, no extra recorded input',state:before});
 await page.evaluate(()=>{const g=window.activeGame;g.startNewGame({seed:424242,mode:'normal'});g.animationEnabled=false;g.executeCommand('wait');g.executeCommand('wait');const rec=g.exportRecording();g.loadReplay(rec);window.u6tools.logger.log('Replay warning','#ff0',{acknowledge:true});g.replaySeek(2);});
 await page.waitForTimeout(100);assert.equal(await modal.count(),0);
 assert.equal(await page.evaluate(()=>window.activeGame.replayError),null);
 results.push({scene:'replay seek passes acknowledgment automatically with zero OOS',cursor:await page.evaluate(()=>window.activeGame.replayCursor)});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2)+'\n');
 console.log(`${results.length} browser scenarios passed; 0 page/console errors`);
} finally {await browser.close();}
