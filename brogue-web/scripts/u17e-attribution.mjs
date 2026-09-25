// Cumulative single-carrier and single-entry-point variants. The working tree is never toggled.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {execFileSync,spawn} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-17e-evidence',work=fs.mkdtempSync(path.join(os.tmpdir(),'u17e-generation-'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const names=['head','base','support',...Array.from({length:9},(_,i)=>`s${i}`),'final'];
const head=file=>execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'});
const ids=['DF_ITEM_CAGE_CLOSE','DF_ALTAR_COMMUTE','DF_MAGIC_PIPING','DF_ALTAR_RESURRECT','DF_SACRIFICE_ALTAR'];
try{
 const selected=process.argv.slice(2).length?process.argv.slice(2):names;
 for(let offset=0;offset<selected.length;offset+=3)await Promise.all(selected.slice(offset,offset+3).map(async name=>{
  const inputs=[],stage=name==='final'?8:['base','support'].includes(name)?0:Number(name.slice(1));
  await build({entryPoints:['scripts/u17e-observe.ts'],outfile:`${work}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},args=>{
   const file=path.relative(process.cwd(),args.path);let contents=fs.readFileSync(args.path,'utf8');const before=hash(contents);
   if(name==='head')contents=head(file);
   else if(file==='src/engine/Map/DungeonFeatureCatalog.ts'){
    for(const id of ids.slice(stage)){
     const a=contents.indexOf(`    [DF.${id}]: {`),b=contents.indexOf('\n    },',a);if(a<0||b<0)throw Error(id);
     const row=contents.slice(a,b);if(!/tile: TerrainType\./.test(row))throw Error(id);
     contents=contents.slice(0,a)+row.replace(/tile: TerrainType\.\w+/,'tile: null')+contents.slice(b);
    }
   }
   if(['base','support'].includes(name)&&file==='src/engine/Core/Game.ts'){
    contents=contents.replace('keyOnTileAt: (x, y) => this.keyOnTileAt(x, y)', 'keyOnTileAt: (x, y) => this.items.some(it => it.category === ItemCategory.KEY && it.x === x && it.y === y)');
   }
   if(name==='base'&&file==='src/engine/Core/Game.ts'){
    contents=contents.replace('if ((cellTerrainFlags(this.grid, x, y) & T_LAVA_INSTA_DEATH) && !isFlying', 'if (cell.layers.includes(TerrainType.LAVA) && !isFlying');
   }
   if(name!=='head'&&file==='src/data/blueprints.json'){
    const blueprints=JSON.parse(contents);
    for(const bp of blueprints){
     if(stage<6&&bp.ceBlueprintId===6)for(const f of bp.features)delete f.featureDF;
     if(stage<8&&[1,2,26].includes(bp.ceBlueprintId))for(const f of bp.features)delete f.itemFlags;
    }
    // Keep byte identity at the final stage for the recapture input guard.
    if(stage<8)contents=JSON.stringify(blueprints);
   }
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
