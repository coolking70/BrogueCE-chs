// Validate the pending review patch on a temporary copy. Does not apply it to the workspace.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{spawnSync}from'node:child_process';
const root=process.cwd(),dir=path.join(root,'ai_docs/reports/u-02b-evidence');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'brogue-u02b-proposal-')),temp=path.join(base,'brogue-web');fs.mkdirSync(temp);
try{
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});for(const f of ['package.json','vite.config.ts'])fs.copyFileSync(f,path.join(temp,f));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');fs.symlinkSync(path.join(root,'ai_docs'),path.join(temp,'ai_docs'),'dir');fs.symlinkSync(path.resolve('../BrogueCE-master'),path.join(base,'BrogueCE-master'),'dir');
 const patch=spawnSync('patch',['-p1'],{cwd:temp,input:fs.readFileSync(path.join(dir,'guard-migration-proposal.patch')),encoding:'utf8'});if(patch.status!==0)throw Error(patch.stdout+patch.stderr);
 const fd=fs.openSync(path.join(dir,'guard-migration-proposal.txt'),'w');const r=spawnSync(path.join(root,'node_modules/.bin/vitest'),['run','src/test/c_5_fall_subsystem.test.ts','src/test/w_13_tunneling.test.ts','src/test/c_4b_dungeon_feature.test.ts','-t','踩上渊格|runtime and direct|F3','--maxWorkers=2','--reporter=json',`--outputFile=${path.join(dir,'guard-migration-proposal.json')}`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);process.exitCode=r.status??1;
}finally{fs.rmSync(base,{recursive:true,force:true});}
