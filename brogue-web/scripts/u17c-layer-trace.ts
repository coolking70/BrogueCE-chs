import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {Grid,TerrainType as T} from '../src/engine/Map/Grid';
const out='ai_docs/reports/u-17c-evidence';
const rejected=JSON.parse(fs.readFileSync(`${out}/layers-probe.json`,'utf8')).rows;
const examples:any[]=[...new Map(rejected.map((r:any)=>[JSON.stringify(r.layers),r])).values()];
const records:any[]=[];
for(const seed of [...new Set(examples.map(r=>r.seed))]){
 const g:any=createHeadlessGame(seed);let writes=new WeakMap<Grid,any[]>();
 const oldLayer=Grid.prototype.setTerrainLayer,oldTerrain=Grid.prototype.setTerrain;
 for(const method of ['setTerrainLayer','setTerrain'] as const){
  const original=Grid.prototype[method] as Function;
  (Grid.prototype as any)[method]=function(...args:any[]){
   const [x,y]=args,watch=examples.some(r=>r.seed===seed&&r.x===x&&r.y===y),before=watch?this.getCell(x,y)?.layers.slice():null;
   const result=original.apply(this,args);
   if(watch){let rows=writes.get(this);if(!rows){rows=[];writes.set(this,rows);}rows.push({method,x,y,args:args.slice(2),before:before?.map((t:number)=>T[t]),after:this.getCell(x,y)?.layers.map((t:number)=>T[t]),stack:new Error().stack?.split('\n').slice(2,8)});}
   return result;
  };
 }
 const catchUp=g.catchUpEnvironment.bind(g);
 g.catchUpEnvironment=(...args:any[])=>{if(g.depth===9){for(const r of examples.filter(r=>r.seed===seed)){const c=g.grid.getCell(r.x,r.y);records.push({...r,observed:c.layers.map((t:number)=>T[t]),writes:(writes.get(g.grid)??[]).filter(w=>w.x===r.x&&w.y===r.y)});}}return catchUp(...args);};
 try{g.startNewGame({seed});g.depth=9;g.generateDepth(false,false);}finally{Grid.prototype.setTerrainLayer=oldLayer;Grid.prototype.setTerrain=oldTerrain;}
}
fs.writeFileSync(`${out}/layer-writer-trace.json`,JSON.stringify(records,null,2)+'\n');
