// Real page + existing text hook. Explicit protection config stays outside the pool.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/w-15-evidence';
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[], states=[];
 page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5179'); await page.locator('select').first().selectOption('test');
 await page.locator('.actions button').first().click(); await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(async()=>{
  const { Grid,TerrainType:T }=await import('/src/engine/Map/Grid.ts');
  const { EnvironmentManager }=await import('/src/engine/Environment/Gas.ts');
  const { Monster }=await import('/src/entities/Monster.ts');
  const { default:monsters }=await import('/src/data/monsters.json');
  const { ItemLoader }=await import('/src/engine/Items/ItemLoader.ts');
  const { LightMap }=await import('/src/engine/Lighting/LightMap.ts');
  const { FOVSys }=await import('/src/engine/Lighting/FOV.ts');
  const g=window.activeGame; g.grid=new Grid(g.grid.width,g.grid.height);
  for(let x=0;x<g.grid.width;x++) for(let y=0;y<g.grid.height;y++) {
   g.grid.setTerrain(x,y,x>0&&x<16&&y>0&&y<12?T.FLOOR:T.GRANITE);
   Object.assign(g.grid.getCell(x,y),{isVisible:true,hasMemory:true});
  }
  g.lightMap=new LightMap(g.grid);g.fov=new FOVSys(g.grid);g.environment=new EnvironmentManager(g.grid);
  g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.player.maxShield=0;g.player.ticksUntilTurn=0;
  g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;
  g.items=[];g.monsters=[];g.dormantMonsters=[];g.floatingTexts=[];g.pendingBoltFrames=[];g.player.inventory.items=[];
  g.autoPath=[];g.isMouseTraveling=false;
  const caster=new Monster(8,5,monsters.find(m=>m.id==='goblin_mystic'));caster.hp=caster.maxHp=100;caster.isAlly=true;caster.ticksUntilTurn=100000;g.monsters.push(caster);
  g.castMonsterBolt(caster,g.player,'SHIELDING');
  window.w15Caster=caster;window.w15Item=ItemLoader.spawnStaff('staff_of_light',-1,-1);
  window.w15Item.enchantment=3;window.w15Item.charges=2;g.player.inventory.addItem(window.w15Item);
  g.updateVision();g.needsRender=true;
 });
 const capture=async name=>{
  await page.waitForTimeout(800);await page.evaluate(()=>{window.activeGame.needsRender=true;});await page.waitForTimeout(120);
  const state=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));
  states.push({name,state});await page.screenshot({path:`${dir}/browser-${name}.png`,fullPage:true});return state;
 };
 let s=await capture('monster-shield');assert.equal(s.player.statuses.shielded,356);assert.equal(s.player.maxShield,356);assert.equal(s.player.statuses.telepathy,undefined);
 assert.match(await page.locator('.status-tags').innerText(),/35.6 HP/);
 await page.evaluate(()=>{window.activeGame.player.takeDamage(7);window.activeGame.needsRender=true;});
 s=await capture('absorbed');assert.equal(s.player.hp,100);assert.equal(s.player.statuses.shielded,286);
 await page.keyboard.press('.');s=await capture('decayed');assert.equal(s.player.statuses.shielded,269);
 await page.evaluate(()=>{const g=window.activeGame;g.player.addPoison(2,3);g.resolvePoisonDamage(g.player);g.needsRender=true;});
 s=await capture('poison-bypass');assert.equal(s.player.hp,97);assert.equal(s.player.statuses.shielded,269);
 // Cancel then submit the retired existing SHIELDING item via keyboard input.
 await page.evaluate(()=>window.activeGame.useArcanaItem(window.w15Item));await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.w15Item.charges),2);
 await page.evaluate(()=>{const g=window.activeGame;g.useArcanaItem(window.w15Item);g.setArcanaTarget(8,5);});
 await capture('targeting');await page.keyboard.press('Enter');s=await capture('player-shields-ally');
 assert.equal(await page.evaluate(()=>window.w15Item.charges),1);
 assert.equal(s.monsters[0].shield,172);assert.equal(s.monsters[0].maxShield,181);assert.equal(s.player.statuses.telepathy,undefined);
 await page.evaluate(()=>{const g=window.activeGame;window.w15Caster.takeDamage(20);g.player.takeDamage(100);g.needsRender=true;});
 s=await capture('shield-break');assert.equal(s.monsters[0].shield,0);assert.equal(s.monsters[0].maxShield,0);assert.equal(s.monsters[0].hp,98);
 fs.writeFileSync(`${dir}/browser-states.json`,JSON.stringify({states,errors},null,2)+'\n');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({scenarios:states.map(s=>s.name),errors}));
}finally{await browser.close();}
