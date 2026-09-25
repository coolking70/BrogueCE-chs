// Isolated working copies: expected-red variants and old-premise counterfactuals.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync,execFileSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17b-evidence'),base=fs.mkdtempSync(path.join(os.tmpdir(),'u17b-negative-')),temp=path.join(base,'brogue-web');fs.mkdirSync(temp);
const catalog='src/engine/Map/DungeonFeatureCatalog.ts',game='src/engine/Core/Game.ts';
const variants=[
 ...['TRAMPLED_FOLIAGE','ACTIVE_BRIMSTONE','BRIMSTONE_FIRE','BRIDGE_FALLING'].map((tile,i)=>({name:`missing-${tile}`,file:catalog,from:`ceTile: '${tile}', tile: TerrainType.${tile}`,to:`ceTile: '${tile}', tile: null`,test:['61 actual','66 environment','104 active timeout','98 fire bolt'][i]})),
 {name:'wooden-door-bypass',file:game,from:'promoteLayersWithMechFlag(this.grid, newX, newY, TM_PROMOTES_WITH_KEY);',to:`this.grid.setTerrain(newX, newY, TerrainType.OPEN_DOOR, "'", 0xaa8844);`,test:'83 wrong key'},
 {name:'no-item-fall',file:game,from:'        this.fallFloorItems();',to:'        /* missing floor item fall */',test:'bridge floor item fall|D40 floor'},
 {name:'future-fall',file:game,from:'if (this.absoluteTurnNumber < item.spawnTurnNumber\n                || !(cellTerrainFlags(this.grid, item.x, item.y) & T_AUTO_DESCENT)) continue;',to:'if (!(cellTerrainFlags(this.grid, item.x, item.y) & T_AUTO_DESCENT)) continue;',test:'fall landing uses'},
 {name:'no-stationary-trample',file:game,from:'promoteOnItemPlaced(this.grid, x, y);\n                continue;',to:'/* missing stationary item promotion */\n                continue;',test:'61 fallen item'},
 {name:'no-df-refresh',file:'src/engine/Map/DungeonFeature.ts',from:'return refresh && refreshFeatureCell(grid, pos, feat.tile, effects);',to:'return false;',test:'61 actual|no evacuation'},
 {name:'missing-item-clock-snapshot',file:'src/engine/Core/EntitySnapshot.ts',from:"'description', 'spawnTurnNumber',",to:"'description',",test:'bridge floor item fall'},
 {name:'no-thermal-floor-consumer',file:game,from:'        this.burnFloorItems();',to:'        /* missing post-fall thermal consumer */',test:'fallen items on existing'},
 {name:'D2-old-stationary-premise',file:game,from:'promoteOnItemPlaced(this.grid, x, y);\n                continue;',to:'/* former premise */\n                continue;',test:'D2 踩楼梯',tests:['src/test/c_4c_promotion.test.ts'],expected:0},
];
const requested=process.argv.slice(2),summary=[];
try{
 fs.cpSync('src',`${temp}/src`,{recursive:true});fs.cpSync('scripts',`${temp}/scripts`,{recursive:true});
 for(const f of ['package.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json'])fs.copyFileSync(f,`${temp}/${f}`);
 fs.symlinkSync(path.join(cwd,'node_modules'),`${temp}/node_modules`,'dir');fs.symlinkSync(path.join(cwd,'../BrogueCE-master'),`${base}/BrogueCE-master`,'dir');
 for(const v of variants.filter(v=>!requested.length||requested.includes(v.name))){
  const originals=new Set(variants.map(v=>v.file));for(const file of originals)fs.copyFileSync(file,`${temp}/${file}`);
  if(v.name==='D2-old-stationary-premise')fs.writeFileSync(`${temp}/src/test/c_4c_promotion.test.ts`,execFileSync('git',['show','HEAD:brogue-web/src/test/c_4c_promotion.test.ts']));
  const before=fs.readFileSync(v.file,'utf8'),after=before.replace(v.from,v.to);if(before===after)throw Error(`Missed ${v.name}`);fs.writeFileSync(`${temp}/${v.file}`,after);
  const fd=fs.openSync(`${out}/negative-${v.name}.txt`,'w');
  const r=spawnSync(process.execPath,[`${cwd}/node_modules/vitest/vitest.mjs`,'run',...(v.tests??['src/test/u_17b_carriers.test.ts']),'-t',v.test,'--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-${v.name}.json`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  summary.push({name:v.name,exit:r.status,expected:v.expected??1});console.log(summary.at(-1));
 }
 fs.writeFileSync(`${out}/negative-summary${requested.length?'-selected':''}.json`,JSON.stringify(summary,null,2)+'\n');if(summary.some(r=>r.exit!==r.expected))process.exitCode=1;
}finally{fs.rmSync(base,{recursive:true,force:true});}
