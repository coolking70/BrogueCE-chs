// Fixed room fixtures, literal complete blueprints. This is test/browser setup,
// not a replacement for natural selection or a production eligibility bypass.
import {Grid,TerrainType as T,DCOLS,DROWS} from '../../engine/Map/Grid';
import {BlueprintEngine,type BlueprintDef} from '../../engine/Generator/BlueprintEngine';
import {FOVSys} from '../../engine/Lighting/FOV';
import {LightMap} from '../../engine/Lighting/LightMap';
import {EnvironmentManager} from '../../engine/Environment/Gas';
import {terrainFlagsOfCell} from '../../engine/Map/DungeonFeature';
import {T_PATHING_BLOCKER,T_OBSTRUCTS_PASSABILITY,T_OBSTRUCTS_VISION} from '../../engine/Map/TerrainCatalog';
import {rng} from '../../engine/Random';
import blueprints from '../../data/blueprints.json';
import type {Game} from '../../engine/Core/Game';
import type {Pos} from '../../types';

export const affectedCE=[15,18,24,36,37,38,46,49,55,56,62,65,66,71];
export function machineScene(game:Game,ce:number,seed:number,size=0){
 const g:any=game,bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===ce)!;
 g.grid=new Grid(DCOLS,DROWS);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);g.environment=new EnvironmentManager(g.grid);
 g.bindDormantAwakener();g.machineCells=new Set();g.depth=Math.max(bp.depthRange[0],Math.min(10,bp.depthRange[1]));
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];g.player.hp=g.player.maxHp=10000;g.player.statusDurations={};g.isGameOver=false;g.animationEnabled=false;
 const grid:Grid=g.grid;
 for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)grid.setTerrain(x,y,T.GRANITE);
 const cells:Pos[]=[],right=22+size*3,top=9-size,bottom=19+size;
 for(let x=12;x<=right;x++)for(let y=top;y<=bottom;y++){grid.setTerrain(x,y,T.FLOOR);cells.push({x,y});}
 for(let x=3;x<=10;x++)for(let y=6;y<=22;y++)grid.setTerrain(x,y,T.FLOOR);
 grid.setTerrain(11,14,T.FLOOR);
 const roomType=bp.flags.includes('BP_ROOM')||bp.category==='reward'||bp.category==='key';
 const origin={x:roomType?12:17,y:14};
 const room={cells,center:roomType?{x:17,y:14}:origin,door:roomType?origin:null};
 const engine:any=new BlueprintEngine(grid,g.depth),snapshots:any[]=[],seen=new WeakSet();
 const apply=engine.applyBlueprint.bind(engine),view=engine.featureView.bind(engine);let current=bp,index=-1;
 engine.applyBlueprint=(row:BlueprintDef,...args:any[])=>{const previous=current,previousIndex=index;current=row;index=-1;try{return apply(row,...args);}finally{current=previous;index=previousIndex;}};
 engine.featureView=(p:Pos,flags:Set<string>)=>{
  const result=view(p,flags);
  if(current===bp&&!seen.has(flags)){
   seen.add(flags);index=bp.features.findIndex((f,i)=>i>index&&JSON.stringify(f.flags)===JSON.stringify([...flags]));
   if(result){
    const passable=flags.has('MF_IN_PASSABLE_VIEW_OF_ORIGIN'),mask=passable?T_PATHING_BLOCKER:T_OBSTRUCTS_PASSABILITY|T_OBSTRUCTS_VISION,blocked:number[][]=[];
    for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)if(terrainFlagsOfCell(grid.getCell(x,y)!)&mask)blocked.push([x,y]);
    snapshots.push({ce,feature:index,origin:{...p},passable,blocked,view:result,accepted:[]});
   }
  }
  return result;
 };
 const candidate=engine.cellIsFeatureCandidate.bind(engine);
 engine.cellIsFeatureCandidate=(...args:any[])=>{
  const accepted=candidate(...args);
  if(accepted&&current===bp){const s=snapshots.find(s=>s.feature===index);if(s)s.accepted.push({x:args[0],y:args[1]});}
  return accepted;
 };
 rng.seedRandomGenerator(seed);
 const result=engine.applyBlueprint(bp,room,{adoptiveItem:bp.flags.includes('BP_ADOPT_ITEM')?{category:'KEY',id:'iron_key',instanceId:'u19a-key',pos:origin,keyLoc:[],viaAdoption:true}:null});
 if(!result)return null;
 for(const s of snapshots)s.placements=result.featureSpawns.filter((f:any)=>f.featureIndex===s.feature).map((f:any)=>f.pos);
 return {ce,seed,size,bp,origin,result,snapshots};
}

/** Execute the existing Game entry points from the real origin. If the feature
 * is a wall, walking targets its adjacent interaction square, never the wall. */
export function observeFromOrigin(game:Game,scene:NonNullable<ReturnType<typeof machineScene>>,performSearch=true){
 const g:any=game;
 // Normal population consumes the complete machine result, including real
 // monsters, adopted items and any recursive child machines.
 g.levelSeeds[g.depth-1].upStairsLoc={x:3,y:6};
 g.levelSeeds[g.depth-1].downStairsLoc={x:3,y:22};
 g.grid.setTerrain(3,6,T.STAIRS_UP);g.grid.setTerrain(3,22,T.STAIRS_DOWN);
 // CE15 has frequency=0 and an existing unsupported AMULET/* materializer.
 // Its constrained feature is the real STATUE_INSTACRACK terrain; inspect that
 // writer without pretending the unrelated item/monster payoff is complete.
 if(scene.ce!==15)g.populateLevel(g.depth,false,false,[scene.result]);
 g.player.loc={...scene.origin};g.updateVision();
 const targets=scene.snapshots.flatMap(s=>s.placements.map((p:Pos)=>({feature:s.feature,pos:p,passable:s.passable})));
 const occupants=(p:Pos)=>[...g.monsters,...g.dormantMonsters].filter(m=>m.x===p.x&&m.y===p.y).map(m=>({id:m.id,name:m.name,dormant:m.isDormant}));
 const before=targets.map(t=>({...t,visible:g.grid.getCell(t.pos.x,t.pos.y).isVisible,layers:[...g.grid.getCell(t.pos.x,t.pos.y).layers],occupants:occupants(t.pos)}));
 // Search is an actual player command: updates local visibility and may reveal
 // hidden levers, with normal turn advancement. Preserve its consequences.
 if(performSearch)g.handlePlayerAction('search',undefined,'system');g.updateVision();
 const after=targets.map(t=>({...t,visible:g.grid.getCell(t.pos.x,t.pos.y).isVisible,layers:[...g.grid.getCell(t.pos.x,t.pos.y).layers],occupants:occupants(t.pos)}));
 return {action:'search',origin:scene.origin,before,after,player:{...g.player.loc},
  materialization:scene.ce===15?'terrain only; existing AMULET/* materialization unsupported':'Game.populateLevel'};
}
