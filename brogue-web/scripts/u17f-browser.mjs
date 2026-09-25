import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-17f-evidence',errors=[],results=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('1716');await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const state=()=>page.evaluate(async()=>{const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const g=window.activeGame;return{player:{loc:{...g.player.loc},hp:g.player.hp},tiles:g.grid.cells.flat().filter(c=>c.machineNumber).map(c=>({x:c.x,y:c.y,layers:c.layers.map(t=>T[t])})),monsters:g.monsters.map(m=>({id:m.id,ally:m.isAlly,loc:{...m.loc}})),dormant:g.dormantMonsters.map(m=>m.id),items:g.items.map(i=>({name:i.name,loc:i.loc}))};});
 const snap=async name=>{await page.evaluate(()=>{const g=window.activeGame;g.needsRender=true;g.updateVision();g.update();g.onRenderRequested();});await page.waitForTimeout(200);await page.screenshot({path:`${out}/browser-${name}.png`});results.push({name,state:await state(),text:JSON.parse(await page.evaluate(()=>window.render_game_to_text()))});};
 async function scene(kind){await page.evaluate(async kind=>{
  const g=window.activeGame;g.startNewGame({seed:1716,mode:'test'});g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];
  const {TerrainType:T,DungeonLayer:L}=await import('/src/engine/Map/Grid.ts');const {Item,ItemCategory:C}=await import('/src/engine/Items/Item.ts');const {Monster}=await import('/src/entities/Monster.ts');const {default:rows}=await import('/src/data/monsters.json');const {rng}=await import('/src/engine/Random.ts');
  for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){g.grid.setTerrain(x,y,x<7||x>22||y<7||y>15?T.GRANITE:T.FLOOR);const c=g.grid.getCell(x,y);c.machineNumber=0;c.volume=0;}
  g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=1000;g.player.statusDurations={};g.secretScanDepth=-1;g.bindDormantAwakener();
  const mark=(x,y,t,m=7)=>{g.grid.setTerrain(x,y,t);g.grid.getCell(x,y).machineNumber=m;};
  const item=(x,y)=>{const i=new Item('任务钥匙','⚿',0xffffff,C.KEY);i.loc={x,y};g.items.push(i);return i;};
  const dormant=(x,y,id='rat')=>{const m=new Monster(x,y,rows.find(m=>m.id===id));g.monsters.push(m);m.machineHome=7;g.toggleMonsterDormancy(m);return m;};
  if(kind==='rats'){mark(11,10,T.ALTAR_SWITCH);item(11,10);for(const x of [14,16,18]){mark(x,10,T.RAT_TRAP_WALL_DORMANT);dormant(x,10);}}
  if(kind==='statue'){mark(11,10,T.MACHINE_TRIGGER_FLOOR);mark(15,10,T.STATUE_DORMANT_DOORWAY);dormant(15,10,'ogre');}
  if(kind==='coffin'){mark(11,10,T.MACHINE_TRIGGER_FLOOR);mark(15,10,T.COFFIN_CLOSED);const m=dormant(15,10,'vampire');m.carriedItem=item(15,10);g.items=[];}
  if(kind==='floor'){mark(11,10,T.ALTAR_SWITCH_RETRACTING);item(11,10);}
  if(kind==='portal'){mark(11,10,T.ALTAR_KEYHOLE);mark(15,10,T.PORTAL);const {default:blueprints}=await import('/src/data/blueprints.json');const f=blueprints.find(b=>b.ceBlueprintId===12).features[1];const ally=g.spawnHordeAtFeature({pos:{x:15,y:10},hordeFlags:f.hordeFlags,dormant:true},12,7);if(!ally?.isAlly)throw Error('CE12 legendary ally allegiance');const key=item(0,0);g.items=[];key.keyLoc=[{loc:{x:11,y:10},machine:0,disposableHere:true}];key.originDepth=g.depth;g.player.inventory.addItem(key);}
  if(kind==='worms'){mark(11,10,T.WALL_LEVER);for(let x=15;x<=18;x++){mark(x,10,T.GRANITE);g.grid.setTerrainLayer(x,10,L.LIQUID,T.WORM_TUNNEL_MARKER_DORMANT);for(const y of [9,11])mark(x,y,T.GRANITE,0);}dormant(17,10,'underworm');}
  rng.seedRandomGenerator(1716);window.u17fDraw=rng.randRange.bind(rng);rng.randRange=(a,b)=>a===0&&b===10000?10000:window.u17fDraw(a,b);
  g.needsRender=true;g.updateVision();g.update();g.onRenderRequested();
 },kind);}
 for(const kind of ['rats','statue','coffin','floor','portal','worms']){
  await scene(kind);await snap(kind+'-before');await page.keyboard.press('ArrowRight');if(['rats','floor'].includes(kind))await page.keyboard.press('g');await snap(kind+'-active');
  let s=await state();const tile=(x,name)=>s.tiles.some(c=>c.x===x&&c.y===10&&c.layers.includes(name));
  if(kind==='rats')assert(tile(14,'RAT_TRAP_WALL_CRACKING'));if(kind==='statue')assert(tile(15,'STATUE_CRACKING'));if(kind==='coffin')assert(tile(15,'COFFIN_OPEN'));if(kind==='floor')assert(tile(11,'FLOOR_FLOODABLE'));if(kind==='portal')assert(tile(15,'PORTAL_LIGHT'));if(kind==='worms')assert(tile(17,'WORM_TUNNEL_MARKER_ACTIVE'));
  await page.evaluate(async()=>{const {rng}=await import('/src/engine/Random.ts');rng.randRange=window.u17fDraw;});
  for(let i=0;i<160;i++){s=await state();if(s.dormant.length===0&&kind!=='portal')break;await page.keyboard.press('.');if(kind==='portal'&&i>=2)break;}
  s=await state();assert.equal(s.dormant.length,0,kind);if(kind==='portal')assert(s.monsters.some(m=>m.ally));if(kind==='worms'){await page.keyboard.press('ArrowDown');for(let j=0;j<4;j++)await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');}await snap(kind+'-after');
 }
 await page.setViewportSize({width:700,height:900});await snap('narrow');assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({errors,results},null,2)+'\n');await browser.close();}
