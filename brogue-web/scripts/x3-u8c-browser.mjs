import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = 'ai_docs/reports/x3-u8c-evidence', errors = [], results = [];
const browser = await chromium.launch({headless:false});
try {
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if(m.type()==='error')errors.push(m.text()); });
 await page.route('https://fonts.googleapis.com/**', r => r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.goto('http://127.0.0.1:5193');
 const checkbox = page.locator('.display-group input[type=checkbox]'); assert.equal(await checkbox.isChecked(),false);
 await checkbox.check(); await page.reload(); assert.equal(await checkbox.isChecked(),true); await checkbox.uncheck();
 assert.equal((await checkbox.boundingBox()).height,20);
 await page.screenshot({path:`${out}/browser-display-setting.png`});
 await page.locator('.menu-card input[type=text]').fill('33083'); await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested&&!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const [{TerrainType:T},{logger},{ItemLoader},{Monster,MonsterState},{default:data},{displaySettings}] = await Promise.all([
   import('/src/engine/Map/Grid.ts'),import('/src/engine/Systems/Logger.ts'),import('/src/engine/Items/ItemLoader.ts'),
   import('/src/entities/Monster.ts'),import('/src/data/monsters.json'),import('/src/engine/Settings.ts')]);
  window.u8c={T,logger,ItemLoader,Monster,MonsterState,data,displaySettings};
  window.u8setup=()=>{const g=window.activeGame;g.startNewGame({seed:33083,mode:'test'});g.animationEnabled=false;
   g.monsters=[];g.dormantMonsters=[];g.items=[];g.player.inventory.items=[];g.player.equippedWeapon=g.player.equippedArmor=null;
   g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.nutrition=2000;
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){g.grid.setTerrain(x,y,x>=8&&x<=18&&y>=8&&y<=12?T.FLOOR:T.GRANITE);
    Object.assign(g.grid.getCell(x,y),{isVisible:true,isExplored:true,hasMemory:true,isClairvoyantVisible:false});}
   logger.reset();g.disturbed=false;g.needsRender=true;g.update();};
  window.u8setup();
 });
 const shot=async name=>{await page.waitForTimeout(180);await page.screenshot({path:`${out}/${name}.png`});};
 const texts=()=>page.evaluate(()=>window.u8c.logger.messages.map(m=>m.text));
 await page.evaluate(()=>{const g=window.activeGame,{ItemLoader,Monster,MonsterState,data}=window.u8c;
  const w=ItemLoader.spawnWeapon('sword',-1,-1);w.enchantment=0;w.strengthRequired=0;g.player.inventory.addItem(w);g.player.equippedWeapon=w;
  const m=new Monster(11,10,data.find(m=>m.id==='rat'));m.hp=m.maxHp=100;m.ticksUntilTurn=10000;m.state=MonsterState.HUNTING;g.monsters.push(m);
  window.beforeCombat=g.toSnapshot();g.executeCommand('move',{x:1,y:0});g.update();});
 await page.waitForFunction(()=>!window.activeGame.isAdvancing);
 const normal=await texts();assert(normal.some(t=>t.includes('击中')));assert(!normal.some(t=>/点伤害|\d/.test(t)));await shot('browser-ce-combat');results.push({scene:'CE default',messages:normal});
 await page.evaluate(()=>{const g=window.activeGame;g.loadSnapshot(window.beforeCombat);window.u8c.displaySettings.showDamageNumbers=true;g.executeCommand('move',{x:1,y:0});g.update();});
 await page.waitForFunction(()=>!window.activeGame.isAdvancing);
 const numbers=await texts();assert(numbers.some(t=>/\d+ 点伤害/.test(t)),JSON.stringify(numbers));await shot('browser-damage-enabled');results.push({scene:'optional damage',messages:numbers});
 await page.evaluate(()=>{window.u8setup();const g=window.activeGame,{ItemLoader,Monster,MonsterState,data}=window.u8c;
  const w=ItemLoader.spawnWeapon('sword',-1,-1);w.runicType='slaying';w.runicKnown=false;w.vorpalEnemy='animal';g.player.inventory.addItem(w);g.player.equippedWeapon=w;
  const m=new Monster(12,10,data.find(m=>m.id==='rat'));m.ticksUntilTurn=10000;m.state=MonsterState.HUNTING;g.monsters.push(m);g.executeCommand('wait');g.update();});
 assert((await texts()).some(t=>t.includes('凶光')));await shot('browser-runic-hint');
 await page.evaluate(()=>window.u8c.logger.clearAcknowledgments());
 await page.evaluate(()=>{window.u8setup();const g=window.activeGame,{ItemLoader}=window.u8c;
  for(let n=0;n<2;n++)g.player.inventory.addItem(ItemLoader.spawnWand('wand_of_slowness',-1,-1));});
 await page.keyboard.press('c'); await page.locator('.item-row').first().click();
 await page.getByText('为这一件物品题字，而不是给所有同类物品命名？',{exact:true}).waitFor();assert.equal(await page.locator('.call-input').count(),0);await shot('browser-inscribe-choice');
 await page.locator('.call-input-row button').filter({hasText:/^是$/}).click();
 await page.locator('.call-input').fill('给未来的我');await page.locator('.call-input').press('Enter');
 const names=await page.evaluate(()=>window.activeGame.player.inventory.items.map(i=>i.displayName));assert(names[0].includes('给未来的我'));assert(!names[1].includes('给未来的我'));await shot('browser-inscribed');
 await page.keyboard.press('Escape');await page.keyboard.press('R');await page.getByText('重标哪件物品的字母？',{exact:true}).waitFor();await page.locator('.item-row').first().click();await page.locator('.call-input').fill('b');await page.locator('.call-input').press('Enter');
 const letters=await page.evaluate(()=>window.activeGame.player.inventory.items.map(i=>i.inventoryLetter));assert.deepEqual(letters,['b','a']);await shot('browser-relabel');results.push({scene:'inscribe and relabel',names,letters});
 await page.keyboard.press('Escape');await page.keyboard.press('c');await page.getByText('为哪件物品命名或题字？',{exact:true}).waitFor();await page.locator('.item-row').nth(1).click();
 await page.locator('.call-input-row button').filter({hasText:/^否$/}).click();await page.locator('.call-input').fill('减速类');await page.locator('.call-input').press('Enter');
 assert((await page.evaluate(()=>window.activeGame.player.inventory.items.map(i=>i.displayName))).every(n=>n.includes('减速类')));
 await page.setViewportSize({width:390,height:844});await shot('browser-mobile-inscription');
 fs.writeFileSync(`${out}/browser-state.json`,await page.evaluate(()=>window.render_game_to_text()));
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2)+'\n');console.log(JSON.stringify({results,errors}));
} finally {await browser.close();}
