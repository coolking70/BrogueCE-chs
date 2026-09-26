import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {preparePendingScene,pendingSceneState} from '../src/test/fixtures/u19b-machine-scenes';
import catalog from '../src/data/blueprints.json';
const g:any=createHeadlessGame(19,'test'),rows:any[]=[];
const affected=catalog.filter(b=>b.ceBlueprintId&&b.features.some((f:any)=>f.monsterId||f.flags.includes('MF_GENERATE_HORDE')||f.flags.includes('MF_GENERATE_ITEM')||f.flags.includes('MF_ADOPT_ITEM')));
for(const bp of affected){
 let scene:any,error='';
 for(const size of [0,1,2]){for(const seed of [1,2,3,4,5,6,7,8]){try{scene=preparePendingScene(g,bp.ceBlueprintId!,seed,size,true);break;}catch(e){error=String(e);}}if(scene)break;}
 if(!scene){rows.push({ce:bp.ceBlueprintId,error});console.log(bp.ceBlueprintId,'blocked',error);continue;}
 const action=scene.itemId!==undefined&&scene.observer.x===scene.target.x&&scene.observer.y===scene.target.y?'pickup':'search';
 const before=pendingSceneState(g,scene);g.handlePlayerAction(action,undefined,'system');g.updateVision();const after=pendingSceneState(g,scene);
 const actual=[...g.monsters,...g.dormantMonsters].filter((m:any)=>m.machineHome>0).map((m:any)=>({id:m.id,home:m.machineHome,leader:m.leader?.id??null,carried:m.carriedItem?.id??null,dormant:m.isDormant}));
 rows.push({ce:bp.ceBlueprintId,seed:scene.seed,size:scene.size,action,before,after,products:scene.products,actual,guardians:scene.guardianIds});console.log(bp.ceBlueprintId,action,actual.length,'entities');
 fs.writeFileSync('ai_docs/reports/u-19c-evidence/scenes.json',JSON.stringify(rows,null,2)+'\n');
}
fs.writeFileSync('ai_docs/reports/u-19c-evidence/scenes.json',JSON.stringify(rows,null,2)+'\n');
