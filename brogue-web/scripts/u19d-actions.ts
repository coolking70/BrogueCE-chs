import fs from 'node:fs';import {gunzipSync,gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';import {runMachineActions} from '../src/test/fixtures/u19d-machine-actions';
const out='ai_docs/reports/u-19d-evidence',index=JSON.parse(fs.readFileSync(`${out}/natural-index.json`,'utf8')),rows:any[]=[],errors:any[]=[];
for(const ce of [18,22,23,28,36,38,40,67,68,69,21,35,29,43]){
 for(const row of index.rows.filter((r:any)=>r.ce===ce)){
  const g=createHeadlessGame(19,'test');g.loadSnapshot(JSON.parse(gunzipSync(fs.readFileSync(`${out}/${row.file}`)).toString()));
  try{const result=runMachineActions(g,row.trace);const {initial,...rest}=result;fs.writeFileSync(`${out}/action-start-ce${ce}.json.gz`,gzipSync(JSON.stringify(initial)));rows.push({...row,...rest});console.log(ce,'PASS',result.commands.length,'reward',result.rewardId);break;}catch(e){errors.push({ce,seed:row.seed,depth:row.depth,machine:row.machine,error:String(e)});console.log(ce,row.seed,row.depth,String(e));}
 }
 fs.writeFileSync(`${out}/actions.json`,JSON.stringify({rows,errors},null,2)+'\n');
}
