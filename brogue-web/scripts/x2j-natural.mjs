import fs from 'node:fs';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5196');
 const result=await page.evaluate(async()=>{
  const {activeGame:g}=await import('/src/engine/Core/Game.ts');
  const {TerrainType:T}=await import('/src/engine/Map/Grid.ts');
  const {entrancementDiagonalBlocked}=await import('/src/engine/Movement/Entrancement.ts');
  const {logger}=await import('/src/engine/Systems/Logger.ts');
  const {cellTerrainFlags}=await import('/src/engine/Map/DungeonFeature.ts');
  const {T_PATHING_BLOCKER}=await import('/src/engine/Map/TerrainCatalog.ts');
  const results=[], distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  function nextStep(goal) {
   const queue=[{p:{...g.player.loc},first:null}],seen=new Set([`${g.player.x},${g.player.y}`]);
   for(let i=0;i<queue.length;i++) {
    const {p,first}=queue[i];
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
     const q={x:p.x+dx,y:p.y+dy}, key=`${q.x},${q.y}`,cell=g.grid.getCell(q.x,q.y);
     if(seen.has(key)||!cell?.isPassable||(cellTerrainFlags(g.grid,q.x,q.y)&T_PATHING_BLOCKER)||entrancementDiagonalBlocked(g.grid,p,q))continue;
     seen.add(key);const step=first??{x:dx,y:dy};if(distance(q,goal)===0)return step;queue.push({p:q,first:step});
    }
   }
   return null;
  }
  for(const seed of [20260927,11,424242,42,9,2712,12345]) {
   g.startNewGame({seed,mode:'normal'});g.animationEnabled=false;
   const actions=[], phases=[];let m,stolen=null,recovered=false;
   for(let i=0;i<360 && !g.isGameOver && !recovered;i++) {
    if(g.depth===2&&!m)m=g.monsters.find(m=>m.typeId==='monkey'&&!m.isCaged&&!m.isAlly);
    if(g.depth===2&&!m){phases.push({event:'no monkey',step:i});break;}
    if(m?.carriedItem&&!stolen){stolen={id:m.carriedItem.id,q:m.carriedItem.quantity,name:m.carriedItem.name,identity:m.carriedItem.identityId??m.carriedItem.consumableId};phases.push({event:'stolen',step:i,player:{...g.player.loc},monster:{...m.loc},state:m.state,mode:m.creatureMode,hp:g.player.hp,stolen});}
    const drop=stolen&&g.items.find(it=>it.id===stolen.id);
    if(m?.hp<=0&&!phases.some(p=>p.event==='dead'))phases.push({event:'dead',step:i,drop:drop&&{...drop.loc},player:{...g.player.loc}});
    if(stolen&&m.hp<=0&&!drop&&g.player.inventory.items.some(it=>(it.identityId??it.consumableId)===stolen.identity)){recovered=true;phases.push({event:'recovered',step:i});break;}
    let action='wait',data,goal;
    const threat=g.monsters.find(other=>other!==m&&!other.isAlly&&!other.isCaged&&other.hp>0&&distance(g.player.loc,other.loc)<=1&&!entrancementDiagonalBlocked(g.grid,g.player.loc,other.loc));
    if(threat) {action='move';data={x:threat.x-g.player.x,y:threat.y-g.player.y};}
    else {
     if(g.depth===1) {goal=g.grid.cells.flat().find(c=>c.layers.includes(T.STAIRS_DOWN));if(goal&&distance(g.player.loc,goal)===0)action='stairs_down';}
     else if(drop) {goal=drop.loc;if(distance(goal,g.player.loc)===0)action='pickup';}
     else if(m&&(stolen||distance(g.player.loc,m.loc)>1))goal=m.loc;
     if(goal&&distance(goal,g.player.loc)!==0){data=nextStep(goal);if(!data){phases.push({event:'no path',step:i,goal});break;}action='move';}
    }
    const dart=g.player.inventory.items.find(it=>it.identityId==='dart');
    if(stolen&&m.hp>0&&dart&&g.grid.getCell(m.x,m.y).isVisible&&distance(g.player.loc,m.loc)<=8&&distance(g.player.loc,m.loc)>1) {
     action='throw_at';data={letter:dart.inventoryLetter,x:m.x,y:m.y};
     g.throwItemAt(dart,m.x,m.y);
    } else g.handlePlayerAction(action,data,'system');
    actions.push({action,data,depth:g.depth,player:{...g.player.loc},hp:g.player.hp,monkey:m&&{...m.loc},monsterHp:m?.hp,state:m?.state,carried:m?.carriedItem?.id??null});
   }
   results.push({seed,actions,phases,stolen,recovered,gameOver:g.isGameOver,messages:logger.messages});
   if(recovered)break;
  }
  return results;
 });
 fs.writeFileSync('ai_docs/reports/x2j-evidence/natural-actions.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.map(r=>({...r,actions:r.actions.length,messages:r.messages.slice(-4)}))));
} finally {await browser.close();}
