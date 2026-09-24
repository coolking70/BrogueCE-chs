import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import { createHeadlessGame } from '../src/test/harness';import { rng } from '../src/engine/Random';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const results=[];
for(const seed of ['7','1099511627783','18446744073709551615']){
 const runs=[];
 for(const branch of [0,1]){
  const g:any=createHeadlessGame(7);g.startNewGame({seed});g.animationEnabled=false;g.player.hp=g.player.maxHp=10000;
  const start={...g.player.loc},actions=[];
  for(let i=0;i<6;i++){
   let action='wait',step;
   if(branch){
    if(g.player.loc.x!==start.x||g.player.loc.y!==start.y)action='search';
    else {step=[{x:1,y:0},{x:0,y:-1},{x:-1,y:0},{x:0,y:1}].find(p=>g.canMoveTo(g.player.loc.x+p.x,g.player.loc.y+p.y)&&!g.getMonsterAt(g.player.loc.x+p.x,g.player.loc.y+p.y));action=step?'move':'search';}
   }
   g.handlePlayerAction(action,step,'system');actions.push({action,step,loc:{...g.player.loc},count:rng.randomNumbersGenerated});
  }
  if(branch)for(let i=0;i<257;i++)rng.randRange(0,9999);
  const entryRng=rng.getState(),maps=[];
  for(let depth=2;depth<=26;depth++){
   g.depth=depth;g.generateDepth(false,false);
   maps.push({depth,sha256:hash(g.toSnapshot().grid.map((c:any)=>({x:c.x,y:c.y,layers:c.layers,machineNumber:c.machineNumber})))});
  }
  runs.push({branch,start,actions,extraDraws:branch?257:0,entryRng,maps});
 }
 assert.notDeepEqual(runs[0]!.entryRng.streams,runs[1]!.entryRng.streams);
 assert.notDeepEqual(runs[1]!.actions.at(-1)!.loc,runs[1]!.start);
 assert.deepEqual(runs[0]!.maps,runs[1]!.maps);
 results.push({seed,runs});
}
fs.writeFileSync('ai_docs/reports/u-02b-evidence/isolation.json',JSON.stringify(results,null,2)+'\n');console.log('3 seeds × 25 later layers: full terrain layers and machine numbers identical');
