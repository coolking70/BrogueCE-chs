// Isolated process sampler: records baseline fields plus full generated state,
// RNG and the membership discrepancy BEFORE population consumes it.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { Game } from '../src/engine/Core/Game';
import { DCOLS } from '../src/engine/Map/Grid';
import { rng } from '../src/engine/Random';
const dir='ai_docs/reports/u-04c-evidence';
const base=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`,'utf8'));
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const prototype=Game.prototype as any, populate=prototype.populateLevel;
let input:any;
prototype.populateLevel=function(...args:any[]) {
 const machines=args[3]??[], interior=new Set<number>(machines.flatMap((m:any)=>m.cells.map((p:any)=>p.y*DCOLS+p.x)));
 const numbered:number[]=[];
 for(let y=0;y<this.grid.height;y++)for(let x=0;x<this.grid.width;x++)if(this.grid.getCell(x,y).machineNumber!==0)numbered.push(y*DCOLS+x);
 const tagged=new Set(numbered);
 input={interior:interior.size,numbered:tagged.size,cleared:[...interior].filter(p=>!tagged.has(p)).sort((a,b)=>a-b),external:numbered.filter(p=>!interior.has(p)),
   blueprints:machines.map((m:any)=>m.blueprintId),gridBefore:hash(this.grid),rngBefore:rng.getState()};
 const result=populate.apply(this,args);
 input.rngAfter=rng.getState();
 return result;
};
const levels:Record<string,any[]>={},traces:Record<string,any[]>={};
for(const seed of [...new Set([...base.seeds,424242])]) {
 const g:any=createHeadlessGame(seed as number);levels[String(seed)]=[];traces[String(seed)]=[];
 for(let depth=1;depth<=26;depth++) {
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  const species=[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(',');
  levels[String(seed)]!.push({fp:terrainFingerprint(g.grid),n:g.monsters.length,species,items:g.items.length});
  const snapshot=g.toSnapshot();delete snapshot.savedAt;
  traces[String(seed)]!.push({...input,generatedWorld:hash(snapshot),rng:rng.getState(),machineCells:[...g.machineCells].sort((a:any,b:any)=>a-b),
    itemPositions:g.items.map((i:any)=>({id:i.id,name:i.name,x:i.loc.x,y:i.loc.y})),
    monsterPositions:g.monsters.map((m:any)=>({id:m.id,name:m.name,x:m.loc.x,y:m.loc.y}))});
 }
}
fs.writeFileSync(process.env.U04C_OUTPUT!,JSON.stringify({levels,traces},null,2)+'\n');
