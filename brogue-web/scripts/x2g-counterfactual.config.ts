import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
const cases: Record<string,[string,string,string]> = {
 poison:['Game.ts',"entity.addPoison(Math.max(0, 5 - entity.getStatusDuration('poisoned')), 0)","entity.addPoison(Math.max(0, 5 - entity.getStatusDuration('poisoned')), 1)"],
 growth:['DungeonFeatureCatalog.ts',"DungeonLayer.SURFACE, 2, 100, DFF_BLOCKED_BY_OTHER_LAYERS", "DungeonLayer.SURFACE, 100, 100, DFF_BLOCKED_BY_OTHER_LAYERS"],
 darkness:['TerrainCatalog.ts',"[TerrainType.DARKNESS_CLOUD]: e(0, TM_STAND_IN_TILE, 0, 'DF_GAS_FIRE', '', '', 0, false, LightKind.DARKNESS_CLOUD_LIGHT)","[TerrainType.DARKNESS_CLOUD]: e(0, TM_STAND_IN_TILE, 0, 'DF_GAS_FIRE')"],
 blood:['Monster.ts','Math.trunc(12 * (15 + Math.trunc(Math.min(damage, this.hp) * 3 / 2)) / 100) * 100','Math.trunc(12 * (15 + Math.min(damage, this.hp) * 3 / 2))'],
 puff:['DungeonFeatureCatalog.ts',"df(41, 664, 'ROT_GAS', TerrainType.ROT_GAS, DungeonLayer.GAS, 15,", "df(41, 664, 'ROT_GAS', TerrainType.ROT_GAS, DungeonLayer.GAS, 14,"],
 chance:['Monster.ts','if (rng.randPercent(20)) {','if (rng.randPercent(100)) {'],
 visibility:['Submersion.ts','return isSubmerged(target) && !(observer','return false && isSubmerged(target) && !(observer'],
 bolt:['BoltTrajectory.ts','const creature = isSubmerged(occupant) ? undefined : occupant;','const creature = occupant;'],
 save:['EntitySnapshot.ts',"'regenTurns', 'accuracy', 'defense', 'regenCounter', 'spawnLoc', 'submerged',","'regenTurns', 'accuracy', 'defense', 'regenCounter', 'spawnLoc',"],
 tint:['Appearance.ts','Math.min(90, 30 + cell.volume)','Math.min(90, cell.volume)'],
};
const variant=process.env.X2G_VARIANT;if(!variant||!cases[variant])throw Error('Unknown X2g negative');
const [file,before,after]=cases[variant]!;
export default defineConfig({plugins:[{name:'x2g-isolated-negative',enforce:'pre',load(id){
 if(!id.endsWith('/'+file))return;
 const source=fs.readFileSync(id,'utf8');if(!source.includes(before))throw Error('Missing mutation '+variant);
 return source.replace(before,after);
}}],test:{testTimeout:900000,hookTimeout:120000}});
