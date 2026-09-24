// Counterfactual evidence only: never writes generation_baseline.json.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHeadlessGame,terrainFingerprint} from '../src/test/harness';
import {ItemLoader} from '../src/engine/Items/ItemLoader';
import {rng} from '../src/engine/Random';
const dir='ai_docs/reports/w-26-evidence',base=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`,'utf8'));
const old=JSON.parse(execFileSync('git',['show','HEAD:brogue-web/src/data/arcana.json'],{encoding:'utf8'})).staffs.filter((s:any)=>!s.excludeFromGeneration);
const actual=ItemLoader.genStaffs,spawn=ItemLoader.spawnStaff;
if (JSON.stringify(actual.filter(s=>old.some((o:any)=>o.id===s.id))) !== JSON.stringify(old)) throw Error('Original nine rows or order changed');
function sample(pool: typeof actual){
 ItemLoader.genStaffs=pool;const levels:Record<string,any[]>={},traces:Record<string,any[]>={},calls:Record<string,number[]>={};
 for(const seed of base.seeds){
  let depth=1;const trace:any[]=[];traces[seed]=trace;calls[seed]=[];
  ItemLoader.spawnStaff=(id,x,y)=>{const before=rng.randomNumbersGenerated,item=spawn.call(ItemLoader,id,x,y);trace.push({depth,id,before,after:rng.randomNumbersGenerated,e:item?.enchantment,charges:item?.charges,timer:item?.staffRechargeRemaining});return item;};
  const g:any=createHeadlessGame(seed),rows:any[]=[];levels[seed]=rows;trace.length=0;g.startNewGame({seed});
  for(depth=1;depth<=26;depth++){
   if(depth>1){g.depth=depth;g.generateDepth(false,false);}
   rows.push({fp:terrainFingerprint(g.grid),n:g.monsters.length,species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length});calls[seed]!.push(rng.randomNumbersGenerated);
  }
 }
 return {levels,traces,calls};
}
function changes(a:any,b:any){return base.seeds.flatMap((seed:number)=>a[seed].flatMap((row:any,i:number)=>Object.keys(row).filter(k=>row[k]!==b[seed][i][k]).map(field=>({seed,depth:i+1,field,before:row[field],after:b[seed][i][field]}))));}
try{
 const control=sample(old),current=sample(actual);
 const controlDiff=changes(base.levels,control.levels),orderDiff=changes(control.levels,control.levels),additionDiff=changes(control.levels,current.levels),totalDiff=changes(base.levels,current.levels);
 const result={controlDiff,orderDiff,additionDiff,totalDiff,control,current};
 fs.writeFileSync(`${dir}/drift-attribution.json`,JSON.stringify(result,null,2)+'\n');
 if(controlDiff.length)throw Error('Unrelated drift: stop before any recapture');
 console.log(JSON.stringify({controlDiff:controlDiff.length,orderDiff:orderDiff.length,additionDiff:additionDiff.length,totalDiff:totalDiff.length}));
}finally{ItemLoader.genStaffs=actual;ItemLoader.spawnStaff=spawn;}
