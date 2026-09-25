// Original guard premises against current production, then exact HEAD in one isolated copy.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync,execFileSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17d-evidence'),base=fs.mkdtempSync(path.join(os.tmpdir(),'u17d-guards-')),temp=path.join(base,'brogue-web');
const selections=new Map();
for(const label of ['static-discovery','extra-static','guard-discovery'])for(const f of JSON.parse(fs.readFileSync(`${out}/${label}.json`)).testResults)for(const a of f.assertionResults)if(a.status==='failed')selections.set(a.title,path.relative(cwd,f.name));
selections.set('AD-7 表长 49、数值列逐条相等、死条目 index 0、基座列抽查','src/test/c_6_autogenerators.test.ts');
const changed=execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(p=>/^brogue-web\/(src|scripts)\//.test(p));
const head=p=>execFileSync('git',['show',`HEAD:${p}`]);
const escaped=[...selections.keys()].map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
function run(name){const fd=fs.openSync(`${out}/${name}.txt`,'w');const r=spawnSync(process.execPath,[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run',...new Set(selections.values()),'-t',escaped.join('|'),'--maxWorkers=2','--reporter=json',`--outputFile=${out}/${name}.json`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);if(r.signal)throw Error(r.signal);return r.status;}
try{
 fs.mkdirSync(temp);for(const dir of ['src','scripts'])fs.cpSync(dir,`${temp}/${dir}`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${temp}/${p}`);
 fs.symlinkSync(path.join(cwd,'node_modules'),`${temp}/node_modules`,'dir');fs.symlinkSync(path.join(cwd,'../BrogueCE-master'),path.join(base,'BrogueCE-master'),'dir');
 for(const p of changed.filter(p=>p.endsWith('.test.ts')))fs.writeFileSync(path.join(temp,p.slice(11)),head(p));
 const current=run('original-guards-on-u17d');
 for(const p of changed)fs.writeFileSync(path.join(temp,p.slice(11)),head(p));
 const original=run('original-guards-on-head');
 fs.writeFileSync(`${out}/guard-proof.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),selections:Object.fromEntries(selections),current,original},null,2)+'\n');if(current!==1||original!==0)throw Error('Unexpected counterfactual result');
}finally{fs.rmSync(base,{recursive:true,force:true});}
