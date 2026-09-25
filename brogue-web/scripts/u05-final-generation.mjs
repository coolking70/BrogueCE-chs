import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
const dir='ai_docs/reports/u-05-evidence',temp=fs.mkdtempSync(path.join(os.tmpdir(),'u05-final-generation-'));
try{
 const outfile=path.join(temp,'probe.cjs');
 await build({entryPoints:['scripts/u05-generation.ts'],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 console.log(execFileSync(process.execPath,[outfile,`${dir}/generation-final-rerun.json`],{encoding:'utf8'}));
 const output=JSON.parse(fs.readFileSync(`${dir}/generation-final-rerun.json`));
 const problems=Object.values(output.traces).flatMap(rows=>rows.flatMap(r=>r.problems));
 if(problems.length)throw Error(JSON.stringify(problems));
 const expected=JSON.parse(fs.readFileSync(`${dir}/generation-final.json`));
 if(JSON.stringify(expected)!==JSON.stringify(output))throw Error('Final trace changed after attribution');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
