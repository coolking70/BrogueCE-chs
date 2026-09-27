import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const evidence=path.join(root,'ai_docs/reports/x-2-evidence');
const {project}=JSON.parse(fs.readFileSync(path.join(evidence,'validation-stage.json')));
const selected=fs.readdirSync(path.join(project,'src/test')).filter(n=>/^(x2|u[_0-9]).*\.test\.ts$/.test(n)).map(n=>`src/test/${n}`).concat([
 'src/test/invented_content_pool.test.ts','src/test/p1_30_i18n_gate.test.ts','src/test/c_7_lighting.test.ts',
 'src/test/r_1_appearance.test.ts','src/test/ui_1_rendering.test.ts','src/test/p1_24_death_sink.test.ts',
 'src/engine/UI/Discoveries.test.ts','src/engine/UI/DetailGenerator.test.ts','src/engine/Random.test.ts',
 'src/data/hordes.test.ts','src/test/generation_baseline.test.ts'
]).filter(p=>fs.existsSync(path.join(project,p)));
fs.writeFileSync(path.join(evidence,'selected-tests.json'),JSON.stringify(selected,null,2)+'\n');
const jobs=[['typecheck',['node_modules/vue-tsc/bin/vue-tsc.js','-b']],['build',['node_modules/vite/bin/vite.js','build']],['targeted',['node_modules/vitest/vitest.mjs','run',...selected,'--maxWorkers=2','--reporter=json',`--outputFile=${path.join(evidence,'targeted-results.json')}`]]];
const summary=[];
for(const [name,args] of jobs){
  const startedAt=new Date().toISOString(); const start=Date.now();
  const log=fs.createWriteStream(path.join(evidence,`${name}.txt`));
  console.log(`Starting ${name}`);
  const child=spawn(process.execPath,args,{cwd:project,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'},windowsHide:true});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>log.write(b.toString().replaceAll('\r\n','\n')));
  const result=await new Promise(resolve=>{child.on('error',e=>resolve({error:String(e)}));child.on('close',(code,signal)=>resolve({code,signal}));});
  log.end();summary.push({name,args,startedAt,...result,seconds:(Date.now()-start)/1000});
  fs.writeFileSync(path.join(evidence,'validation-summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary.at(-1)));
}
