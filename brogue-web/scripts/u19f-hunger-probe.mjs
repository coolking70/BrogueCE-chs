import fs from 'node:fs';import {build} from 'esbuild';import {execFileSync} from 'node:child_process';
const out='ai_docs/reports/u-19f-evidence';
await build({entryPoints:['src/test/hunger_curve_sim.test.ts'],outfile:'/tmp/u19f-hunger.mjs',platform:'node',format:'esm',bundle:true,plugins:[{name:'probe',setup(b){b.onLoad({filter:/hunger_curve_sim\.test\.ts$/},a=>{
 let contents=fs.readFileSync(a.path,'utf8').replace("import { describe, it, expect } from 'vitest';", "import fs from 'node:fs';");contents=contents.slice(0,contents.indexOf("describe('2000"));
 contents+=`\nconst results=[];for(const seed of [1,7,42,...Array.from({length:30},(_,i)=>i+2)]){const r=simulate(seed,roamPolicy,'roam-extended',2300,true);results.push(r);fs.writeFileSync('${out}/hunger-probe.json',JSON.stringify(results,null,2));console.log(formatResult(r));if(r.deathCause==='starvation'&&r.transitions.some(t=>t.state==='starving'&&t.objectiveTurn===2149))break;}`;return {contents,loader:'ts'};
 });}}]});execFileSync(process.execPath,['/tmp/u19f-hunger.mjs'],{stdio:'inherit'});
