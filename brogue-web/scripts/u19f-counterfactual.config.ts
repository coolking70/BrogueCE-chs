import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {defineConfig} from 'vitest/config';
const variant=process.env.U19F_VARIANT??'';
export default defineConfig({plugins:[{name:'u19f-negative',enforce:'pre',load(id){
 if(!/\/src\/engine\/.*\.ts$/.test(id))return;
 let s=fs.readFileSync(id,'utf8');const file=id.split('/').pop();
 const replace=(a:string,b:string)=>{if(!s.includes(a))throw Error(`Missing mutation ${variant}`);s=s.replace(a,b);};
 if(file==='AutoGenerator.ts'&&variant.startsWith('auto')){
  const index=Number(variant.slice(4)),pattern=new RegExp(`        ceLine: \\d+, index: ${index},[\\s\\S]*?\\n    },`);
  if(!pattern.test(s))throw Error('mutation missing row');s=s.replace(pattern,block=>block.replace("carrier: 'wired'","carrier: 'no-tile'"));
 }
 if(file==='BlueprintEngine.ts'&&/^retire(52|55)$/.test(variant))replace('    if (RETIRED_INVENTED_BLUEPRINT_IDS',`    if (bp.ceBlueprintId === ${variant.slice(6)}) return false;\n    if (RETIRED_INVENTED_BLUEPRINT_IDS`);
 if(file==='WallDoorFinish.ts'&&variant==='old-wall')return execFileSync('git',['show','HEAD:brogue-web/src/engine/Map/WallDoorFinish.ts'],{encoding:'utf8'});
 if(file==='Game.ts'){
  if(variant==='no-bump')replace('&& promoteOnPlayerBump(this.grid, newX, newY, () => {','&& false && promoteOnPlayerBump(this.grid, newX, newY, () => {');
  if(variant==='old-search')s=s.replaceAll('(TERRAIN_FLAGS[t].mechFlags & TM_IS_SECRET) !== 0','t === TerrainType.SECRET_DOOR');
  if(variant==='no-flash')replace('poisonGasColor: { r: 75, g: 25, b: 85 },','');
 }
 if(file==='Bolt.ts'&&variant==='no-spark')replace('if (effect !== BoltEffect.LIGHTNING && effect !== BoltEffect.SPARK) return false;','if (effect !== BoltEffect.LIGHTNING) return false;');
 if(file==='DungeonFeatureCatalog.ts'&&variant==='no-active-tunnel')replace("ceTile: 'WORM_TUNNEL_MARKER_ACTIVE', tile: TerrainType.WORM_TUNNEL_MARKER_ACTIVE,","ceTile: 'WORM_TUNNEL_MARKER_ACTIVE', tile: TerrainType.NOTHING,");
 return s;
}}],test:{testTimeout:120000}});
