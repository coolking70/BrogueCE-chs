// Ordered single-lever variants; no source or baseline mutations.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-17c-evidence',work=fs.mkdtempSync(path.join(os.tmpdir(),'u17c-generation-'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const names=['head','s0','s1','s2','s3','s4','s5','s6','s7','s8','s9','final'];
const head=file=>execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'});
const replace=(s,a,b)=>{if(!s.includes(a))throw Error(`Missing stage anchor ${a}`);return s.replace(a,b);};
function section(s,a,b){return s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));}
try{
 for(const name of process.argv.slice(2).length?process.argv.slice(2):names){
  const inputs=[],stage=name==='final'?10:Number(name.slice(1));
  await build({entryPoints:['scripts/u17c-observe.ts'],outfile:`${work}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},args=>{
   const file=path.relative(process.cwd(),args.path);let contents=fs.readFileSync(args.path,'utf8');const before=hash(contents);
   if(name==='head')contents=head(file);
   else if(file==='src/engine/Map/DungeonFeatureCatalog.ts'){
    const ids=['DF_MACHINE_PRESSURE_PLATE_USED','DF_SHOW_TRAPDOOR','DF_MEDIUM_HOLE','DF_REVEAL_LEVER','DF_MACHINE_FLOOR_TRIGGER_REPEATING'];
    for(const id of ids.slice(stage)){
     const a=contents.indexOf(`    [DF.${id}]: {`),b=contents.indexOf('\n    },',a);if(a<0||b<0)throw Error(id);
     const row=contents.slice(a,b);if(!/tile: TerrainType\./.test(row))throw Error(id);
     contents=contents.slice(0,a)+row.replace(/tile: TerrainType\.\w+/,'tile: null')+contents.slice(b);
    }
   }else if(file==='src/data/blueprints.json'){
    const rows=JSON.parse(contents);for(const bp of rows){if(stage<3&&[22,28].includes(bp.ceBlueprintId))delete bp.features[bp.ceBlueprintId===22?0:1].featureDF;if(stage<5&&bp.ceBlueprintId===7)delete bp.features[2].featureDF;}
    // Use exact original bytes when no feature data is enabled.
    contents=stage<3?head(file):stage>=5?contents:JSON.stringify(rows);
   }else if(file==='src/engine/Map/AutoGenerator.ts'&&stage<10)contents=head(file);
   else if(file==='src/engine/Core/Game.ts'&&stage<9){
    const old=head(file),latest=contents;contents=old;
    if(stage>=6){
     const a='    /** Pressure plate triggers',b='\n    /** CE Items.c:5516';
     contents=replace(contents,section(contents,a,b),section(latest,'    /** CE Time.c:240-274: machine pressure plates',b));
    }
    if(stage>=7){
     contents=replace(contents,'    promoteOnItemPickup,','    discoverTerrain,\n    promoteOnItemPickup,');
     contents=replace(contents,section(contents,'    private searchForSecrets(', '    private manualSearch()'),section(latest,'    private searchForSecrets(', '    private manualSearch()'));
     if(stage===7)contents=contents.replaceAll(' || t === TerrainType.WALL_LEVER_HIDDEN','');
     // New descriptions have no simulation consequence; preserve exact final plumbing.
    }
    if(stage>=8){
     contents=replace(contents,'    promoteOnItemPickup,','    promoteOnPlayerBump,\n    promoteOnItemPickup,');
     const bump=section(latest,'                // CE Movement.c:1147-1161','                // P4-7：CE Movement.c:1175-1186');
     contents=replace(contents,'                // P4-7：CE Movement.c:1175-1186',bump+'                // P4-7：CE Movement.c:1175-1186');
     contents=replace(contents,'        if (cell?.isVisible) {\n            cell.isExplored = true; cell.hasMemory = true;', '        if (cell?.layers.includes(TerrainType.WALL_LEVER_HIDDEN)) this.secretScanDepth = -1;\n        if (cell?.isVisible) {\n            cell.isExplored = true; cell.hasMemory = true;');
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
