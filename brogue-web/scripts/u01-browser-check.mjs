import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-01-evidence';
const browser=await chromium.launch({headless:false});
const errors=[],states=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5196');
 await page.locator('.menu-card input[type=text]').fill('424242');
 await page.locator('.menu-card .actions').first().locator('button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text&&!!window.activeGame.onRenderRequested);
 // Use the UI's actual localStorage save and a fresh document's Continue action.
 const saveReload=async()=>{
  await page.locator('.menu-btn').click();
  await page.locator('.menu-card .actions').first().locator('button').nth(2).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('brogue-web-save-v1')));
  assert.equal(saved.version,2);
  await page.reload();
  await page.locator('.menu-card .actions').first().locator('button').nth(1).click();
  await page.waitForFunction(()=>!!window.render_game_to_text&&!!window.activeGame.onRenderRequested);
  return saved;
 };
 const before=await page.evaluate(()=>{const s=window.activeGame.toSnapshot();return {p:s.player,m:s.monsters,i:s.items,d:s.dormantMonsters,g:s.entityGraph};});
 await saveReload();
 const after=await page.evaluate(()=>{const s=window.activeGame.toSnapshot();return {p:s.player,m:s.monsters,i:s.items,d:s.dormantMonsters,g:s.entityGraph};});
 assert.deepEqual(after,before);states.push({name:'natural-ui-save-reload',entities:after.m.length,playerId:after.p.id});
 await page.screenshot({path:`${dir}/browser-natural-restored.png`});
 // Controlled K02 encounter, real constructors and UI persistence (no test codec).
 await page.evaluate(async()=>{
  const [{ItemLoader},{Monster},{TerrainType:T},{EnvironmentManager},{FOVSys},{LightMap},{Grid,DCOLS,DROWS}]=await Promise.all([
   import('/src/engine/Items/ItemLoader.ts'),import('/src/entities/Monster.ts'),import('/src/engine/Map/Grid.ts'),
   import('/src/engine/Environment/Gas.ts'),import('/src/engine/Lighting/FOV.ts'),import('/src/engine/Lighting/LightMap.ts'),import('/src/engine/Map/Grid.ts')]);
  const md=(await import('/src/data/monsters.json')).default;
  const g=window.activeGame;g.grid=new Grid(DCOLS,DROWS);
  for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)g.grid.setTerrain(x,y,x>0&&y>0&&x<DCOLS-1&&y<DROWS-1?T.FLOOR:T.WALL);
  g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
  g.player.loc={x:4,y:5};g.monsters=[];g.dormantMonsters=[];g.items=[];
  const spear=ItemLoader.spawnWeapon('spear',-1,-1);spear.enchantment=0;spear.runicType=undefined;g.player.strength=spear.strengthRequired;
  g.player.inventory.items=[spear];g.player.equippedWeapon=spear;g.player.equippedArmor=null;g.animationEnabled=false;
  for(const x of [5,6]){const m=new Monster(x,5,md.find(d=>d.id==='rat'));m.hp=m.maxHp=200;m.ticksUntilTurn=10000;m.state=0;g.monsters.push(m);}
  g.monsters[0].machineHome=17;const key=ItemLoader.spawnKey('iron_key',-1,-1);key.originDepth=g.depth;
  key.keyLoc=[{loc:{x:8,y:5},machine:17,disposableHere:false}];g.monsters[0].carriedItem=key;g.update();
 });
 await saveReload();
 await page.keyboard.press('ArrowRight');
 await page.waitForTimeout(300);
 const attack=await page.evaluate(()=>({hp:window.activeGame.monsters.map(m=>m.hp),
  flags:window.activeGame.player.equippedWeapon.flags,key:window.activeGame.monsters[0].carriedItem.keyLoc,
  text:JSON.parse(window.render_game_to_text())}));
 assert.ok(attack.hp.every(hp=>hp<200));assert.equal(attack.key[0].disposableHere,false);
 states.push({name:'restored-spear-penetrates',...attack});
 await page.screenshot({path:`${dir}/browser-penetration.png`});
 await page.evaluate(()=>{const g=window.activeGame;g.monsters[0].hp=0;g.removeDeadMonsters();g.needsRender=true;g.update();});
 await page.waitForTimeout(500);
 const drop=await page.evaluate(()=>({items:window.activeGame.items.map(i=>({id:i.id,originDepth:i.originDepth,keyLoc:i.keyLoc})),text:JSON.parse(window.render_game_to_text())}));
 assert.equal(drop.items.length,1);assert.equal(drop.items[0].keyLoc[0].disposableHere,false);
 states.push({name:'restored-carrier-death',...drop});
 await page.screenshot({path:`${dir}/browser-drop.png`});
 assert.deepEqual(errors,[]);
} finally {
 fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');
 await browser.close();
}
