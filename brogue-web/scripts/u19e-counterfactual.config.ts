import fs from 'node:fs';import {defineConfig} from 'vitest/config';
const variant=process.env.U19E_VARIANT;
export default defineConfig({plugins:[{name:'u19e-negative',enforce:'pre',load(id){
 if(!/\/src\/engine\/.*\.ts$/.test(id))return;
 let s=fs.readFileSync(id,'utf8');const file=id.split('/').pop();
 const replace=(a:string,b:string)=>{if(!s.includes(a))throw Error(`Missing mutation ${variant}`);s=s.replace(a,b);};
 if(file==='BlueprintEngine.ts'){
  if(variant==='restore-selection')replace('&& (!f.terrain || TERRAIN_MAP[f.terrain] !== undefined);','&& (!f.terrain || (TERRAIN_MAP[f.terrain] !== undefined && !isPathingBlocker(TERRAIN_MAP[f.terrain]!)));');
  if(variant==='restore-final')replace('// Do not publish a transaction',"for (const spawn of itemSpawns) if (spawn.viaAdoption && isPathingBlocker(this.grid.getCell(spawn.pos.x, spawn.pos.y)!.terrain)) return fail('counterfactual blocked adoption');\n        // Do not publish a transaction");
 }
 if(file==='Game.ts'){
  if(variant==='discard-recipe')replace('if (!this.grid.getCell(spawn.pos.x, spawn.pos.y)) continue;','if (!this.grid.getCell(spawn.pos.x, spawn.pos.y) || (cellTerrainFlags(this.grid, spawn.pos.x, spawn.pos.y) & T_PATHING_BLOCKER)) continue;');
  if(variant==='no-commutation')replace('commuteFloorItems: () => game.commuteFloorItems(),','commuteFloorItems: () => {},');
  if(variant==='no-resurrection')replace('setAllyResurrector(this.grid, origin => this.resurrectAlly(origin));','setAllyResurrector(this.grid, () => false);');
  if(variant==='no-sacrifice-entry')replace('entity instanceof Monster && entity.markedForSacrifice','entity instanceof Monster && false && entity.markedForSacrifice');
  if(variant==='no-cage-return')replace('private keyMatchesLocation(theItem: Item, x: number, y: number, cell: Cell | undefined): boolean {','private keyMatchesLocation(theItem: Item, x: number, y: number, cell: Cell | undefined): boolean {\n        if (cell?.layers.includes(TerrainType.ALTAR_CAGE_CLOSED)) return false;');
  if(variant==='no-sacrifice-mark')replace("leaderMon.markedForSacrifice = h.flags.includes('HORDE_SACRIFICE_TARGET');",'leaderMon.markedForSacrifice = false;');
 }
 if(file==='DungeonFeatureCatalog.ts'){
  const table:Record<string,[string,string,string]>={
   'no-cage-close':['DF_ITEM_CAGE_CLOSE','tile: TerrainType.ALTAR_CAGE_CLOSED','tile: TerrainType.ALTAR_CAGE_OPEN'],
   'no-sacrifice-cage':['DF_CAGE_DISAPPEARS','tile: TerrainType.ALTAR,','tile: TerrainType.ALTAR_CAGE_RETRACTABLE,'],
  };
  if(variant&&table[variant]){const [df,a,b]=table[variant]!,start=s.indexOf(`[DF.${df}]:`),end=s.indexOf('\n    },',start),block=s.slice(start,end);if(!block.includes(a))throw Error('Missing DF mutation');s=s.slice(0,start)+block.replace(a,b)+s.slice(end);}
 }
 return s;
}}],test:{testTimeout:120000}});
