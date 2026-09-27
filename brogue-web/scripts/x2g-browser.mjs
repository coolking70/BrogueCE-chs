import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out='ai_docs/reports/x2g-evidence', errors=[],rows=[];
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');
 await page.locator('.menu-card input[type=text]').fill('424242');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 await page.evaluate(async()=>{
  const g=window.activeGame,{TerrainType:T}=await import('/src/engine/Map/Grid.ts'),{ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');
  const {Monster}=await import('/src/entities/Monster.ts'),{default:monsters}=await import('/src/data/monsters.json');
  window.x2gScene=()=>{
   g.startNewGame({seed:424242,mode:'test'});g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];g.items=[];g.player.inventory.items=[];g.grid.impregnableCells.clear();
   for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++) {g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);Object.assign(g.grid.getCell(x,y),{machineNumber:0,hasDormantMonster:false,isPowered:false});}
   g.player.loc={x:35,y:15};g.player.hp=g.player.maxHp=200;g.updateVision();g.needsRender=true;g.onRenderRequested();
  };
  window.x2gPotion=id=>{const i=ItemLoader.spawnPotion('potion_of_'+id,-1,-1);g.player.inventory.addItem(i);return i;};
  window.x2gMonster=(id,x=38,y=15)=>{const m=new Monster(x,y,monsters.find(m=>m.id===id));m.ticksUntilTurn=10000;g.monsters.push(m);return m;};
  window.x2gT=T;
 });
 const scene=()=>page.evaluate(()=>window.x2gScene());
 const shot=async label=>{
  await page.evaluate(()=>{const g=window.activeGame;g.updateVision();g.needsRender=true;g.onRenderRequested();});await page.waitForTimeout(200);
  await page.screenshot({path:`${out}/browser-${label}.png`});
  rows.push({label,text:await page.evaluate(()=>JSON.parse(window.render_game_to_text()))});
 };
 await scene();
 await page.evaluate(()=>window.activeGame.throwItemAt(window.x2gPotion('creeping_death'),38,15));await shot('lichen-thrown');
 let state=await page.evaluate(()=>{const g=window.activeGame;return {lichen:g.grid.getCell(38,15).layers.includes(window.x2gT.LICHEN),gas:g.grid.getCell(38,15).volume};});assert(state.lichen);assert.equal(state.gas,0);
 await page.evaluate(()=>window.activeGame.quaffItem(window.x2gPotion('creeping_death'),true));await shot('lichen-drunk');assert(await page.evaluate(()=>window.activeGame.player.hasStatus('poisoned')));
 await scene();await shot('light-before');
 await page.evaluate(()=>window.activeGame.throwItemAt(window.x2gPotion('darkness'),36,15));await shot('darkness-thrown');
 assert(await page.evaluate(()=>window.activeGame.grid.getCell(36,15).layers.includes(window.x2gT.DARKNESS_CLOUD)));
 await scene();await page.evaluate(()=>{const g=window.activeGame,m=window.x2gMonster('zombie',35,15);m.takeDamage(20,true,g.grid);g.applyEnvironmentalEffects(g.player);});await shot('rot-gas');
 assert(await page.evaluate(()=>window.activeGame.player.hasStatus('nauseous')));
 await page.evaluate(()=>{for(let i=0;i<3;i++)window.activeGame.updateEnvironment();});await shot('rot-spread');
 await scene();await page.evaluate(()=>{const g=window.activeGame;for(let x=36;x<=41;x++)for(let y=13;y<=17;y++)g.grid.setTerrain(x,y,window.x2gT.WATER_DEEP);const m=window.x2gMonster('eel',36,15);m.submerged=true;});await shot('eel-hidden');
 assert.equal(rows.at(-1).text.monsters?.length??0,0);
 await page.evaluate(()=>window.activeGame.player.applyStatus('telepathy',30));await shot('eel-marker');
 await page.evaluate(()=>{const g=window.activeGame;g.player.setStatusDuration('telepathy',0);g.grid.setTerrain(35,15,window.x2gT.WATER_DEEP);});await shot('eel-underwater');
 assert((rows.at(-1).text.monsters??[]).length>0);
 await page.evaluate(async()=>{const {CombatSystem}=await import('/src/engine/Combat/Combat.ts');const g=window.activeGame;CombatSystem.attack(g.monsters[0],g.player,{grid:g.grid});});await shot('eel-surfaced');
 assert.equal(await page.evaluate(()=>window.activeGame.monsters[0].submerged),false);
 await page.evaluate(()=>{const g=window.activeGame;g.monsters[0].submerged=true;const s=g.toSnapshot();g.monsters[0].submerged=false;g.loadSnapshot(s);g.player.loc={x:34,y:15};});await shot('eel-restored');
 assert.equal(await page.evaluate(()=>window.activeGame.monsters[0].submerged),true);
 await scene();await page.evaluate(async()=>{const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');const g=window.activeGame,m=window.x2gMonster('zombie',38,15);m.hp=80;const weapon=ItemLoader.spawnWeapon('dagger',-1,-1);g.player.equippedWeapon=weapon;g.player.inventory.addItem(weapon);g.applyWeaponRunicEffect(m,0,'quietus');});await shot('rot-quietus');
 assert.equal(await page.evaluate(()=>window.activeGame.grid.getCell(38,15).volume),1600);
 await scene();await page.evaluate(()=>{const g=window.activeGame;g.grid.setTerrain(36,15,window.x2gT.WATER_DEEP);g.grid.setTerrain(37,15,window.x2gT.WATER_DEEP);const m=window.x2gMonster('eel',36,15);m.submerged=true;if(!g.finishBlink({caster:g.player,landingPos:{x:36,y:15}}))throw Error('blink relocation failed');});await shot('blink-relocated');
 assert.deepEqual(await page.evaluate(()=>({player:window.activeGame.player.loc,eel:window.activeGame.monsters[0].loc})),{player:{x:36,y:15},eel:{x:37,y:15}});
 // Real keyboard and inventory close after the scripted engine scenarios.
 await page.keyboard.press('i');await page.waitForSelector('.inventory-modal');await page.keyboard.press('Escape');await page.keyboard.press('.');await shot('final');
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/browser.json`,JSON.stringify({errors,rows,scope:'Real menu/input/render; deterministic effect fixtures via public engine entry points.'},null,2)+'\n');
} finally {await browser.close();}
