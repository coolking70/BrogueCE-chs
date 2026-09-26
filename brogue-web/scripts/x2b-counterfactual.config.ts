import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
const variant=process.env.X2B_VARIANT;
export default defineConfig({plugins:[{name:'x2b-negative',enforce:'pre',load(id){
 if(!/\/src\/.*\.ts$/.test(id)||id.includes('/test/'))return;
 const file=path.relative(process.cwd(),id);let s=fs.readFileSync(id,'utf8');
 const replace=(a:string,b:string)=>{if(!s.includes(a))throw Error(`Missing mutation ${variant}: ${file}`);s=s.replace(a,b);};
 if(file.endsWith('/Grid.ts')) {
  if(variant==='effective-only') replace('flags |= TERRAIN_FLAGS[this.layers[layer]!]!.flags;','flags |= TERRAIN_FLAGS[this.terrain].flags;');
  if(variant==='skip-gas') replace('flags |= TERRAIN_FLAGS[this.layers[layer]!]!.flags;','if (layer !== DungeonLayer.GAS) flags |= TERRAIN_FLAGS[this.layers[layer]!]!.flags;');
  if(variant==='layer-write') replace('cell.layers[layer] = terrain;\n            cell.refreshTerrainProperties();','cell.layers[layer] = terrain;');
  if(variant==='home-write') replace('    cell.refreshTerrainProperties();\n}\n\n/**\n * Represents','}\n\n/**\n * Represents');
 }
 if(file.endsWith('/LevelSnapshot.ts')&&variant==='snapshot')replace('        cell.refreshTerrainProperties();','');
 if(file.endsWith('/Game.ts')) {
  if(variant==='generation-arcs')replace('return terrainPassableArcCount(this.grid, x, y);','const dirs = [[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]]; const pass = (d:number[]) => !!this.grid.getCell(x+d[0]!,y+d[1]!)?.isPassable; return dirs.reduce((n,d,i)=>n+(pass(d)!==pass(dirs[(i+7)%8]!)?1:0),0)/2;');
  if(variant==='search')replace('if (!cell.isPassable) {\n                percent','if (blocksPassability(cell.terrain)) {\n                percent');
  if(variant==='force')replace('!cell.isPassable || cell.isOpaque || this.getMonsterAt(nx, ny)','!cell.isPassable || this.getMonsterAt(nx, ny)');
  if(variant==='stagger')replace('        this.placeCreature(defender, { x: newX, y: newY });','        if (this.canMoveTo(newX,newY)) this.placeCreature(defender, {x:newX,y:newY});');
  if(variant==='room-restore')replace('this.environment.clearGasAt(terrain.x, terrain.y);','this.environment.clearGasAt(terrain.x, terrain.y); cell.isPassable = terrain.isPassable; cell.isOpaque = terrain.isOpaque;');
  if(variant==='split')replace('!cell || monsterBlinkAvoids(this, defender, { x: nx, y: ny })','!cell || !cell.isPassable');
 }
 if(file.endsWith('/Monster.ts')&&variant==='flight')replace('return this.canEnterWaterTerrain(game, x, y)\n            && !monsterBlinkAvoids(game, this, { x, y });','return !game.grid.getCell(x,y)!.isOpaque;');
 if(file.endsWith('/PlayerTravel.ts')&&variant==='hidden-travel')replace('    if (layers.some(tile => terrainMechFlags(tile) & TM_IS_SECRET)) return true;','');
 if(file.endsWith('/PlayerTravel.ts')&&variant==='travel')replace('    const flags = knownFlags(cell), origin = knownFlags(here);','    if (cell.isVisible) return cell.isPassable;\n    const flags = knownFlags(cell), origin = knownFlags(here);');
 return s;
}}],test:{testTimeout:900000,hookTimeout:120000}});
