import fs from 'node:fs';import {gunzipSync,gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';
import {runCrystalWormActions} from '../src/test/fixtures/u19f-machine-actions';
import {runAutoActions,restoredAutoRows} from '../src/test/fixtures/u19f-auto-actions';
const out='ai_docs/reports/u-19f-evidence',index=JSON.parse(fs.readFileSync(`${out}/natural-index.json`,'utf8')),rows:any[]=[],errors:any[]=[];
for(const ce of [52,55]){
 for(const row of index.rows.filter((r:any)=>r.ce===ce)){
  const g=createHeadlessGame(19,'test');if(!g.loadSnapshot(JSON.parse(gunzipSync(fs.readFileSync(`${out}/${row.file}`)).toString())))throw Error('invalid natural snapshot');
  try{const result=runCrystalWormActions(g,row.trace,row.entry),{initial,...rest}=result;fs.writeFileSync(`${out}/action-start-ce${ce}.json.gz`,gzipSync(JSON.stringify(initial)));rows.push({...row,...rest});console.log(ce,'PASS',result.commands.length,'reward',result.rewardId);break;}catch(e){fs.writeFileSync(`${out}/failed-ce${ce}.json`,JSON.stringify((g as any).u19fDiagnostics,null,2));errors.push({ce,seed:row.seed,depth:row.depth,machine:row.machine,error:String(e)});console.log(ce,row.seed,row.depth,String(e));}
 }
}
for(const index of restoredAutoRows){
 try{const {initial,game,...r}=runAutoActions(index);fs.writeFileSync(`${out}/action-start-auto${index}.json.gz`,gzipSync(JSON.stringify(initial)));rows.push(r);console.log('auto',index,'PASS',r.commands.length);}catch(e){errors.push({index,error:String(e)});}
}
fs.writeFileSync(`${out}/actions.json`,JSON.stringify({rows,errors},null,2)+'\n');if(errors.length)process.exitCode=1;
