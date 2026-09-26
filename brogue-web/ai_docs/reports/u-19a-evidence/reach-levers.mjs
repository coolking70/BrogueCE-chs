import {chromium} from 'playwright';import fs from 'node:fs';import assert from 'node:assert/strict';
const out='ai_docs/reports/u-19a-evidence',results=[],errors=[];const browser=await chromium.launch({headless:false});
try{
const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));
await page.goto('http://127.0.0.1:5199');await page.locator('.menu-card .actions button').first().click();await page.waitForFunction(()=>!!window.activeGame?.onRenderRequested);
for(const ce of [18,36,38,55]){
const result=await page.evaluate(async ce=>{
const {machineScene,observeFromOrigin}=await import('/src/test/fixtures/u19a-machine-scenes.ts');const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');const {terrainFlagsOfCell}=await import('/src/engine/Map/DungeonFeature.ts');const {T_PATHING_BLOCKER}=await import('/src/engine/Map/TerrainCatalog.ts');
const g=window.activeGame;g.startNewGame({seed:19,mode:'test'});const s=machineScene(g,ce,[36,38].includes(ce)?2:1);observeFromOrigin(g,s,false);const removedOrdinary=g.monsters.filter(m=>m.machineHome!==s.result.machineNumber).map(m=>({id:m.id,name:m.name}));g.monsters=g.monsters.filter(m=>m.machineHome===s.result.machineNumber);const target=s.snapshots[0].placements[0],actions=[],origin={...g.player.loc};
const adjacent=p=>Math.max(Math.abs(p.x-target.x),Math.abs(p.y-target.y))===1;
for(let step=0;step<150&&!adjacent(g.player.loc);step++){
const q=[{...g.player.loc,path:[]}],seen=new Set([g.player.y*79+g.player.x]);let route;
for(let j=0;j<q.length&&!route;j++){
const p=q[j];if(adjacent(p)){route=p.path;break;}
for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]){const x=p.x+dx,y=p.y+dy,k=y*79+x,c=g.grid.getCell(x,y);if(!c||seen.has(k)||!g.canMoveTo(x,y)||(terrainFlagsOfCell(c)&T_PATHING_BLOCKER))continue;seen.add(k);q.push({x,y,path:[...p.path,{x:dx,y:dy}]});}
}
if(!route?.length)break;const before={...g.player.loc};g.handlePlayerAction('move',route[0],'system');actions.push({action:'move',data:route[0],before,after:{...g.player.loc}});
}
let searches=0;while(adjacent(g.player.loc)&&g.grid.getCell(target.x,target.y).layers[0]===T.WALL_LEVER_HIDDEN&&searches<60){g.handlePlayerAction('search',undefined,'system');searches++;}
g.updateVision();g.update();g.onRenderRequested();return {ce,origin,target,removedOrdinary,premise:'CE forbiddenFlags=0: retain machine residents, isolate terrain reach from unrelated population',actions,searches,final:{...g.player.loc},adjacent:adjacent(g.player.loc),revealed:g.grid.getCell(target.x,target.y).layers[0]===T.WALL_LEVER,visible:g.grid.getCell(target.x,target.y).isVisible,text:JSON.parse(window.render_game_to_text())};
},ce);results.push(result);console.log(ce,result.adjacent,result.revealed,result.actions.length,result.searches);await page.screenshot({path:`${out}/browser-lever-ce${ce}.png`});
}
fs.writeFileSync(`${out}/lever-reach.json`,JSON.stringify({results,errors},null,2)+'\n');assert(results.every(r=>r.adjacent&&r.revealed&&r.visible));assert.deepEqual(errors,[]);
}finally{await browser.close();}
