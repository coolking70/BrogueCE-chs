// Sequential, one-carrier increments; bundled variants never mutate working inputs.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-17b-evidence',work=fs.mkdtempSync(path.join(os.tmpdir(),'u17b-generation-'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const carriers=['TRAMPLED_FOLIAGE','ACTIVE_BRIMSTONE','BRIMSTONE_FIRE','OPEN_IRON_DOOR_INERT','BRIDGE_FALLING'];
const names=['head','s0','s1','s2','s3','s4','s5','s6','s7','s8','final'];
try{
 for(const name of process.argv.slice(2).length?process.argv.slice(2):names){
  const inputs=[];const stage=name==='final'?9:Number(name.slice(1));
  await build({entryPoints:['scripts/u17b-observe.ts'],outfile:`${work}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},args=>{
   const file=path.relative(process.cwd(),args.path);let contents=fs.readFileSync(args.path,'utf8');const before=hash(contents);
   if(name==='head'||(stage<7 && ['src/engine/Items/Item.ts','src/engine/Core/EntitySnapshot.ts'].includes(file)))contents=execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'});
   else if(file==='src/engine/Map/DungeonFeatureCatalog.ts')for(const tile of carriers.slice(stage)){
    const from=`ceTile: '${tile}', tile: TerrainType.${tile}`;
    if(!contents.includes(from))throw Error(`missing ${from}`);contents=contents.replace(from,`ceTile: '${tile}', tile: null`);
   }
   else if(file==='src/engine/Core/Game.ts'){
    if(stage<7){
     contents=execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'});
     if(stage===6)contents=contents.replace('TM_PROMOTES_ON_PLAYER_ENTRY, TM_PROMOTES_ON_CREATURE,','TM_PROMOTES_ON_PLAYER_ENTRY, TM_PROMOTES_WITH_KEY, TM_PROMOTES_ON_CREATURE,').replace(`this.grid.setTerrain(newX, newY, TerrainType.OPEN_DOOR, "'", 0xaa8844);`,'promoteLayersWithMechFlag(this.grid, newX, newY, TM_PROMOTES_WITH_KEY);');
    }else {
     if(stage<9){
      const head=execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'});
      const oldLava=head.slice(head.indexOf('    private destroyFloorItemsInLava()'),head.indexOf('    public getMonsterAt'))
       .replace('if (itemCell &&','if (this.absoluteTurnNumber >= item.spawnTurnNumber && itemCell &&');
      contents=contents.slice(0,contents.indexOf('    /** CE Items.c:1256-1261'))+oldLava+contents.slice(contents.indexOf('    public getMonsterAt'));
      const oldBurn=head.slice(head.indexOf('    private burnFloorItemsAt('),head.indexOf('    /** CE Items.c:4089'));
      contents=contents.slice(0,contents.indexOf('    private burnFloorItemsAt('))+oldBurn+contents.slice(contents.indexOf('    /** CE Items.c:4089'));
      contents=contents.replace('this.fallFloorItems();\n        this.burnFloorItems();\n        this.driftFloorItems();','this.fallFloorItems();\n        this.driftFloorItems();\n\n        this.destroyFloorItemsInLava();');
     }
     if(stage===7)contents=contents.replace('promoteOnItemPlaced(this.grid, x, y);\n                continue;','/* previous stage: stationary item promotion absent */\n                continue;');
    }
   }
   inputs.push({file,before,used:hash(contents)});return{contents,loader:file.endsWith('.json')?'json':'ts'};
  });}}]});
  const fd=fs.openSync(`${out}/generation-${name}.txt`,'w');
  const result=spawnSync(process.execPath,[`${work}/${name}.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
  fs.writeFileSync(`${out}/inputs-${name}.json`,JSON.stringify(inputs,null,2)+'\n');if(result.status!==0)throw Error(`${name}: ${result.status}`);console.log(name,'captured');
 }
 const summary=[];
 for(let i=1;i<names.length;i++){
  const a=`${out}/generation-${names[i-1]}.json.gz`,b=`${out}/generation-${names[i]}.json.gz`;if(!fs.existsSync(a)||!fs.existsSync(b))continue;
  const before=JSON.parse(gunzipSync(fs.readFileSync(a))),after=JSON.parse(gunzipSync(fs.readFileSync(b)));
  const diffs=after.flatMap((r,j)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[j][k])).map(field=>({seed:r.seed,depth:r.depth,field,before:before[j][field],after:r[field]})));
  summary.push({from:names[i-1],to:names[i],differences:diffs});
 }
 fs.writeFileSync(`${out}/generation-stages.json`,JSON.stringify(summary,null,2)+'\n');console.log(summary.map(s=>[s.to,s.differences.length]));
}finally{fs.rmSync(work,{recursive:true,force:true});}
