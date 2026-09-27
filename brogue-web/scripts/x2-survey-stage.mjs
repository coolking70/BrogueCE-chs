import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'brogue-x2-survey-'));
const project=path.join(stage,'brogue-web');
fs.mkdirSync(project);
for(const name of ['src','public','scripts','node_modules','ai_docs','package.json','package-lock.json','index.html','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts']) {
  fs.cpSync(path.join(root,name),path.join(project,name),{recursive:true,filter:p=>!p.replaceAll('\\','/').includes('/x-2-evidence')});
}
fs.cpSync(path.join(root,'../BrogueCE-master'),path.join(stage,'BrogueCE-master'),{recursive:true});
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inputs=['src','public','scripts'].flatMap(p=>walk(path.join(root,p))).concat(['package.json','package-lock.json','index.html','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts'].map(p=>path.join(root,p)));
const differences=inputs.filter(p=>hash(p)!==hash(path.join(project,path.relative(root,p)))) .map(p=>path.relative(root,p));
const result={project,inputCount:inputs.length,differences,createdAt:new Date().toISOString()};
fs.writeFileSync(path.join(root,'ai_docs/reports/x-2-evidence/validation-stage.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
