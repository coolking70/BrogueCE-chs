import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
const stage=process.argv[2];
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
const files=walk('src').filter(p=>!p.startsWith('src/test/')&&/\.(ts|json)$/.test(p));
const saved={};
for(const f of files){
 if(stage==='s0') {try{saved[f]=execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{}}
 else saved[f]=fs.readFileSync(f,'utf8');
}
fs.writeFileSync(`ai_docs/reports/x2b-evidence/sources-${stage}.json.gz`,gzipSync(JSON.stringify(saved)));
