import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='ai_docs/reports/u-04c-evidence',errors=[];
function first(a,b,p='') { if(JSON.stringify(a)===JSON.stringify(b))return null; if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const d=first(a[k],b[k],p+'/'+k);if(d)return d;}return null;}return {path:p,actual:a,expected:b};}
const equal=(a,b,label)=>{const d=first(a,b);if(d)throw Error(label+': '+JSON.stringify(d));};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5196');
 await page.locator('.menu-card input[type=text]').fill('424242');
 const buttons=()=>page.locator('.menu-card .actions').first().locator('button');
 await buttons().first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 const setup=()=>page.evaluate(async()=>{
  const {TerrainType}=await import('/src/engine/Map/Grid.ts');
  window.u04cTravel=up=>{
   const g=window.activeGame;g.animationEnabled=false;
   const c=g.toSnapshot().grid.find(c=>c.layers.includes(up?TerrainType.STAIRS_UP:TerrainType.STAIRS_DOWN));
   if(!c)throw Error('Missing stairs');g.player.loc={x:c.x,y:c.y};
   g.handlePlayerAction(up?'stairs_up':'stairs_down',undefined,'system');g.update();
   g.handlePlayerAction('wait',undefined,'system');g.update();
  };
  window.u04cState=()=>{const s=JSON.parse(JSON.stringify(window.activeGame.toSnapshot()));delete s.savedAt;delete s.run.logger;return s;};
 });
 await setup();await page.evaluate(()=>window.u04cTravel(false));await page.waitForTimeout(350);
 let before=await page.evaluate(()=>window.u04cState());
 assert.equal(before.depth,2);assert.equal(before.machineCells.length,15);
 const check=s=>[s,...s.levels].map(level=>{
  const expected=level.grid.filter(c=>c.machineNumber!==0).map(c=>c.y*level.width+c.x).sort((a,b)=>a-b);
  assert.deepEqual([...level.machineCells].sort((a,b)=>a-b),expected);
  return {depth:level.depth,machineCells:expected.length};
 });
 check(before);
 await page.locator('.menu-btn').click();await buttons().nth(2).click();
 await page.waitForFunction(async()=>!!await(await import('/src/engine/Core/SaveStorage.ts')).readSaveSummary());
 before=await page.evaluate(async()=>{const s=await(await import('/src/engine/Core/SaveStorage.ts')).readSnapshot();delete s.savedAt;delete s.run.logger;return s;});
 await page.evaluate(()=>window.u04cTravel(true));await page.waitForTimeout(350);const direct=await page.evaluate(()=>window.u04cState());
 await page.reload();await setup();await page.waitForFunction(()=>[...document.querySelectorAll('.menu-card .actions button')][1]?.disabled===false);
 await buttons().nth(1).click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
 await page.waitForTimeout(350);const loaded=await page.evaluate(()=>window.u04cState());equal(loaded,before,'checkpoint');
 await page.waitForTimeout(300);await page.screenshot({path:`${dir}/browser-loaded-d2.png`});
 await page.evaluate(()=>window.u04cTravel(true));await page.waitForTimeout(350);const returned=await page.evaluate(()=>window.u04cState());equal(returned,direct,'return D1');
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);
 const text=await page.evaluate(()=>JSON.parse(window.render_game_to_text()));
 await page.screenshot({path:`${dir}/browser-return-d1.png`});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({seed:424242,saved:check(before),loaded:check(loaded),returned:check(returned),
  checkpointSHA256:hash(loaded),continuousReturnSHA256:hash(direct),resumedReturnSHA256:hash(returned),
  saveReloadWholeStateExceptMenuLogs:true,errors,text},null,2)+'\n');
 console.log('Browser save/reload/continue and D1 return passed.');
}finally{await browser.close();}
