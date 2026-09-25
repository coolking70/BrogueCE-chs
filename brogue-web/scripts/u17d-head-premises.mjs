// Run the original failed assertions against exact HEAD inputs in an isolated tree.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync,execFileSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17d-evidence'),label=process.argv[2]??'discovery';
const base=fs.mkdtempSync(path.join(os.tmpdir(),'u17d-head-')),temp=path.join(base,'brogue-web');fs.mkdirSync(temp);
try{
 fs.cpSync('src',`${temp}/src`,{recursive:true});fs.cpSync('scripts',`${temp}/scripts`,{recursive:true});
 for(const file of ['package.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json'])fs.copyFileSync(file,`${temp}/${file}`);
 fs.symlinkSync(path.join(cwd,'node_modules'),`${temp}/node_modules`,'dir');fs.symlinkSync(path.join(cwd,'../BrogueCE-master'),path.join(base,'BrogueCE-master'),'dir');
 for(const p of execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(p=>/^brogue-web\/(src|scripts)\//.test(p)))fs.writeFileSync(path.join(temp,p.slice(11)),execFileSync('git',['show',`HEAD:${p}`]));
 const files=[],titles=[];
 if(fs.existsSync(`${out}/${label}.json`)){
  const red=JSON.parse(fs.readFileSync(`${out}/${label}.json`));for(const f of red.testResults){const failed=f.assertionResults.filter(a=>a.status==='failed');if(failed.length){files.push(path.relative(cwd,f.name));titles.push(...failed.map(a=>a.title));}}
 }else{
  const log=fs.readFileSync(`${out}/discovery.txt`,'utf8');for(const m of log.matchAll(/❯ (src\/\S+\.test\.ts) \(/g))files.push(m[1]);for(const m of log.matchAll(/^\s+× (.*) \d+(?:ms|s)\s*$/gm))titles.push(m[1]);
 }
 if(!titles.length)throw Error('No failed assertions selected');const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const args=[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run',...new Set(files),'-t',titles.map(esc).join('|'),'--maxWorkers=2','--reporter=json',`--outputFile=${out}/head-premises-${label}.json`];
 const fd=fs.openSync(`${out}/head-premises-${label}.txt`,'w');const r=spawnSync(process.execPath,args,{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 fs.writeFileSync(`${out}/counterfactual-${label}.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files,titles,exit:r.status},null,2)+'\n');process.exitCode=r.status;
}finally{fs.rmSync(base,{recursive:true,force:true});}
