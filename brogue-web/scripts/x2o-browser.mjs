import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const out='ai_docs/reports/x2o-evidence';
const browser=await chromium.launch({headless:false});
const errors=[],rows=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5207');
 await page.locator('.menu-card input[type=text]').fill('424242');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 for(const type of ['GOLEM','KRAKEN']){
  const result=await page.evaluate(async(type)=>{
   const g=window.activeGame,{TerrainType:T}=await import('/src/engine/Map/Grid.ts'),{rng}=await import('/src/engine/Random.ts'),{default:hordes}=await import('/src/data/hordes.json');
   g.animationEnabled=false;g.depth=30;g.generateDepth(false,false);g.monsters=[];g.dormantMonsters=[];g.items=[];g.player.loc={x:35,y:13};g.player.hp=g.player.maxHp=10000;
   for(let x=24;x<48;x++)for(let y=5;y<23;y++){const c=g.grid.getCell(x,y);c.layers.fill(T.NOTHING);g.grid.setTerrain(x,y,T.FLOOR);c.machineNumber=0;}
   if(type==='KRAKEN')for(let x=34;x<42;x++)for(let y=9;y<19;y++)g.grid.setTerrain(x,y,T.WATER_DEEP);
   const h=hordes.find(h=>h.leader===type&&h.minLevel===30),counts=[],original=rng.randClumpedRange.bind(rng);
   rng.randClumpedRange=(...args)=>{const before=rng.getState(),value=original(...args);counts.push({args,value,draws:rng.getState().randomNumbersGenerated-before.randomNumbersGenerated});return value;};
   try{g.spawnHordeAt(h,{x:36,y:14},30,false);}finally{rng.randClumpedRange=original;}
   g.player.applyStatus('levitating',100);g.player.applyStatus('telepathy',100);g.updateVision();g.needsRender=true;g.onRenderRequested();
   return {type,counts,monsters:g.monsters.map(m=>({id:m.id,type:m.typeId,loc:m.loc,leader:m.leader?.id??null})),text:JSON.parse(window.render_game_to_text())};
  },type);
  assert.equal(result.counts.length,1);assert.deepEqual(result.counts[0].args,[5,10,2]);assert.equal(result.counts[0].draws,2);assert.equal(result.monsters.length,1+result.counts[0].value);
  await page.waitForTimeout(250);await page.screenshot({path:`${out}/browser-${type.toLowerCase()}.png`});rows.push(result);
  // Verify a real UI turn and snapshot round-trip after the spawn.
  await page.keyboard.press('.');await page.waitForFunction(()=>!window.activeGame.isAdvancing);
  const roundtrip=await page.evaluate(()=>{const g=window.activeGame,s=g.toSnapshot();s.savedAt=0;const ok=g.loadSnapshot(JSON.parse(JSON.stringify(s))),after=g.toSnapshot();after.savedAt=0;const diff=(a,b,p='')=>JSON.stringify(a)===JSON.stringify(b)?[]:a&&b&&typeof a==='object'&&typeof b==='object'?[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],p+'/'+k)):[{path:p,before:a,after:b}];return {ok,equal:JSON.stringify(s)===JSON.stringify(after),differences:diff(s,after),text:JSON.parse(window.render_game_to_text())};});
  rows.push({type,afterWaitAndReload:roundtrip});assert.equal(roundtrip.ok,true);assert.deepEqual(roundtrip.differences,[]);
 }
 assert.deepEqual(errors,[]);
}finally{fs.writeFileSync(`${out}/browser.json`,JSON.stringify({errors,rows},null,2)+'\n');await browser.close();}
