import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..');
const evidence = path.join(root, 'ai_docs/reports/x-1b-evidence');
fs.mkdirSync(evidence, { recursive: true });
const write = (n, v) => fs.writeFileSync(path.join(evidence,n), JSON.stringify(v,null,2)+'\n');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tracked = execFileSync('git',['ls-files','-z'],{cwd:repo}).toString().split('\0').filter(Boolean);
write('tracked-before.json', Object.fromEntries(tracked.map(p=>[p,hash(path.join(repo,p))])));
write('entry.json', {head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo}).toString().trim(), status:execFileSync('git',['status','--porcelain'],{cwd:repo}).toString(),node:process.version,platform:process.platform,createdAt:new Date().toISOString()});
const target = fs.mkdtempSync(path.join(os.tmpdir(),'brogue-x1b-'));
const project = path.join(target,'brogue-web');
fs.mkdirSync(project);
for (const name of ['src','public','scripts','node_modules','package.json','package-lock.json','index.html','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts']) {
  fs.cpSync(path.join(root,name),path.join(project,name),{recursive:true});
}
fs.cpSync(path.join(repo,'BrogueCE-master'),path.join(target,'BrogueCE-master'),{recursive:true});
const walk = d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const inputs = [...walk(path.join(root,'src')),...walk(path.join(root,'public')), ...['package.json','package-lock.json','index.html','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts'].map(p=>path.join(root,p))];
const differences = inputs.filter(p=>hash(p)!==hash(path.join(project,path.relative(root,p))));
write('stage.json',{project,inputCount:inputs.length,differences,createdAt:new Date().toISOString()});
console.log(JSON.stringify({project,inputCount:inputs.length,differences}));
