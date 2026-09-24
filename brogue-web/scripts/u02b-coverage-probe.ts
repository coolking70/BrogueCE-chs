import fs from 'node:fs';import{createHeadlessGame}from'../src/test/harness';import{Architect}from'../src/engine/Generator/Architect';import{ItemCategory}from'../src/engine/Items/Item';
const original=Architect.prototype.generateLevel;let generated:any[]=[];
Architect.prototype.generateLevel=function(...args){const grid=original.apply(this,args);generated=this.machineResults;return grid;};
const results=[];for(let seed=1;seed<=32;seed++){
 const g:any=createHeadlessGame(seed),kinds=new Set<string>();let adopted=0,origin=0;
 for(let d=1;d<=26;d++){if(d>1){g.depth=d;g.generateDepth(false,false);}for(const m of generated){for(const s of m.monsterSpawns)if(s.carriedItem?.category!=='KEY'&&s.carriedItem)adopted++;for(const s of m.itemSpawns)if(s.pos?.x===m.center?.x&&s.pos?.y===m.center?.y)origin++;}
  for(const item of g.items)if([ItemCategory.STAFF,ItemCategory.WAND].includes(item.category))kinds.add(item.identityId);
 }
 results.push({seed,kinds:[...kinds],adopted,origin});
}
fs.writeFileSync('ai_docs/reports/u-02b-evidence/coverage-probe.json',JSON.stringify(results,null,2)+'\n');
