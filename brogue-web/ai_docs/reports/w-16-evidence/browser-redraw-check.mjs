// Observation-only replay: explicitly flush Game.update after direct test-fixture mutation.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/w-16-evidence';
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[], states=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5179');await page.locator('select').first().selectOption('test');
 await page.locator('.actions button').first().click();await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const {Grid,TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const {EnvironmentManager}=await import('/src/engine/Environment/Gas.ts');
  const {LightMap}=await import('/src/engine/Lighting/LightMap.ts');const {FOVSys}=await import('/src/engine/Lighting/FOV.ts');
  const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');
  const g=window.activeGame;g.grid=new Grid(g.grid.width,g.grid.height);
  for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
   g.grid.setTerrain(x,y,x>0&&x<16&&y>0&&y<12?T.FLOOR:T.GRANITE);Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true});
  }
  g.grid.setTerrain(11,5,T.WALL);g.environment=new EnvironmentManager(g.grid);g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);
  g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.ticksUntilTurn=0;
  g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;g.player.inventory.items=[];
  g.monsters=[];g.dormantMonsters=[];g.items=[];g.pendingBoltFrames=[];g.floatingTexts=[];g.autoPath=[];g.isMouseTraveling=false;
  ItemLoader.identifiedItems.clear();const item=ItemLoader.spawnStaff('staff_of_conjuration',-1,-1);item.enchantment=3;item.charges=2;g.player.inventory.addItem(item);window.w16Item=item;
  g.updateVision();g.needsRender=true;
 });
 const capture=async name=>{
  await page.waitForTimeout(500);await page.evaluate(()=>{window.activeGame.needsRender=true;window.activeGame.update();});await page.waitForTimeout(100);
  const state=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));states.push({name,state});
  await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;
 };
 await page.evaluate(()=>window.activeGame.useArcanaItem(window.w16Item));await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.w16Item.charges),2);assert.equal(await page.evaluate(()=>window.activeGame.monsters.length),0);
 await page.evaluate(()=>{window.activeGame.useArcanaItem(window.w16Item);window.activeGame.setArcanaTarget(8,5);});await capture('targeting');
 await page.keyboard.press('Enter');let s=await capture('summoned');
 let all=s.monsters.filter(m=>m.typeId==='spectral_blade');assert.equal(all.length,4);assert.ok(all.every(m=>m.isAlly&&m.boundToPlayer&&m.doesNotTrackLeader&&m.ticksUntilTurn===1));
 assert.equal(new Set(all.map(m=>`${m.x},${m.y}`)).size,4);assert.equal(await page.evaluate(()=>window.w16Item.charges),1);
 assert.equal(await page.evaluate(async()=>{const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');return ItemLoader.identifiedItems.has('staff_of_conjuration');}),true);
 const initial=all.map(m=>({x:m.x,y:m.y}));
 await page.evaluate(async()=>{
  const {Monster,MonsterState}=await import('/src/entities/Monster.ts');const {default:data}=await import('/src/data/monsters.json');const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const g=window.activeGame;g.grid.setTerrain(11,5,T.FLOOR);const enemy=new Monster(13,5,data.find(m=>m.id==='rat'));
  enemy.hp=enemy.maxHp=30;enemy.state=MonsterState.HUNTING;enemy.ticksUntilTurn=100000;g.monsters.push(enemy);window.w16Enemy=enemy;g.updateVision();
 });
 await page.keyboard.press('.');s=await capture('pursuit');all=s.monsters.filter(m=>m.typeId==='spectral_blade');assert.equal(all.length,4);assert.notDeepEqual(all.map(m=>({x:m.x,y:m.y})),initial);
 for(let i=0;i<5;i++){await page.keyboard.press('.');await page.waitForTimeout(150);}
 s=await capture('attacking');assert.ok(await page.evaluate(()=>window.w16Enemy.hp<30));
 await page.evaluate(()=>{const g=window.activeGame;g.monsters=g.monsters.filter(m=>m.typeId==='spectral_blade');window.w16Save=JSON.parse(JSON.stringify(g.toSnapshot()));
  for(let i=0;i<200;i++)g.tickCreatureStatuses();g.needsRender=true;});
 s=await capture('no-expiry');assert.equal(await page.evaluate(()=>window.activeGame.monsters.filter(m=>m.hp>0).length),4);
 await page.evaluate(()=>window.activeGame.loadSnapshot(window.w16Save));s=await capture('restored');
 assert.equal(s.monsters.filter(m=>m.typeId==='spectral_blade'&&m.boundToPlayer&&m.doesNotTrackLeader).length,4);
 await page.evaluate(async()=>{const g=window.activeGame;const b=g.monsters.find(m=>m.typeId==='spectral_blade');g.negateCreatureMagic(b);g.triggerDeathFeatures();g.removeDeadMonsters();g.updateVision();g.needsRender=true;});
 s=await capture('negated');assert.equal(s.monsters.filter(m=>m.typeId==='spectral_blade').length,3);
 fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({scenarios:states.map(s=>s.name),errors}));
}finally{await browser.close();}
