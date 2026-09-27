import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root,'ai_docs/reports/x-1b-evidence');
const { project } = JSON.parse(fs.readFileSync(path.join(evidence,'stage.json')));
const names = [
 'u_26a_deep_levels','u_26a_deep_baseline','u_26b_endgame','u_27_recording','x2a_recording_checkpoint',
 'u_03_whole_run_snapshot','u_03b_level_travel','u_02b_level_rng','u_18a_3_generation',
 'c_0_add_loops','c_6_autogenerators','v_2b_9e_2_autogen','x2b_terrain_derivation',
 'x2g_native_effects','x2j_monster_ai','x2m_lighting','invented_content_pool',
 'u_19f_autogen','u_19f_machines','generation_baseline',
];
const existing = fs.readdirSync(path.join(project,'src/test'));
const repair=process.argv.includes('--repair');
if(repair){
 const dependencies=['u-02b-evidence/ce-reference.json','u-07-evidence/ce-blink.json','x2g-evidence/ce-oracle.json','x2j-evidence/ce-state.json'];
 const copied=[];
 const {createHash}=await import('node:crypto');
 for(const rel of dependencies){
  const from=path.join(root,'ai_docs/reports',rel),to=path.join(project,'ai_docs/reports',rel);
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
  copied.push({file:rel,sha256:createHash('sha256').update(fs.readFileSync(from)).digest('hex'),identical:fs.readFileSync(from).equals(fs.readFileSync(to))});
 }
 fs.writeFileSync(path.join(evidence,'stage-added-inputs.json'),JSON.stringify(copied,null,2)+'\n');
 names.splice(0,names.length,'u_02b_level_rng','x2g_native_effects','x2j_monster_ai','u20_inventory');
}
const selected = names.map(n => {
 const file=existing.find(f=>f===n+'.test.ts');
 if(!file) throw Error('No existing test for '+n);
 return 'src/test/'+file;
});
fs.writeFileSync(path.join(evidence,repair?'recovery-tests.json':'selected-tests.json'),JSON.stringify(selected,null,2)+'\n');
const jobs=[
 ['typecheck',['node_modules/vue-tsc/bin/vue-tsc.js','-b']],
 ['build',['node_modules/vite/bin/vite.js','build']],
 ['targeted',['node_modules/vitest/vitest.mjs','run',...selected,'--maxWorkers=2','--reporter=json',`--outputFile=${path.join(evidence,'targeted-results.json')}`]],
];
if(repair)for(const job of jobs){job[0]='recovery-'+job[0];if(job[0]==='recovery-targeted')job[1][job[1].length-1]=`--outputFile=${path.join(evidence,'recovery-results.json')}`;}
const summary=[];
for(const [name,args] of jobs){
 const start=Date.now();
 console.log('Starting '+name);
 const output=fs.createWriteStream(path.join(evidence,name+'.txt'));
 const env={...process.env,NO_COLOR:'1',FORCE_COLOR:'0'};
 for(const k of Object.keys(env)) if (/CAPTURE|RECAPTURE|UPDATE_BASELINE/.test(k)) delete env[k];
 const child=spawn(process.execPath,args,{cwd:project,env,windowsHide:true});
 for(const stream of [child.stdout,child.stderr]) stream.on('data',b=>output.write(b.toString().replaceAll('\r\n','\n')));
 const result=await new Promise(resolve=>{child.on('error',e=>resolve({error:String(e)}));child.on('close',(code,signal)=>resolve({code,signal}));});
 output.end(); summary.push({name,args,...result,seconds:(Date.now()-start)/1000});
 fs.writeFileSync(path.join(evidence,repair?'recovery-summary.json':'validation-summary.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify(summary.at(-1)));
}
