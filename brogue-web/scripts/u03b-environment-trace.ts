import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHeadlessGame} from '../src/test/harness';
import {Game} from '../src/engine/Core/Game';
import {rng} from '../src/engine/Random';
const p=Game.prototype as any,original=p.catchUpEnvironment;
const records:any[]=[];
p.catchUpEnvironment=function(away:number) {
 const cells=()=>Array.from({length:this.grid.width},(_,x)=>Array.from({length:this.grid.height},(_,y)=>{const c=this.grid.getCell(x,y);return {layers:[...c.layers],volume:c.volume,exposed:c.exposedToFire};}));
 const before=cells(),beforeRNG=rng.getState(),player=JSON.stringify(this.player),clock=this.absoluteTurnNumber;
 const updates:number[]=[];const update=this.updateEnvironment;this.updateEnvironment=function(){updates.push(this.absoluteTurnNumber);return update.call(this);};
 try {original.call(this,away);}finally{delete this.updateEnvironment;}
 assert.equal(JSON.stringify(this.player),player);assert.equal(this.absoluteTurnNumber,clock);
 const after=cells(),changed:any[]=[];
 for(let x=0;x<this.grid.width;x++)for(let y=0;y<this.grid.height;y++)if(JSON.stringify(before[x]![y])!==JSON.stringify(after[x]![y]))changed.push({x,y,before:before[x]![y],after:after[x]![y]});
 records.push({depth:this.depth,timeAway:away,updates:updates.length,firstClock:updates[0],lastClock:updates[updates.length-1],absoluteRestored:true,playerUnchanged:true,beforeRNG,afterRNG:rng.getState(),changed});
};
const results:any[]=[];
for(const seed of [777,31337,424242,20260913]) {
 const g:any=createHeadlessGame(seed);results.push({seed,...records[records.length-1]});
 g.depth=2;g.generateDepth();results.push({seed,...records[records.length-1]});
}
fs.writeFileSync('ai_docs/reports/u-03b-evidence/environment-trace.json',JSON.stringify(results,null,2)+'\n');
