import fs from 'node:fs';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createHeadlessGame,terrainFingerprint} from '../src/test/harness';
import {BlueprintEngine} from '../src/engine/Generator/BlueprintEngine';
import {Game} from '../src/engine/Core/Game';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import {ItemLoader} from '../src/engine/Items/ItemLoader';
import {rng} from '../src/engine/Random';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const base=JSON.parse(fs.readFileSync('ai_docs/reports/u-15d3-evidence/generation_baseline.json','utf8'));
const prototype:any=BlueprintEngine.prototype,original=prototype.featureView,seen=new WeakSet();
let views:any[]=[],machines:any[]=[],realized:any[]=[],births:any[]=[];
for(const method of ['spawnWeapon','spawnArmor'] as const){
 const original=ItemLoader[method];
 ItemLoader[method]=function(...args:Parameters<typeof original>){
  const before=rng.randomNumbersGenerated, item=original.apply(this,args);
  if(item)births.push({kind:args[0],depth:args[3]??1,runic:item.runicType??null,vorpal:item.vorpalEnemy??null,
   e:item.enchantment,curse:item.isCursed,flags:item.flags??[],quantity:item.quantity,quiver:item.quiverNumber,
   draws:rng.randomNumbersGenerated-before});
  return item;
 };
}
const populate=(Game.prototype as any).populateLevel;
(Game.prototype as any).populateLevel=function(...args:any[]){const r=populate.apply(this,args);realized=(args[3]??[]).flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
const start=Game.prototype.startNewGame;
Game.prototype.startNewGame=function(...args){views=[];machines=[];births=[];return start.apply(this,args);};
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
  if(depth>1){views=[];machines=[];births=[];g.depth=depth;g.generateDepth(false,false);}
  const snapshot=g.toSnapshot();
  rows.push({seed,depth,fp:terrainFingerprint(g.grid),n:g.monsters.length,
   species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length,
   terrain:hash(g.grid.cells),monsters:hash(snapshot.monsters),dormant:hash(snapshot.dormantMonsters),entities:hash(snapshot.entityGraph),
   player:hash(snapshot.player),itemsState:hash(g.items),rings:g.items.filter((i:any)=>i.category===8).map((i:any)=>({kind:i.identityId,e:i.enchantment,curse:i.isCursed})),rng:rng.getState(),
   births:[...births],views:hash(views),machines:hash(machines),viewCount:views.length,
   overlaps:overlaps(products(machines)),
   committed:realized.filter(m=>m.status==='committed').map(m=>({ce:m.ceBlueprintId,number:m.machineNumber,features:m.features,products:m.products}))});
 }
 views=[];machines=[];births=[];
}
fs.writeFileSync(process.argv[2]!,gzipSync(JSON.stringify(rows)));
console.log(`Captured ${rows.length} layers, machine/view traces, entity and RNG fingerprints.`);
