import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-17d-evidence',errors=[],results=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('1719');await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const snap=async name=>{await page.waitForTimeout(200);await page.screenshot({path:`${out}/browser-${name}.png`});results.push({name,state:JSON.parse(await page.evaluate(()=>window.render_game_to_text()))});};
 async function scene(kind){await page.evaluate(async kind=>{
  const g=window.activeGame;g.startNewGame({seed:1719,mode:'test'});g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];g.items=[];
  const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');const {Item,ItemCategory}=await import('/src/engine/Items/Item.ts');
  for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){g.grid.setTerrain(x,y,T.FLOOR);const c=g.grid.getCell(x,y);c.machineNumber=0;c.volume=0;}
  g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.secretScanDepth=-1;g.bindDormantAwakener();
  const mark=(x,y,t,m=7)=>{g.grid.setTerrain(x,y,t);g.grid.getCell(x,y).machineNumber=m;};
  if(kind==='search')for(const [i,t] of [T.MACHINE_METHANE_VENT_HIDDEN,T.MACHINE_PARALYSIS_VENT_HIDDEN,T.MACHINE_POISON_GAS_VENT_HIDDEN,T.GAS_TRAP_POISON_HIDDEN,T.FLAMETHROWER_HIDDEN].entries())mark(11+i,10,t);
  if(kind==='poison'||kind==='methane'){
   mark(11,10,T.ALTAR_SWITCH);mark(13,10,kind==='poison'?T.MACHINE_POISON_GAS_VENT_HIDDEN:T.MACHINE_METHANE_VENT_HIDDEN);
   if(kind==='methane')mark(13,9,T.PILOT_LIGHT_DORMANT);
   const key=new Item('钥匙','⚿',0xffffff,ItemCategory.KEY);key.loc={x:11,y:10};g.items.push(key);
  }
  if(kind==='paralysis'){mark(11,10,T.PRESSURE_PLATE);mark(14,10,T.MACHINE_PARALYSIS_VENT_HIDDEN);const {Monster}=await import('/src/entities/Monster.ts');const {default:rows}=await import('/src/data/monsters.json');const m=new Monster(14,10,rows.find(m=>m.id==='rat'));m.hp=m.maxHp=100;g.monsters.push(m);}
  if(kind==='poison-trap')mark(11,10,T.GAS_TRAP_POISON_HIDDEN,0);
  if(kind==='fire-trap'){mark(11,10,T.FLAMETHROWER_HIDDEN,0);const i=new Item('卷轴','?',0xffffff,ItemCategory.SCROLL);i.loc={x:11,y:10};g.items.push(i);}
  g.needsRender=true;g.updateVision();g.update();g.onRenderRequested();
 },kind);}
 await snap('natural');
 await scene('search');await snap('hidden');for(let n=0;n<5;n++)await page.keyboard.press('s');
 const revealed=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');return [11,12,13,14,15].map(x=>T[window.activeGame.grid.getCell(x,10).layers[0]]);});assert.deepEqual(revealed,['MACHINE_METHANE_VENT_DORMANT','MACHINE_PARALYSIS_VENT','MACHINE_POISON_GAS_VENT_DORMANT','GAS_TRAP_POISON','FLAMETHROWER']);results.push({revealed});await snap('revealed');
 for(const kind of ['poison','methane','paralysis','poison-trap','fire-trap']){
  await scene(kind);await snap(`${kind}-before`);await page.keyboard.press('ArrowRight');if(['poison','methane'].includes(kind))await page.keyboard.press('g');
  const state=await page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;return{player:{loc:{...g.player.loc},hp:g.player.hp,status:g.player.statusDurations},tiles:g.grid.cells.flat().filter(c=>c.volume>0||[T.MACHINE_POISON_GAS_VENT,T.MACHINE_METHANE_VENT,T.PILOT_LIGHT,T.MACHINE_PARALYSIS_VENT,T.FLAMETHROWER,T.GAS_TRAP_POISON].includes(c.layers[0])).map(c=>({x:c.x,y:c.y,layers:c.layers.map(t=>T[t]),volume:c.volume})),monsters:g.monsters.map(m=>({hp:m.hp,status:m.statusDurations})),items:g.items.map(i=>i.name)};});
  results.push({kind,state});
  const base=kind==='poison'?'MACHINE_POISON_GAS_VENT':kind==='methane'?'MACHINE_METHANE_VENT':kind==='paralysis'?'MACHINE_PARALYSIS_VENT':kind==='poison-trap'?'GAS_TRAP_POISON':'FLAMETHROWER';assert(state.tiles.some(c=>c.layers[0]===base),`${kind} final carrier`);
  if(kind==='methane')assert(state.tiles.some(c=>c.layers[0]==='PILOT_LIGHT'));
  if(kind==='paralysis')assert(state.monsters.some(m=>m.status.paralyzed>0));
  if(kind==='poison-trap')assert(state.player.hp<100);
  if(kind==='fire-trap'){assert(state.player.status.burning>0);assert(!state.items.includes('卷轴'));}
  await snap(`${kind}-after`);
 }
 await page.setViewportSize({width:700,height:900});await snap('narrow');assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({errors,results},null,2)+'\n');await browser.close();}
