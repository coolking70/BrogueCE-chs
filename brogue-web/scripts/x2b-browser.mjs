import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const out='ai_docs/reports/x2b-evidence', rows=[], errors=[];
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5198');
 await page.locator('.menu-card input[type=text]').fill('424242');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const shot=async label=>{
  await page.waitForTimeout(250);await page.screenshot({path:`${out}/browser-${label}.png`});
  rows.push({label,text:await page.evaluate(()=>JSON.parse(window.render_game_to_text()))});
 };
 const natural=await page.evaluate(async()=>{
  const g=window.activeGame,{TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const F=await import('/src/engine/Map/TerrainCatalog.ts');const mismatch=[],torch=[],foliage=[];
  for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
   const c=g.grid.getCell(x,y),f=c.layers.reduce((v,t)=>v|F.TERRAIN_FLAGS[t].flags,0);
   if(c.isPassable!==!(f&F.T_OBSTRUCTS_PASSABILITY)||c.isOpaque!==!!(f&F.T_OBSTRUCTS_VISION))mismatch.push({x,y});
   if(c.layers.includes(T.TORCH_WALL))torch.push({x,y,passable:c.isPassable,opaque:c.isOpaque});
   if(c.layers.includes(T.FOLIAGE))foliage.push({x,y,passable:c.isPassable,opaque:c.isOpaque});
  }
  return {seed:g.seed,mismatch,torch,foliage};
 });
 assert.equal(natural.mismatch.length,0);assert(natural.torch.length&&natural.foliage.length);
 await shot('natural');
 await page.evaluate(async()=>{
  const g=window.activeGame,{TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');
  g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
  for(let x=30;x<=41;x++)for(let y=10;y<=20;y++)g.grid.setTerrain(x,y,x===30||x===41||y===10||y===20?T.WALL:T.FLOOR);
  g.player.loc={x:35,y:14};g.grid.setTerrain(34,14,T.TORCH_WALL);
  g.grid.setTerrainLayer(36,14,L.SURFACE,T.FOLIAGE);g.grid.setTerrain(35,15,T.DOOR);g.grid.setTerrain(34,16,T.CRYSTAL_WALL);
  g.updateVision();g.needsRender=true;g.onRenderRequested();
 });
 await shot('terrain-before');
 const press=async key=>{await page.waitForFunction(()=>!window.activeGame.isInputLocked());await page.keyboard.press(key);await page.waitForFunction(()=>!window.activeGame.isInputLocked());};
 await press('ArrowLeft');
 assert.equal(await page.evaluate(()=>window.activeGame.player.x),35);
 await press('ArrowRight');
 const foliageAfter=await page.evaluate(async()=>{const g=window.activeGame,{TerrainType:T}=await import('/src/engine/Map/Grid.ts');const c=g.grid.getCell(36,14);return {x:g.player.x,y:g.player.y,opaque:c.isOpaque,layers:c.layers.map(t=>T[t])};});
 assert.equal(foliageAfter.x,36);assert.equal(foliageAfter.opaque,false);
 await shot('foliage-trampled');await press('ArrowLeft');await press('ArrowDown');
 const doorAfter=await page.evaluate(()=>{const g=window.activeGame,c=g.grid.getCell(35,15);return {x:g.player.x,y:g.player.y,opaque:c.isOpaque,passable:c.isPassable};});
 assert.equal(doorAfter.y,15);assert.equal(doorAfter.opaque,false);
 await shot('door-open');
 const travel=await page.evaluate(async()=>{
  const g=window.activeGame,{TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  g.grid.setTerrain(37,15,T.GAS_TRAP_POISON_HIDDEN);g.updateVision();g.autoPath=[];g.setAutoPath(37,15);
  const hidden=g.autoPath.map(p=>({...p}));g.autoPath=[];
  g.grid.setTerrain(37,15,T.GAS_TRAP_POISON);g.updateVision();g.setAutoPath(37,15);
  const revealed=g.autoPath.map(p=>({...p}));g.autoPath=[];
  return {hidden,revealed};
 });
 assert.deepEqual(travel.hidden.at(-1),{x:37,y:15});assert.equal(travel.revealed.length,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(`${out}/browser.json`,JSON.stringify({natural,foliageAfter,doorAfter,travel,rows,errors},null,2)+'\n');
 console.log(JSON.stringify({torch:natural.torch.length,foliage:natural.foliage.length,foliageAfter,doorAfter,travel,errors}));
}finally{await browser.close();}
