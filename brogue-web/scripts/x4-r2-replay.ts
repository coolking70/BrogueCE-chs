import {it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';
import {runAltarActions} from './x4-r2-altar-actions';
it('records each CE47 player command and target state',()=>{
 const row=JSON.parse(gunzipSync(readFileSync('ai_docs/reports/x4-r2-evidence/placement-diagnostics.json.gz')).toString())[0];
 const g:any=createHeadlessGame(19,'test');g.loadSnapshot(row.snapshot);
 let result:any,error:any;try{result=runAltarActions(g,row.machine,row.door??row.center);}catch(e){error=String(e);}
 writeFileSync('ai_docs/reports/x4-r2-evidence/altar-replay.json.gz',gzipSync(JSON.stringify({result,error,diagnostics:g.u19fAltarDiagnostics,after:g.toSnapshot()})));
});
