import fs from 'node:fs';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createHeadlessGame,terrainFingerprint} from '../src/test/harness';
import {BlueprintEngine} from '../src/engine/Generator/BlueprintEngine';
import {Game} from '../src/engine/Core/Game';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import {rng} from '../src/engine/Random';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const base=JSON.parse(fs.readFileSync('ai_docs/reports/u-19d-evidence/baseline-before.json','utf8'));
const prototype:any=BlueprintEngine.prototype,original=prototype.featureView,seen=new WeakSet();
let views:any[]=[],machines:any[]=[],realized:any[]=[];
const populate=(Game.prototype as any).populateLevel;
(Game.prototype as any).populateLevel=function(...args:any[]){const r=populate.apply(this,args);realized=(args[3]??[]).flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
const start=Game.prototype.startNewGame;
Game.prototype.startNewGame=function(...args){views=[];machines=[];return start.apply(this,args);};
prototype.featureView=function(origin:any,flags:Set<string>){
 const view=original.call(this,origin,flags);
 if(view&&!seen.has(flags)){seen.add(flags);views.push({origin,flags:[...flags],mask:hash(view)});}
 return view;
};
setMachineObservationHook(m=>machines.push(m));
const rows=[];
const products=(traces:any[])=>traces.filter(m=>m.status==='committed').flatMap(m=>m.products.filter((p:any)=>p.kind==='item'||p.kind==='monster').map((p:any)=>({ce:m.ceBlueprintId,machine:m.machineNumber,...p})));
const overlaps=(ps:any[])=>{
 const groups=new Map<string,any[]>();
 for(const p of ps)if(p.instanceId!==undefined&&p.owner==='floor'){
  const key=`${p.kind}/${p.pos.x},${p.pos.y}`,group=groups.get(key)??[];group.push(p);groups.set(key,group);
 }
 return [...groups.values()].filter(g=>new Set(g.map(p=>p.instanceId)).size>1);
};
for(const seed of base.seeds){
 const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=26;depth++){
  if(depth>1){views=[];machines=[];g.depth=depth;g.generateDepth(false,false);}
  const snapshot=g.toSnapshot();
  rows.push({seed,depth,fp:terrainFingerprint(g.grid),n:g.monsters.length,
   species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length,
   terrain:hash(g.grid.cells),monsters:hash(snapshot.monsters),dormant:hash(snapshot.dormantMonsters),entities:hash(snapshot.entityGraph),
   player:hash(snapshot.player),itemsState:hash(g.items),rng:rng.getState(),
   views:hash(views),machines:hash(machines),viewCount:views.length,
   overlaps:overlaps(products(machines)),
   committed:realized.filter(m=>m.status==='committed').map(m=>({ce:m.ceBlueprintId,number:m.machineNumber,features:m.features,products:m.products}))});
 }
 views=[];machines=[];
}
fs.writeFileSync(process.argv[2]!,gzipSync(JSON.stringify(rows)));
console.log(`Captured ${rows.length} layers, machine/view traces, entity and RNG fingerprints.`);
