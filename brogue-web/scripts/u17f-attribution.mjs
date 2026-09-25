// Cumulative single-carrier and single-entry-point variants. The working tree is never toggled.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {execFileSync,spawn} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-17f-evidence',work=fs.mkdtempSync(path.join(os.tmpdir(),'u17f-generation-'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const names=['head','base','allies','keys',...Array.from({length:6},(_,i)=>`s${i+1}`),'rubble','final'];
const head=file=>execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'});
const ids=['DF_WALL_CRACK','DF_CRACKING_STATUE','DF_COFFIN_BURSTS','DF_WORM_TUNNEL_MARKER_ACTIVE','DF_ALTAR_RETRACT','DF_PORTAL_ACTIVATE'];
try{
 const selected=process.argv.slice(2).length?process.argv.slice(2):names;
 for(let offset=0;offset<selected.length;offset+=3)await Promise.all(selected.slice(offset,offset+3).map(async name=>{
  const inputs=[],stage=['final','rubble'].includes(name)?6:['base','allies','keys'].includes(name)?0:Number(name.slice(1));
  await build({entryPoints:['scripts/u17f-observe.ts'],outfile:`${work}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},args=>{
   const file=path.relative(process.cwd(),args.path);let contents=fs.readFileSync(args.path,'utf8');const before=hash(contents);
   if(name==='head')contents=head(file);
   else if(file==='src/engine/Map/DungeonFeatureCatalog.ts'){
    for(const id of ids.slice(stage)){
     const a=contents.indexOf(`    [DF.${id}]: {`),b=contents.indexOf('\n    },',a);if(a<0||b<0)throw Error(id);
     const row=contents.slice(a,b);if(!/tile: TerrainType\./.test(row))throw Error(id);
     contents=contents.slice(0,a)+row.replace(/tile: TerrainType\.\w+/,'tile: null')+contents.slice(b);
    }
   }
   if(name!=='head'&&!['rubble','final'].includes(name)&&file==='src/engine/Map/AutoGenerator.ts'){
    const a=contents.indexOf('        ceLine: 121, index: 7'),b=contents.indexOf('\n    },',a);
    contents=contents.slice(0,a)+contents.slice(a,b).replace('df: DF.DF_RUBBLE','df: null').replace("carrier: 'wired'","carrier: 'no-tile'")+contents.slice(b);
   }
   if(['base','allies'].includes(name)&&file==='src/engine/Core/Game.ts')contents=contents.replace('if (entity.hp > 0) this.useContactKeyAt(entity.loc.x, entity.loc.y);','');
   if(name==='base'&&file==='src/engine/Core/Game.ts')contents=contents.replaceAll("h.flags.includes('HORDE_ALLIED_WITH_PLAYER')",'false');
   inputs.push({file,before,used:hash(contents)});return{contents,loader:file.endsWith('.json')?'json':'ts'};
  });}}]});
  const fd=fs.openSync(`${out}/generation-${name}.txt`,'w');const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[`${work}/${name}.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});child.on('error',reject);child.on('close',(status)=>resolve({status}));});fs.closeSync(fd);
  fs.writeFileSync(`${out}/inputs-${name}.json`,JSON.stringify(inputs,null,2)+'\n');if(result.status!==0)throw Error(`${name}: ${result.status}`);console.log(name,'captured');
 }));
 const summary=[];for(let i=1;i<names.length;i++){
  const a=`${out}/generation-${names[i-1]}.json.gz`,b=`${out}/generation-${names[i]}.json.gz`;if(!fs.existsSync(a)||!fs.existsSync(b))continue;
  const before=JSON.parse(gunzipSync(fs.readFileSync(a))),after=JSON.parse(gunzipSync(fs.readFileSync(b)));
  summary.push({from:names[i-1],to:names[i],differences:after.flatMap((r,j)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[j][k])).map(field=>({seed:r.seed,depth:r.depth,field,before:before[j][field],after:r[field]})))});
 }
 fs.writeFileSync(`${out}/generation-stages.json`,JSON.stringify(summary,null,2)+'\n');console.log(summary.map(s=>[s.from,s.to,s.differences.length]));
}finally{fs.rmSync(work,{recursive:true,force:true});}
