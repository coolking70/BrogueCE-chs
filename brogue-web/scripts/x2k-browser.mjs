import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out='ai_docs/reports/x2k-evidence';
const browser=await chromium.launch({headless:false});
const errors=[],rows=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5197');
 await page.locator('.menu-card input[type=text]').fill('2160');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 await page.evaluate(async()=>{
  const g=window.activeGame, {TerrainType:T}=await import('/src/engine/Map/Grid.ts'),{Monster}=await import('/src/entities/Monster.ts'),{ItemLoader}=await import('/src/engine/Items/ItemLoader.ts'),{default:data}=await import('/src/data/monsters.json');
  g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];
  for(let x=3;x<20;x++)for(let y=3;y<14;y++){const c=g.grid.getCell(x,y);c.layers.fill(T.NOTHING);g.grid.setTerrain(x,y,T.FLOOR);c.machineNumber=0;}
  g.player.loc={x:8,y:8};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};
  const ally=new Monster(10,8,data.find(m=>m.id==='bloat'));ally.isAlly=true;ally.carriedItem=ItemLoader.spawnKey('iron_key',10,8);ally.ticksUntilTurn=10000;
  const passenger=new Monster(0,0,data.find(m=>m.id==='rat'));passenger.isAlly=true;ally.carriedMonster=passenger;
  g.monsters.push(ally);window.x2kHost=ally;window.x2kPassenger=passenger;g.updateVision();
 });
 const observe=()=>page.evaluate(()=>{const g=window.activeGame;return {hp:g.player.hp,monsters:g.monsters.map(m=>({id:m.id,type:m.typeId,hp:m.hp,loc:m.loc,ticks:m.ticksUntilTurn,processed:m.deathProcessed})),purgatory:g.purgatory.map(m=>({id:m.id,type:m.typeId,char:m.char})),items:g.items.map(i=>({id:i.id,loc:i.loc})),gas:g.environment.gasGrid[10][8],text:JSON.parse(window.render_game_to_text())};});
 const shot=async(label)=>{await page.evaluate(()=>{const g=window.activeGame;g.updateVision();g.needsRender=true;g.onRenderRequested();});await page.waitForTimeout(200);await page.screenshot({path:`${out}/browser-${label}.png`});rows.push({label,...await observe()});};
 await shot('before');
 await page.evaluate(()=>{const m=window.x2kHost;m.takeDamage(m.hp,true);});
 await shot('immediate');
 const immediate=rows.at(-1);assert.equal(immediate.purgatory.length,0);assert.equal(immediate.monsters.find(m=>m.type==='bloat').processed,true);assert.equal(immediate.items.length,1);assert.equal(immediate.monsters.find(m=>m.type==='rat').ticks,200);
 await page.keyboard.press('.');await page.waitForFunction(()=>!window.activeGame.isAdvancing);
 await shot('swept');assert.equal(rows.at(-1).purgatory.length,1);
 await page.locator('.menu-btn').click();await page.getByRole('button',{name:'保存游戏',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'继续游戏',exact:true}).click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 await shot('restored');assert.equal(rows.at(-1).purgatory.length,1);
 await page.evaluate(async()=>{const g=window.activeGame,{TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');g.animationEnabled=false;g.player.loc={x:8,y:8};g.grid.setTerrain(11,8,T.RESURRECTION_ALTAR);g.grid.setTerrainLayer(9,8,L.LIQUID,T.MACHINE_TRIGGER_FLOOR_REPEATING);g.grid.getCell(11,8).machineNumber=g.grid.getCell(9,8).machineNumber=900;g.updateVision();});
 await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>!window.activeGame.isAdvancing);
 await shot('resurrected');assert.equal(rows.at(-1).purgatory.length,0);assert.ok(rows.at(-1).monsters.some(m=>m.type==='bloat'&&m.hp>0));
 assert.deepEqual(errors,[]);
} finally {fs.writeFileSync(`${out}/browser.json`,JSON.stringify({errors,rows},null,2)+'\n');await browser.close();}
