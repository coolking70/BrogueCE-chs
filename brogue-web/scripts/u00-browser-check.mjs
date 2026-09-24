import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-00-evidence';
const browser=await chromium.launch({headless:false});
const errors=[], states=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5195');
 await page.locator('select').nth(1).selectOption('stretch');
 await page.locator('select').nth(2).selectOption('proportional');
 const start=async seed=>{
  await page.locator('.menu-card input[type=text]').fill(String(seed));
  await page.locator('.menu-card .actions').first().locator('button').first().click();
  await page.waitForFunction(()=>!!window.render_game_to_text && !!window.activeGame.onRenderRequested);
 };
 const capture=async name=>{
  await page.waitForTimeout(200);
  const s=await page.evaluate(()=>({text:JSON.parse(window.render_game_to_text()),stats:{...window.activeGame.stats},
   over:window.activeGame.isGameOver,reason:window.activeGame.gameOverReason,seed:window.activeGame.currentSeed,
   inspect:window.activeGame.inspectTarget,bolt:window.activeGame.pendingBoltFrames.length,
   locked:window.activeGame.isInputLocked(),replay:window.activeGame.replayCursor,
   display:JSON.parse(localStorage.getItem('brogue-web-display-v1'))}));
  assert.deepEqual(s.display,{mapScaleMode:'stretch',sidebarWidthMode:'proportional'});
  assert.equal(s.over,false);assert.equal(s.locked,false);assert.equal(s.bolt,0);assert.equal(s.inspect,null);
  states.push({name,...s});await page.screenshot({path:`${dir}/browser-${name}.png`});return s;
 };
 await start(777);
 await page.keyboard.press('.');
 await page.evaluate(()=>{const g=window.activeGame;g.stats.gold=987;g.stats.kills=12;g.stats.maxDepth=18;});
 await page.locator('.menu-btn').click();await start(12345);
 let s=await capture('menu-new');assert.deepEqual(s.stats,{kills:0,gold:0,turns:0,maxDepth:1});
 // Actual return-to-title UI, through both normal victory and death overlays.
 for(const won of [true,false]) {
  await page.evaluate(won=>{const g=window.activeGame;g.stats.gold=987;g.stats.kills=12;
   if(!won)g.player.hp=0;g.lastDamageSource='U00 fixture';g.triggerGameOver(won);g.update();},won);
  await page.locator('.return-btn').click();await start(12345);
  s=await capture(won?'title-new':'death-new');assert.deepEqual(s.stats,{kills:0,gold:0,turns:0,maxDepth:1});
 }
 const recording={version:1,recordedAt:1234,seed:12345,mode:'normal',startDepth:1,
  events:Array.from({length:3},(_,index)=>({index,tick:index*100,depth:1,player:{x:0,y:0},action:'wait',data:null}))};
 await page.locator('.menu-btn').click();
 await page.locator('input[type=file]').setInputFiles({name:'u00.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recording))});
 await page.waitForFunction(()=>window.activeGame.replayRecording!==null);
 // Existing App.replayInfo is a computed over a non-reactive singleton: its
 // initial null is cached. Record this U27/UI issue, then load from the title
 // so ReplayControls mounts with the recording already installed.
 await page.locator('.menu-btn').click();
 const appReplayControlsVisible=await page.locator('.save-meta input[type=number]').count();
 states.push({name:'existing-app-replay-menu',controls:appReplayControlsVisible});
 await page.reload();
 await page.locator('.menu-card .actions').nth(1).locator('button').first().click();
 await page.waitForFunction(()=>!!window.render_game_to_text);
 await page.evaluate(()=>{const g=window.activeGame;g.stats.gold=987;g.isGameOver=true;g.replayRestart();});
 s=await capture('replay-restart');assert.equal(s.replay,0);assert.equal(s.stats.gold,0);
 await page.locator('.replay-controls .slider').evaluate(input=>{input.value='2';input.dispatchEvent(new Event('input',{bubbles:true}));});
 s=await capture('replay-seek-two-observation');
 // Positive seek can stop at 1 while animation owns the turn: an existing U27
 // issue, recorded without changing playback timing in this lifecycle fix.
 states.push({name:'existing-animated-seek',requested:2,actual:s.replay});
 await page.locator('.replay-controls .slider').evaluate(input=>{input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));});
 s=await capture('replay-seek-zero');assert.equal(s.replay,0);assert.deepEqual(s.stats,{kills:0,gold:0,turns:0,maxDepth:1});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${dir}/browser.json`,JSON.stringify({states,errors},null,2)+'\n');
 console.log('Menu, title, death, engine restart / ReplayControls seek and persistent display settings passed.');
} finally { await browser.close(); }
