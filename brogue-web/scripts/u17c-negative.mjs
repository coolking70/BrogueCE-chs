// Each defect runs against the real trigger suite in an isolated source copy.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync,execFileSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17c-evidence'),base=fs.mkdtempSync(path.join(os.tmpdir(),'u17c-negative-'));
const df='src/engine/Map/DungeonFeatureCatalog.ts',game='src/engine/Core/Game.ts',promotion='src/engine/Map/Promotion.ts';
const change=(s,a,b)=>{if(!s.includes(a))throw Error(`Mutation anchor absent: ${a}`);return s.replace(a,b);};
const cases=[...['MACHINE_PRESSURE_PLATE_USED','TRAP_DOOR','WALL_LEVER','MACHINE_TRIGGER_FLOOR_REPEATING'].map(tile=>({name:`missing-${tile}`,file:df,edit:s=>s.replaceAll(`tile: TerrainType.${tile},`,`tile: null,`)})),
 {name:'no-bump',file:promotion,edit:s=>change(s,'export function promoteOnPlayerBump(grid: Grid, x: number, y: number, before?: () => void): boolean {','export function promoteOnPlayerBump(grid: Grid, x: number, y: number, before?: () => void): boolean { return false;')},
 {name:'search-door-only',file:game,edit:s=>s.replaceAll(' || t === TerrainType.TRAP_DOOR_HIDDEN || t === TerrainType.WALL_LEVER_HIDDEN','')},
 {name:'plate-old-radius',file:game,edit:s=>{const old=execFileSync('git',['show',`HEAD:brogue-web/${game}`],{encoding:'utf8'});const a=s.indexOf('    /** CE Time.c:240-274: machine pressure plates'),b=s.indexOf('\n    /** CE Items.c:5516',a);return s.slice(0,a)+old.slice(old.indexOf('    /** Pressure plate triggers'),old.indexOf('\n    /** CE Items.c:5516'))+s.slice(b);}},
 {name:'no-item-promotion',file:promotion,edit:s=>change(s,'export function promoteOnItemPlaced(grid: Grid, x: number, y: number): PromoteTileResult[] {','export function promoteOnItemPlaced(grid: Grid, x: number, y: number): PromoteTileResult[] { return [];')},
 {name:'no-repeat-wait',file:game,edit:s=>change(s,'const playerStepPromotions = promoteLayersWithMechFlag(this.grid, this.player.x, this.player.y, TM_PROMOTES_ON_CREATURE | TM_PROMOTES_ON_PLAYER_ENTRY);','const playerStepPromotions = promoteOnStep(this.grid, this.player.x, this.player.y);')},
 {name:'no-medium-hole-data',file:'src/data/blueprints.json',edit:s=>s.replaceAll('"featureDF": "DF_MEDIUM_HOLE"','"featureDF": "DF_SHOW_TRAPDOOR"')},
];const results=[];
try{
 fs.cpSync('src',`${base}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${base}/${p}`);fs.symlinkSync(path.join(cwd,'node_modules'),`${base}/node_modules`,'dir');
 for(const c of cases){const original=fs.readFileSync(c.file,'utf8');fs.writeFileSync(`${base}/${c.file}`,c.edit(original));
  const fd=fs.openSync(`${out}/negative-${c.name}.txt`,'w');const r=spawnSync(process.execPath,[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run','src/test/u_17c_triggers.test.ts','--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-${c.name}.json`],{cwd:base,stdio:['ignore',fd,fd]});fs.closeSync(fd);fs.writeFileSync(`${base}/${c.file}`,original);
  const report=JSON.parse(fs.readFileSync(`${out}/negative-${c.name}.json`));results.push({name:c.name,exit:r.status,failed:report.numFailedTests,titles:report.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>a.title))});if(r.status===0||report.numFailedTests===0)throw Error(`Surviving defect: ${c.name}`);
 }
}finally{fs.writeFileSync(`${out}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');fs.rmSync(base,{recursive:true,force:true});}
