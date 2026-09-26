import fs from 'node:fs';import {defineConfig} from 'vitest/config';
const variant=process.env.U19D_VARIANT;
export default defineConfig({plugins:[{name:'u19d-negative',enforce:'pre',load(id){
 if(!/\/src\/engine\/.*\.ts$/.test(id))return;
 let s=fs.readFileSync(id,'utf8');const file=id.split('/').pop();
 if(variant==='old-premises'&&['BlueprintEngine.ts','Game.ts'].includes(file!))return fs.readFileSync(`ai_docs/reports/u-19d-evidence/${file!.replace('.ts','')}-before.ts.txt`,'utf8');
 if(file==='BlueprintEngine.ts'){
  if(variant==='retire-lever')s=s.replace('// U19d: CE18 is eligible again:',"if (bp.ceBlueprintId === 18) return false;\n    // U19d: CE18 is eligible again:");
  if(variant==='reject-cage-selection')s=s.replace(' || (bp.ceBlueprintId === 28 && t === TerrainType.ALTAR_CAGE_RETRACTABLE)','');
  if(variant==='reject-cage-final')s=s.replace('&& !isThrowingTutorialReward(this.grid, bp.id, machineNum, spawn)','');
 }
 if(file==='Game.ts'&&variant==='discard-cage')s=s.replace('&& !isThrowingTutorialReward(this.grid, mr.blueprintId, mr.machineNumber, spawn)','');
 if(file==='DungeonFeatureCatalog.ts'){
  const table:Record<string,[string,string,string]>={
   'no-lever':['DF_PULL_LEVER','tile: TerrainType.WALL_LEVER_PULLED','tile: TerrainType.WALL_LEVER'],
   'no-hole':['DF_MEDIUM_HOLE','startProbability: 225','startProbability: 0'],
   'no-cage':['DF_CAGE_DISAPPEARS','tile: TerrainType.ALTAR,','tile: TerrainType.ALTAR_CAGE_RETRACTABLE,'],
   'no-paralysis':['DF_PARALYSIS_VENT_SPEW','tile: TerrainType.PARALYSIS_GAS','tile: TerrainType.STEAM'],
   'no-statue-wake':['DF_STATUE_SHATTER','DFF_ACTIVATE_DORMANT_MONSTER','0'],
  };
  if(variant&&table[variant]){const [df,a,b]=table[variant]!,start=s.indexOf(`[DF.${df}]:`),end=s.indexOf('\n    },',start);const block=s.slice(start,end);if(!block.includes(a))throw Error(`missing mutation ${variant}`);s=s.slice(0,start)+block.replace(a,b)+s.slice(end);}
 }
 return s;
}}],test:{testTimeout:120000}});
