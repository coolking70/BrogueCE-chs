import fs from 'node:fs';
import {Game} from '../src/engine/Core/Game';
import {rng} from '../src/engine/Random';
import {createHeadlessGame,terrainFingerprint} from '../src/test/harness';
const events:any[]=[];
for(const method of ['spawnPopulateItem','spawnBlueprintItem'] as const){
 const proto=Game.prototype as any,original=proto[method];
 proto[method]=function(...args:any[]){
  const before=rng.getState(),item=original.apply(this,args);
  if(String(this.currentSeed)==='777')events.push({depth:this.depth,method,args,before,after:rng.getState(),kind:item?.consumableId??item?.identityId??item?.name??null,loc:item?.loc&&{...item.loc}});
  return item;
 };
}
const g:any=createHeadlessGame(777),layers=[];
for(let depth=1;depth<=10;depth++){
 if(depth>1){g.depth=depth;g.generateDepth(false,false);}
 layers.push({depth,fp:terrainFingerprint(g.grid),rng:rng.getState(),items:g.items.map((i:any)=>({kind:i.consumableId??i.identityId??i.name,...i.loc})),goldGenerated:g.goldGenerated});
}
fs.writeFileSync(process.argv[2]!,JSON.stringify({events,layers},null,2)+'\n');
