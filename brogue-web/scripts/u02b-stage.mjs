// Observations only: NEVER writes the generation fixture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
const stage=process.argv[2], stages=['before','a','b','c','d','cache'];
if(!stages.includes(stage)) throw Error('expected before/a/b/c/d/cache');
const dir=`ai_docs/reports/u-02b-evidence/stage-${stage}`;
if(fs.existsSync(dir)) throw Error('Stage evidence already exists');
fs.mkdirSync(dir,{recursive:true});
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hashes=Object.fromEntries(walk('src').map(f=>[f,hash(f)]));
fs.writeFileSync(`${dir}/inputs.json`,JSON.stringify(hashes,null,2)+'\n');
for(const f of ['src/engine/Random.ts','src/engine/Core/Game.ts','src/engine/Map/WaypointMap.ts','src/engine/Core/LevelSeeds.ts']) if(fs.existsSync(f))fs.copyFileSync(f,`${dir}/${path.basename(f)}`);
await build({entryPoints:['scripts/u02b-stage-probe.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/u02b-stage.mjs',logLevel:'silent'});
const raw=execFileSync('node',['/tmp/u02b-stage.mjs'],{encoding:'utf8',maxBuffer:64*1024*1024});
fs.writeFileSync(`${dir}/run.txt`,raw);
const result=JSON.parse(raw.split('U02B_RESULT ')[1]);
fs.writeFileSync(`${dir}/rows.json`,JSON.stringify(result,null,2)+'\n');
const prev=stages[stages.indexOf(stage)-1];
const old=prev?JSON.parse(fs.readFileSync(`ai_docs/reports/u-02b-evidence/stage-${prev}/rows.json`)):JSON.parse(fs.readFileSync('src/test/fixtures/generation_baseline.json')).levels;
const diffs=[], extras=[];
for(const seed of Object.keys(old)) for(let i=0;i<26;i++) {
 for(const k of ['fp','n','species','items']) if(JSON.stringify(result[seed][i][k])!==JSON.stringify(old[seed][i][k])) diffs.push({seed,depth:i+1,field:k,before:old[seed][i][k],after:result[seed][i][k]});
 if(prev)for(const k of ['waypoints','rng','flavors','stairs'])if(JSON.stringify(result[seed][i][k])!==JSON.stringify(old[seed][i][k]))extras.push({seed,depth:i+1,field:k});
}
const summarize=ds=>({layers:new Set(ds.map(d=>`${d.seed}/${d.depth}`)).size,fields:ds.length,byField:Object.fromEntries([...new Set(ds.map(d=>d.field))].map(k=>[k,ds.filter(d=>d.field===k).length]))});
const summary={stage,previous:prev??'original baseline',low:summarize(diffs.filter(d=>(BigInt(d.seed)>>32n)===0n)),high:summarize(diffs.filter(d=>(BigInt(d.seed)>>32n)!==0n)),extras:summarize(extras),diffs,extraDiffs:extras};
if(prev){const before=JSON.parse(fs.readFileSync(`ai_docs/reports/u-02b-evidence/stage-${prev}/inputs.json`));summary.changedInputs=Object.keys(hashes).filter(f=>before[f]!==hashes[f]);}
fs.writeFileSync(`${dir}/comparison.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({...summary,diffs:undefined,extraDiffs:undefined}));
