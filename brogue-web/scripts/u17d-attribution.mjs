// Cumulative single-carrier and single-entry-point variants. The working tree is never toggled.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-17d-evidence',work=fs.mkdtempSync(path.join(os.tmpdir(),'u17d-generation-'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const names=['head',...Array.from({length:15},(_,i)=>`s${i}`),'final'];
const head=file=>execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'});
const ids=['DF_SHOW_METHANE_VENT','DF_METHANE_VENT_OPEN','DF_PILOT_LIGHT','DF_DISCOVER_PARALYSIS_VENT','DF_REVEAL_PARALYSIS_VENT_SILENTLY','DF_SHOW_POISON_GAS_VENT','DF_POISON_GAS_VENT_OPEN','DF_SHOW_POISON_GAS_TRAP','DF_SHOW_FLAMETHROWER_TRAP'];
try{
 for(const name of process.argv.slice(2).length?process.argv.slice(2):names){
  const inputs=[],stage=name==='final'?15:Number(name.slice(1));
  await build({entryPoints:['scripts/u17d-observe.ts'],outfile:`${work}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},args=>{
   const file=path.relative(process.cwd(),args.path);let contents=fs.readFileSync(args.path,'utf8');const before=hash(contents);
   if(name==='head')contents=head(file);
   else if(file==='src/engine/Map/DungeonFeatureCatalog.ts'){
    for(const id of ids.slice(stage)){
     const a=contents.indexOf(`    [DF.${id}]: {`),b=contents.indexOf('\n    },',a);if(a<0||b<0)throw Error(id);
     const row=contents.slice(a,b);if(!/tile: TerrainType\./.test(row))throw Error(id);
     contents=contents.slice(0,a)+row.replace(/tile: TerrainType\.\w+/,'tile: null')+contents.slice(b);
    }
   }else if(file==='src/engine/Map/TerrainCatalog.ts'&&stage<3){
    contents=contents.replace("0, 'DF_PLAIN_FIRE', '', 'DF_PILOT_LIGHT', 0, false, LightKind.TORCH_LIGHT", "0, 'DF_PLAIN_FIRE', '', 'DF_PILOT_LIGHT', 0");
   }else if(file==='src/engine/Map/AutoGenerator.ts'){
    for(const [index,on] of [[14,12],[19,13],[21,14],[27,15]])if(stage<on){const old=head(file);const a=contents.indexOf(`        ceLine: `,contents.indexOf('export const AUTO_GENERATOR_CATALOG'));
     const needle=`index: ${index},`,start=contents.lastIndexOf('    {',contents.indexOf(needle)),end=contents.indexOf('\n    },',start)+7,oa=old.lastIndexOf('    {',old.indexOf(needle)),ob=old.indexOf('\n    },',oa)+7;
     if(a<0||start<0||oa<0)throw Error(needle);contents=contents.slice(0,start)+old.slice(oa,ob)+contents.slice(end);
    }
   }else if(file==='src/engine/Core/Game.ts'){
    if(stage<10)contents=head(file);
    else if(stage<11){contents=contents.replace(/                    \/\/ CE Time.c:249:[\s\S]*?                    triggerCreatureTrapLayers/, '                    triggerCreatureTrapLayers');
     contents=contents.replace("if (instantTarget || ((cellTerrainFlags(this.grid, x, y) & T_IS_DF_TRAP)\n                && !cell.layers.includes(TerrainType.TRAP) && !cell.layers.includes(TerrainType.PRESSURE_PLATE)))", 'if (instantTarget)');
    }
   }
   inputs.push({file,before,used:hash(contents)});return{contents,loader:file.endsWith('.json')?'json':'ts'};
  });}}]});
  const fd=fs.openSync(`${out}/generation-${name}.txt`,'w');const result=spawnSync(process.execPath,[`${work}/${name}.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
  fs.writeFileSync(`${out}/inputs-${name}.json`,JSON.stringify(inputs,null,2)+'\n');if(result.status!==0)throw Error(`${name}: ${result.status}`);console.log(name,'captured');
 }
 const summary=[];for(let i=1;i<names.length;i++){
  const a=`${out}/generation-${names[i-1]}.json.gz`,b=`${out}/generation-${names[i]}.json.gz`;if(!fs.existsSync(a)||!fs.existsSync(b))continue;
  const before=JSON.parse(gunzipSync(fs.readFileSync(a))),after=JSON.parse(gunzipSync(fs.readFileSync(b)));
  summary.push({from:names[i-1],to:names[i],differences:after.flatMap((r,j)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[j][k])).map(field=>({seed:r.seed,depth:r.depth,field,before:before[j][field],after:r[field]})))});
 }
 fs.writeFileSync(`${out}/generation-stages.json`,JSON.stringify(summary,null,2)+'\n');console.log(summary.map(s=>[s.from,s.to,s.differences.length]));
}finally{fs.rmSync(work,{recursive:true,force:true});}
