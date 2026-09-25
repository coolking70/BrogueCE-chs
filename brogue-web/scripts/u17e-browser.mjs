import {chromium} from 'playwright';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-17e-evidence',errors=[],results=[];
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
fs.writeFileSync(`${out}/browser-inputs.json`,JSON.stringify(Object.fromEntries(walk('src').map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),null,2)+'\n');
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('1715');await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const state=()=>page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;return{player:{loc:{...g.player.loc},hp:g.player.hp},tiles:g.grid.cells.flat().filter(c=>['ALTAR_CAGE_OPEN','ALTAR_CAGE_CLOSED','COMMUTATION_ALTAR','COMMUTATION_ALTAR_INERT','PIPE_GLOWING','PIPE_INERT','RESURRECTION_ALTAR','RESURRECTION_ALTAR_INERT','SACRIFICE_ALTAR_DORMANT','SACRIFICE_ALTAR','SACRIFICE_LAVA','SACRIFICE_CAGE_DORMANT','ALTAR_CAGE_RETRACTABLE','ALTAR'].some(t=>c.layers.includes(T[t]))).map(c=>({x:c.x,y:c.y,layers:c.layers.map(t=>T[t])})),items:g.items.map(i=>({name:i.name,loc:{...i.loc},E:i.enchantment})),monsters:g.monsters.map(m=>({id:m.id,hp:m.hp,ally:m.isAlly,marked:m.markedForSacrifice,loc:{...m.loc}})),purgatory:g.purgatory.length};});
 const snap=async name=>{await page.waitForTimeout(200);await page.screenshot({path:`${out}/browser-${name}.png`});results.push({name,state:await state(),text:JSON.parse(await page.evaluate(()=>window.render_game_to_text()))});};
 async function scene(kind){await page.evaluate(async kind=>{
  const g=window.activeGame;g.startNewGame({seed:1715,mode:'test'});g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];
  const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const {Item,ItemCategory:C}=await import('/src/engine/Items/Item.ts');
  for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){g.grid.setTerrain(x,y,T.FLOOR);const c=g.grid.getCell(x,y);c.machineNumber=0;c.volume=0;}
  g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.secretScanDepth=-1;g.bindDormantAwakener();
  const mark=(x,y,t,m=7)=>{g.grid.setTerrain(x,y,t);g.grid.getCell(x,y).machineNumber=m;};
  const item=(name,x,y,cat,E=0)=>{const i=new Item(name,'?',0xffffff,cat);i.enchantment=E;i.loc={x,y};return i;};
  if(kind==='cage')for(const x of [11,15]){mark(x,10,T.ALTAR_CAGE_OPEN);const i=item(x===11?'借出的戒指':'剩余的戒指',x,10,C.RING,2);i.flags=['ITEM_IS_KEY'];i.keyLoc=[{loc:{x,y:10},machine:0,disposableHere:false}];i.originDepth=g.depth;g.items.push(i);}
  if(kind==='commutation'){mark(10,10,T.COMMUTATION_ALTAR);mark(12,10,T.COMMUTATION_ALTAR);for(let x=10;x<=12;x++)mark(x,11,T.PIPE_GLOWING);mark(11,10,T.PIPE_GLOWING);for(const i of [item('甲剑',10,10,C.WEAPON,5),item('乙甲',12,10,C.ARMOR,1)])g.player.inventory.addItem(i);}
  if(kind==='resurrection'){mark(11,10,T.MACHINE_TRIGGER_FLOOR_REPEATING);mark(14,10,T.RESURRECTION_ALTAR);const {Monster}=await import('/src/entities/Monster.ts');const {default:rows}=await import('/src/data/monsters.json');const m=new Monster(18,10,rows.find(m=>m.id==='goblin'));m.isAlly=true;m.hp=0;g.monsters.push(m);g.removeDeadMonsters();}
  if(kind==='sacrifice'){mark(11,10,T.PRESSURE_PLATE);mark(15,10,T.SACRIFICE_ALTAR_DORMANT);mark(18,10,T.SACRIFICE_CAGE_DORMANT);g.items.push(item('祭坛钥匙',18,10,C.KEY));const {default:rows}=await import('/src/data/blueprints.json');const f=rows.find(b=>b.ceBlueprintId===47).features.find(f=>f.hordeFlags?.includes('HORDE_SACRIFICE_TARGET'));const m=g.spawnHordeAtFeature({...f,pos:{x:16,y:10},flags:[]},g.depth,7);m.ticksUntilTurn=10000;m.movementSpeed=10000;window.sacrificeId=m.id;}
  g.needsRender=true;g.updateVision();g.update();g.onRenderRequested();
 },kind);}
 await snap('natural');
 await scene('cage');await snap('cage-before');await page.keyboard.press('ArrowRight');await page.keyboard.press('g');await page.keyboard.press('ArrowLeft');let s=await state();assert(s.tiles.some(t=>t.x===11&&t.layers[0]==='ALTAR_CAGE_CLOSED'));await snap('cage-closed');await page.keyboard.press('ArrowRight');s=await state();assert.equal(s.player.loc.x,11);assert(s.tiles.some(t=>t.x===15&&t.layers[0]==='ALTAR_CAGE_OPEN'));await snap('cage-reopened');
 await scene('commutation');await snap('commutation-before');
 const drop=async name=>{await page.keyboard.press('i');await page.locator('.item-row').filter({hasText:name}).click();await page.locator('.item-actions .action-btn.danger').click();await page.waitForTimeout(150);};
 await drop('甲剑');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await drop('乙甲');s=await state();assert.deepEqual(s.items.filter(i=>['甲剑','乙甲'].includes(i.name)).map(i=>i.E),[1,5]);assert.equal(s.tiles.filter(t=>t.layers[0]==='COMMUTATION_ALTAR_INERT').length,2);assert(s.tiles.some(t=>t.layers.includes('PIPE_INERT')));await snap('commutation-after');
 await scene('resurrection');await snap('resurrection-before');await page.keyboard.press('ArrowRight');s=await state();assert.equal(s.purgatory,0);assert(s.monsters.some(m=>m.ally&&m.hp>0));assert(s.tiles.some(t=>t.layers[0]==='RESURRECTION_ALTAR_INERT'));await snap('resurrection-after');
 await scene('sacrifice');await snap('sacrifice-before');await page.keyboard.press('ArrowRight');s=await state();assert(s.tiles.some(t=>t.layers[0]==='SACRIFICE_ALTAR'));await snap('sacrifice-active');
 // Use the existing public spell route to supply the sacrifice's entrance condition.
 await page.evaluate(async()=>{const g=window.activeGame;const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');const staff=ItemLoader.spawnStaff('staff_of_entrancement',g.player.x,g.player.y);staff.enchantment=3;staff.maxCharges=3;staff.charges=3;g.player.inventory.addItem(staff);const m=g.monsters.find(m=>m.id===window.sacrificeId);g.useArcanaItem(staff);g.setArcanaTarget(m.x,m.y);g.confirmArcanaTarget();});
 await page.keyboard.press('ArrowRight');s=await state();assert(s.tiles.some(t=>t.layers[0]==='SACRIFICE_LAVA'));assert(!s.monsters.some(m=>m.marked&&m.hp>0));assert(s.tiles.some(t=>t.x===18&&t.layers[0]==='ALTAR'));await snap('sacrifice-complete');
 await page.setViewportSize({width:700,height:900});await snap('narrow');assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({errors,results},null,2)+'\n');await browser.close();}
