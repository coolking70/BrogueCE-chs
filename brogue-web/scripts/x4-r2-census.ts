import {test} from 'vitest';
import fs from 'node:fs';
import {Game} from '../src/engine/Core/Game';
import {Architect} from '../src/engine/Generator/Architect';
import {BlueprintEngine} from '../src/engine/Generator/BlueprintEngine';
import {setMachineObservationHook,setMachineObservationSeed} from '../src/engine/Generator/MachineObservation';
import {TerrainType} from '../src/engine/Map/TerrainType';
import {ItemCategory} from '../src/engine/Items/Item';
import i18next from 'i18next';
import zh from '../src/locales/zh_CN.json';
const out='ai_docs/reports/x4-r2-evidence';
const phase=process.env.X4_PHASE??'before';
const inc=(o:any,k:any,n=1)=>o[k]=(o[k]??0)+n;
test('X4 sequential real generation census',()=>{
 i18next.init({lng:'zh_CN',resources:{zh_CN:{translation:zh}},initImmediate:false});
 const n=Number(process.env.X4_SEEDS??2),start=Number(process.env.X4_START??0),maxDepth=Number(process.env.X4_MAX_DEPTH??40),beg=Date.now();
 const totals:any={seeds:[],floors:0,autogen:{},blueprints:{},terrain:{},items:{},monsters:{},depths:{},rollbacks:{},machineFeatures:{},machineProducts:{},errors:[]};
 let lastArch:any=null; let committed:any[]=[];
 const original=Architect.prototype.generateLevel;
 Architect.prototype.generateLevel=function(...args:any[]){committed=[];const result=original.apply(this,args as any);lastArch=this;return result;};
 // Camp traces can be emitted inside a parent machine. Discard them if that
 // parent or the whole dig attempt rolls back; count only the final level.
 const bpProto:any=BlueprintEngine.prototype, apply=bpProto.applyBlueprint;
 bpProto.applyBlueprint=function(...args:any[]){const start=committed.length;
  try{const result=apply.apply(this,args);if(!result)committed.length=start;return result;}
  catch(error){committed.length=start;throw error;}
 };
 setMachineObservationHook(t=>{if(t.status==='rolled_back')inc(totals.rollbacks,`${t.ceBlueprintId??t.blueprintId}|${t.reason}`);else committed.push(t);});
 fs.writeFileSync(`${out}/census-${phase}-levels.jsonl`,'');
 const g:any=new Game();totals.rollbacks={};
 try{for(let s=start;s<start+n;s++){
 const seed=400000+s*7919;totals.seeds.push(seed);setMachineObservationSeed(String(seed));
 for(let d=1;d<=maxDepth;d++){
  try{
   lastArch=null;committed=[];
   if(d===1)g.startNewGame({seed,mode:'normal'});else{g.depth=d;g.generateDepth(false,false);}
   const level:any={seed,depth:d,autogen:[],blueprints:{},terrain:{},items:{},monsters:{},machineFeatures:{},machineProducts:{}};
   const visited=new Set();const walk=(m:any)=>{if(visited.has(m.machineNumber))return;visited.add(m.machineNumber);
    if(m.observation){const t=m.observation;inc(level.blueprints,t.ceBlueprintId??t.blueprintId);for(const f of t.features){if(f.status==='placed')inc(level.machineFeatures,`${t.ceBlueprintId}:${f.index}`,f.placements.length);}
    for(const p of t.products)inc(level.machineProducts,`${t.ceBlueprintId}:${p.featureIndex}:${p.kind}:${p.name??''}`);}
    for(const sub of m.subMachines??[])walk(sub);
   };
   if(!lastArch)throw new Error('No Architect observation');
   for(const m of lastArch.machineResults)walk(m);
   for(const t of committed)walk({machineNumber:t.machineNumber,observation:t});
   for(const pass of [lastArch.autogenNonMachine,lastArch.autogenMachine])for(const a of pass?.entries??[]){level.autogen.push(a);const t=totals.autogen[a.index]??={count:0,built:0,locationMisses:0};t.count+=Math.max(0,a.count);t.built+=a.built;t.locationMisses+=a.locationMisses;}
   for(const c of g.grid.cells.flat())for(const t of c.layers)inc(level.terrain,TerrainType[t]);
   const items=new Map();for(const i of g.items)items.set(i.id,i);for(const m of [...g.monsters,...g.dormantMonsters]){inc(level.monsters,m.typeId??m.name);if(m.carriedItem)items.set(m.carriedItem.id,m.carriedItem);}
   for(const i of items.values())inc(level.items,`${ItemCategory[i.category]}:${i.consumableId??i.identityId??i.name}`);
   for(const key of ['blueprints','terrain','items','monsters','machineFeatures','machineProducts'])for(const [id,v] of Object.entries(level[key]))inc(totals[key],id,v as number);
   totals.floors++;inc(totals.depths,d);fs.appendFileSync(`${out}/census-${phase}-levels.jsonl`,JSON.stringify(level)+'\n');
  }catch(e){totals.errors.push({seed,depth:d,error:String(e),stack:(e as Error).stack});throw e;}
 }
 totals.elapsedSeconds=(Date.now()-beg)/1000;fs.writeFileSync(`${out}/census-${phase}.json`,JSON.stringify(totals,null,2)+'\n');console.log(`X4 ${s-start+1}/${n} seeds, ${totals.floors} floors, ${totals.elapsedSeconds}s`);
 }}finally{Architect.prototype.generateLevel=original;bpProto.applyBlueprint=apply;setMachineObservationHook(null);totals.elapsedSeconds=(Date.now()-beg)/1000;fs.writeFileSync(`${out}/census-${phase}.json`,JSON.stringify(totals,null,2)+'\n');}
},7200000);
