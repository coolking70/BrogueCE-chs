import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = '/tmp/x3-u8a-evidence', errors = [], results = [];
const browser = await chromium.launch({ headless: false });
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 page.on('pageerror', e => errors.push(String(e)));
 page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
 await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
 await page.goto('http://127.0.0.1:5186');
 await page.locator('.menu-card input[type=text]').fill('33008');
 await page.locator('.menu-card .actions button').first().click();
 await page.waitForFunction(() => !!window.activeGame?.onRenderRequested && !!window.render_game_to_text);
 await page.evaluate(async () => {
  const { TerrainType: T } = await import('/src/engine/Map/Grid.ts');
  const { GasType } = await import('/src/engine/Environment/Gas.ts');
  const { logger } = await import('/src/engine/Systems/Logger.ts');
  const { rng } = await import('/src/engine/Random.ts');
  const { Monster, MonsterState } = await import('/src/entities/Monster.ts');
  const monsters = (await import('/src/data/monsters.json')).default;
  window.u8room = () => {
   const g = window.activeGame;
   g.monsters = []; g.dormantMonsters = []; g.items = [];
   g.player.loc = {x:10,y:10}; g.player.statusDurations = {}; g.player.maxStatus = {};
   g.player.hp = g.player.maxHp = 1000; g.player.inventory.items = [];
   g.player.equippedWeapon = null; g.player.equippedArmor = null;
   g.player.refreshSpeeds(); g.player.ticksUntilTurn = 0; g.ticksTillUpdateEnvironment = 100;
   for (let x=0;x<g.grid.width;x++) for (let y=0;y<g.grid.height;y++) {
    g.grid.setTerrain(x,y,x>=4&&x<=30&&y>=4&&y<=20?T.FLOOR:T.GRANITE);
    const c=g.grid.getCell(x,y); Object.assign(c,{autoSearched:true,hasMemory:true,isExplored:true,rememberedLayers:[...c.layers]});
   }
   logger.reset(); g.disturbed=false;
   g.updateVision(); g.needsRender=true; g.update();
  };
  window.u8reset = () => { window.activeGame.startNewGame({seed:33008,mode:'test'}); window.u8room(); window.activeGame.animationEnabled=true; };
  window.u8read = () => {
   const g=window.activeGame,r=rng.getState();
   return { player:{...g.player.loc},hp:g.player.hp,paralyzed:g.player.getStatusDuration('paralyzed'),
    turns:g.stats.turns,objective:g.absoluteTurnNumber,events:g.exportRecording().events,
    rng:r.streams[0],draws:r.randomNumbersGenerated,messages:logger.messages.map(m=>m.text),
    text:JSON.parse(window.render_game_to_text()) };
  };
  window.u8tools={GasType,logger,Monster,MonsterState,monsters};
 });
 const read=()=>page.evaluate(()=>window.u8read());
 const settle=()=>page.waitForFunction(()=>!window.activeGame.isAdvancing);
 await page.evaluate(()=>{
  window.u8reset();const g=window.activeGame,{Monster,MonsterState,monsters}=window.u8tools;
  const rat=new Monster(11,10,monsters.find(m=>m.id==='rat'));rat.state=MonsterState.HUNTING;rat.ticksUntilTurn=100;
  g.monsters.push(rat);g.player.setStatusDuration('paralyzed',5);g.needsRender=true;g.update();
 });
 await page.keyboard.press('ArrowRight');await settle();
 let s=await read();assert.deepEqual(s.player,{x:10,y:10});assert.equal(s.turns,5);assert.equal(s.paralyzed,0);
 assert.equal(s.events.length,1);assert.ok(s.hp<1000);assert.ok(!s.messages.some(m=>/无法行动|cannot act/.test(m)));
 assert.equal(s.text.player.statuses.paralyzed??0,0);
 await page.screenshot({path:`${out}/browser-paralysis-recovered.png`});results.push({scene:'one key, five turns, rat attacks',state:s});

 await page.evaluate(()=>{window.u8reset();window.activeGame.environment.addGas(10,10,window.u8tools.GasType.PARALYSIS,1);});
 await page.keyboard.press('Period');await settle();
 s=await read();assert.equal(s.paralyzed,0);assert.ok(s.turns>1);assert.equal(s.events.length,1);
 assert.equal(s.events[0].turn,s.objective);
 const ack=page.locator('.message-ack');if(await ack.count())await ack.locator('button').click();
 assert.equal((await read()).events.length,1);
 await page.screenshot({path:`${out}/browser-gas-recovered.png`});results.push({scene:'animated gas onset drains within wait, acknowledgment adds no command',state:s});
 const replay=await page.evaluate(()=>{
  const g=window.activeGame,rec=g.exportRecording(),start=g.startNewGame.bind(g);
  g.startNewGame=options=>{start(options);window.u8room();g.environment.addGas(10,10,window.u8tools.GasType.PARALYSIS,1);};
  g.loadReplay(rec);g.replayStep(true);while(g.isAdvancing)g.stepAdvancement();
  const a={cursor:g.replayCursor,error:g.replayError};g.replaySeek(1);
  const b={cursor:g.replayCursor,error:g.replayError};g.startNewGame=start;return {animated:a,seek:b};
 });
 assert.deepEqual(replay,{animated:{cursor:1,error:null},seek:{cursor:1,error:null}});results.push({scene:'browser replay and seek',...replay});

 const keys=['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'];
 async function walk(hallucinating) {
  await page.evaluate(h=>{window.u8reset();if(h)window.activeGame.player.setStatusDuration('hallucinating',100);},hallucinating);
  const trace=[];
  for(let i=0;i<40;i++){
   await page.keyboard.press(keys[i%4]);await settle();
   const r=await read();trace.push({player:r.player,rng:r.rng,draws:r.draws});
  }
  return trace;
 }
 const sober=await walk(false),hallucinated=await walk(true);
 assert.deepEqual(hallucinated,sober);s=await read();assert.equal(s.events.length,40);
 assert.ok(!s.messages.some(m=>/踉跄|stumble in a random/.test(m)));
 await page.screenshot({path:`${out}/browser-hallucination.png`});results.push({scene:'40 real movement keys under hallucination match sober directions and substantive RNG',trace:hallucinated,state:s});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2)+'\n');
 console.log(`${results.length} browser scenarios passed; zero page/console errors`);
} finally { await browser.close(); }
