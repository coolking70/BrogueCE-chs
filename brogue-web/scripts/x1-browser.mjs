import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const evidence=path.join(root,'ai_docs/reports/x-1-evidence');
const {project}=JSON.parse(fs.readFileSync(path.join(evidence,'validation-stage.json')));
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(project,'node_modules/playwright'));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5189','--strictPort'],{cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']});
const serverLog=fs.createWriteStream(path.join(evidence,'browser-server.txt'));
server.stdout.on('data',b=>serverLog.write(b.toString().replaceAll('\r\n','\n')));
server.stderr.on('data',b=>serverLog.write(b.toString().replaceAll('\r\n','\n')));
let browser;
const result={scope:'New isolated browser context against unmodified source copy; no user storage used',errors:[],consoleErrors:[]};
try {
  for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:5189');if(r.ok)break;}catch{} await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  page.on('pageerror',e=>result.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
  await page.goto('http://127.0.0.1:5189');
  await page.locator('.menu-card').waitFor();
  result.menuText=await page.locator('.menu-card').innerText();
  await page.locator('input[inputmode="numeric"]').fill('424242');
  await page.getByRole('button',{name:'新游戏',exact:true}).click();
  await page.locator('.menu-card').waitFor({state:'hidden'});
  await page.waitForTimeout(1500);
  await page.screenshot({path:path.join(evidence,'browser-game.png')});
  result.gameText=await page.locator('body').innerText();
  await page.keyboard.press('Shift+D');
  await page.waitForTimeout(500);
  result.discoveryText=await page.locator('body').innerText();
  await page.screenshot({path:path.join(evidence,'browser-discoveries.png')});
  await page.keyboard.press('Escape');
  await page.keyboard.press('i');
  await page.waitForTimeout(500);
  result.inventoryText=await page.locator('body').innerText();
  await page.screenshot({path:path.join(evidence,'browser-inventory.png')});
  await page.keyboard.press('Escape');
  // Public existing game interface in a disposable context; output state only.
  result.replay=await page.evaluate(async()=>{
    const {activeGame:g}=await import('/src/engine/Core/Game.ts');
    const {rng}=await import('/src/engine/Random.ts');
    const {timeSystem}=await import('/src/engine/Systems/Time.ts');
    g.handlePlayerAction('wait');g.handlePlayerAction('wait');
    const recording=g.exportRecording();const accepted=g.loadReplay(recording);g.replaySeek(recording.events.length);
    return {accepted,events:recording.events.length,cursor:g.replayCursor,error:g.replayError,recording,
      actual:{tick:timeSystem.currentTick,depth:g.depth,player:{...g.player.loc},turn:g.absoluteTurnNumber,rng:rng.getState()}};
  });
  result.freshReplay=await page.evaluate(async()=>{
    const {activeGame:g}=await import('/src/engine/Core/Game.ts');
    const {rng}=await import('/src/engine/Random.ts');
    const {timeSystem}=await import('/src/engine/Systems/Time.ts');
    g.startNewGame({seed:'424242',mode:'normal'});g.animationEnabled=false;
    g.handlePlayerAction('wait');g.handlePlayerAction('wait');
    const recording=g.exportRecording();g.loadReplay(recording);g.replaySeek(recording.events.length);
    return {events:recording.events.length,cursor:g.replayCursor,error:g.replayError,recording,
      actual:{tick:timeSystem.currentTick,depth:g.depth,player:{...g.player.loc},turn:g.absoluteTurnNumber,rng:rng.getState()}};
  });
  await page.evaluate(async()=>{
    const {activeGame:g}=await import('/src/engine/Core/Game.ts');
    g.startNewGame({seed:'424242',mode:'normal'});g.animationEnabled=true;
    g.handlePlayerAction('wait');
  });
  await page.waitForFunction(async()=>{
    const {activeGame:g}=await import('/src/engine/Core/Game.ts');
    return !g.isAdvancing;
  });
  await page.waitForTimeout(500);
  result.animatedReplay=await page.evaluate(async()=>{
    const {activeGame:g}=await import('/src/engine/Core/Game.ts');
    const recording=g.exportRecording();const settledTurn=g.absoluteTurnNumber;
    g.loadReplay(recording);g.replaySeek(recording.events.length);
    return {settledTurn,events:recording.events.length,cursor:g.replayCursor,error:g.replayError,recording};
  });
  result.completed=true;
} catch(e) {result.failure=String(e);}
finally {
  if(browser)await browser.close();
  server.kill();serverLog.end();
  fs.writeFileSync(path.join(evidence,'browser-observations.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({completed:result.completed,failure:result.failure,errors:result.errors,
    replay:result.replay&&{events:result.replay.events,cursor:result.replay.cursor,error:result.replay.error},
    freshReplay:result.freshReplay&&{events:result.freshReplay.events,cursor:result.freshReplay.cursor,error:result.freshReplay.error},
    animatedReplay:result.animatedReplay&&{settledTurn:result.animatedReplay.settledTurn,events:result.animatedReplay.events,cursor:result.animatedReplay.cursor,error:result.animatedReplay.error}}));
}
