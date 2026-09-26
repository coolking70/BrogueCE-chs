import fs from 'node:fs';
export const sourceFiles=['src/engine/Generator/BlueprintEngine.ts','src/engine/Generator/Architect.ts','src/engine/Map/AutoGenerator.ts','src/engine/Core/Game.ts'];
export function variant(name,file){
 const final=fs.readFileSync(file,'utf8'),stem=file.split('/').at(-1).replace('.ts','');
 const old=fs.readFileSync(`ai_docs/reports/u-19b-evidence/${stem}-before.ts.txt`,'utf8');
 if(name==='s0')return old;
 if(name==='s1'||name==='s2'){
  if(stem==='Game')return old;
  if(name==='s1'&&stem==='BlueprintEngine')return final.replace('return this.pendingItems.has(cellKey(x, y)) || this.pendingMonsters.has(cellKey(x, y));','return this.pendingItems.has(cellKey(x, y));');
  return final;
 }
 if(name==='s3')return final;
 if(name==='no-vestibule'&&stem==='BlueprintEngine')return final.replace('if (this.pendingItems.has(cellKey(x, y))) return null;','');
 if(name==='no-room'&&stem==='BlueprintEngine')return final.replace('(x, y) => this.pendingItems.has(cellKey(x, y)));','() => false);');
 if(name==='no-item-autogen'&&stem==='BlueprintEngine')return final.replace('return this.pendingItems.has(cellKey(x, y)) || this.pendingMonsters.has(cellKey(x, y));','return this.pendingMonsters.has(cellKey(x, y));');
 if(name==='no-monster-autogen'&&stem==='BlueprintEngine')return final.replace('return this.pendingItems.has(cellKey(x, y)) || this.pendingMonsters.has(cellKey(x, y));','return this.pendingItems.has(cellKey(x, y));');
 if(name==='no-monster-area'&&stem==='BlueprintEngine')return final.replace('this.pendingItems.has(key) || this.pendingMonsters.has(key)','this.pendingItems.has(key)');
 if(name==='no-rollback'&&stem==='BlueprintEngine')return final.replace('this.pendingItems = new Set(snap.items);','').replace('this.pendingMonsters = new Set(snap.monsters);','');
 if(name==='no-amulet'&&stem==='Game')return old;
 return final;
}
