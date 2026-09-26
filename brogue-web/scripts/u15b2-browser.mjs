import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const out='ai_docs/reports/u-15b2-evidence',rows=[],errors=[];
const browser=await chromium.launch({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card input[type=text]').fill('1532');await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const read=()=>page.evaluate(()=>{const g=window.activeGame;return {light:g.minersLight,visible:g.grid.cells.flat().filter(c=>c.isVisible).length,rings:g.player.rings().map(i=>({id:i.identityId,e:i.enchantment,known:i.identified,charges:i.charges})),resources:g.player.inventory.items.map(i=>({kind:i.identityId,e:i.enchantment,charges:i.charges,remaining:i.staffRechargeRemaining,cooldown:i.cooldownRemaining})),monster:g.monsters.map(m=>({hp:m.hp,shield:m.getStatusDuration('shielded')})),text:JSON.parse(window.render_game_to_text())};});
 async function setup(kind,e){return page.evaluate(async({kind,e})=>{
  const {ItemLoader}=await import('/src/engine/Items/ItemLoader.ts');const {rng}=await import('/src/engine/Random.ts');const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const {Monster,MonsterState}=await import('/src/entities/Monster.ts');const {default:monsters}=await import('/src/data/monsters.json');
  const g=window.activeGame;g.startNewGame({seed:1532,mode:'test'});g.depth=26;g.generateDepth(false,false);g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;g.onConfirmRequest=()=>true;
  for(const cell of g.grid.cells.flat()){cell.layers.fill(T.NOTHING);g.grid.setTerrain(cell.x,cell.y,cell.x>1&&cell.x<70&&cell.y>1&&cell.y<31?T.FLOOR:T.WALL);}
  g.player.loc={x:25,y:16};g.player.inventory.items=[];g.player.ringLeft=g.player.ringRight=null;
  let r;for(let n=1;n<1000;n++){rng.seedRandomGenerator(n);r=ItemLoader.spawnRing('ring_of_'+kind,-1,-1);if(r.enchantment===e)break;}
  if(r.enchantment!==e)throw Error('No natural birth with requested E');g.player.inventory.addItem(r);
  if(kind==='reaping'){
   ItemLoader.identifyInstance(r);g.player.equip(r);
   const weapon=ItemLoader.spawnWeapon('sword',-1,-1);Object.assign(weapon,{enchantment:0,runicType:undefined,damage:'10d1',strengthRequired:12,flags:[],isCursed:false});g.player.equippedWeapon=weapon;g.player.inventory.addItem(weapon);
   const s=ItemLoader.spawnStaff('staff_of_lightning',-1,-1);s.enchantment=s.maxCharges=3;s.charges=2;s.staffRechargeRemaining=500;ItemLoader.identifyInstance(s);g.player.inventory.addItem(s);
   const c=ItemLoader.spawnCharm('charm_of_health',-1,-1);c.cooldownRemaining=10;g.player.inventory.addItem(c);
   const m=new Monster(26,16,monsters.find(m=>m.id==='rat'));m.hp=m.maxHp=4;m.state=MonsterState.HUNTING;m.applyShield(1000);m.applyStatus('paralyzed',10);g.monsters=[m];
  }
  rng.seedRandomGenerator(1);g.updateVision();g.update();g.needsRender=true;g.onRenderRequested?.();return r.id;
 },{kind,e});}
 const ringId=await setup('light',3);rows.push({phase:'light-before',state:await read()});
 const letter=await page.evaluate(id=>window.activeGame.player.inventory.items.find(i=>i.id===id).inventoryLetter,ringId);
 await page.keyboard.press('i');await page.locator('.item-row').filter({has:page.locator('.item-letter',{hasText:letter})}).click();await page.getByRole('button',{name:'装备',exact:true}).click();
 await page.keyboard.press('Escape');await page.waitForTimeout(120);const equipped=await read();rows.push({phase:'light-equipped-unknown',state:equipped});
 assert.equal(equipped.rings[0].known,false);assert(equipped.light.radiusHundredths>rows[0].state.light.radiusHundredths);assert(equipped.visible>rows[0].state.visible);
 await page.screenshot({path:`${out}/browser-light-equipped.png`});
 await page.keyboard.press('i');await page.locator('.item-row').first().click();await page.getByRole('button',{name:'查看详情',exact:true}).click();await page.locator('.detail-overlay').waitFor({state:'visible'});await page.waitForTimeout(400);await page.screenshot({path:`${out}/browser-light-detail.png`});
 assert((await page.locator('body').innerText()).includes('1500')||(await page.locator('body').innerText()).includes('1499'));
 await page.locator('.detail-close').click();await page.getByRole('button',{name:'卸下',exact:true}).click();
 const removed=await read();rows.push({phase:'light-unequipped',state:removed});assert.equal(removed.light.radiusHundredths,rows[0].state.light.radiusHundredths);
 for(const e of [2,-2]){
  await setup('reaping',e);const before=await read();
  const expected=await page.evaluate(()=>{const g=window.activeGame,s=g.toSnapshot();g.handlePlayerAction('move',{x:1,y:0},'system');const result=g.player.inventory.items.map(i=>({kind:i.identityId,e:i.enchantment,charges:i.charges,remaining:i.staffRechargeRemaining,cooldown:i.cooldownRemaining}));if(!g.loadSnapshot(s))throw Error("Snapshot refused");g.animationEnabled=false;g.update();g.onRenderRequested?.();return result;});
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(160);const after=await read();assert.deepEqual(after.resources,expected);
  const staff=after.resources.find(i=>i.kind==='staff_of_lightning'),charm=after.resources.find(i=>i.kind==='charm_of_health');
  assert(e>0?staff.remaining<490:staff.remaining>490);assert(e>0?charm.cooldown<9:charm.cooldown>9);
  rows.push({phase:`reaping-${e}`,before,after});await page.screenshot({path:`${out}/browser-reaping-${e}.png`});
  await page.waitForFunction(()=>!window.activeGame.isInputLocked());await page.keyboard.press('i');await page.waitForTimeout(350);
  fs.writeFileSync(`${out}/inventory-${e}.txt`,await page.locator('body').innerText());await page.screenshot({path:`${out}/browser-inventory-${e}.png`});
  await page.locator('.item-row').filter({hasText:'收割戒指'}).click();await page.getByRole('button',{name:'查看详情',exact:true}).click();await page.locator('.detail-overlay').waitFor({state:'visible'});await page.waitForTimeout(400);await page.screenshot({path:`${out}/browser-reaping-${e}-detail.png`});
  assert((await page.locator('body').innerText()).includes('0–2'));await page.locator('.detail-close').click();await page.locator('.inventory-overlay .close-btn').click();
 }
 assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${out}/browser.json`,JSON.stringify({rows,errors},null,2)+'\n');await browser.close();}
