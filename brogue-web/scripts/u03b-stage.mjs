import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const stage=process.argv[2],outfile=`/tmp/u03b-${stage}.mjs`;
const root=process.cwd();
const current=fs.readFileSync('src/engine/Core/Game.ts','utf8');
const initialFollow=fs.readFileSync('ai_docs/reports/u-03b-evidence/follow-Game.ts.txt','utf8');
const travelStart=initialFollow.indexOf('    private levelStair('),travelEnd=initialFollow.indexOf('    private populateLevel(',travelStart);
const followSource=initialFollow.slice(0,travelStart)+current.slice(current.indexOf('    private levelStair('),current.indexOf('    private populateLevel('))+initialFollow.slice(travelEnd);
const bridge=current.replace('        this.catchUpEnvironment(cached ? Math.max(0, this.absoluteTurnNumber - (cached.awaySince ?? 0)) : 50);','        // attribution bridge: catch-up disconnected');
await build({entryPoints:['scripts/u03b-generation.ts'],bundle:true,platform:'node',format:'esm',outfile,
 plugins:stage==='control'?[{name:'head-control',setup(b){b.onLoad({filter:/\/(Game|Monster|EntitySnapshot)\.ts$/},args=>({contents:execFileSync('git',['show',`HEAD:brogue-web/${args.path.slice(root.length+1)}`],{encoding:'utf8'}),loader:'ts'}));}}]:['follow','bridge'].includes(stage)?[{name:'one-stage',setup(b){b.onLoad({filter:/\/engine\/Core\/Game\.ts$/},()=>({contents:stage==='follow'?followSource:bridge,loader:'ts'}));}}]:[]});
const fd=fs.openSync(`ai_docs/reports/u-03b-evidence/stage-${stage}.txt`,'w');
execFileSync(process.execPath,[outfile,`ai_docs/reports/u-03b-evidence/stage-${stage}.json`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
