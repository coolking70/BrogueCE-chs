import type {Game} from '../../engine/Core/Game';
import type {MachineTrace} from '../../engine/Generator/MachineObservation';
import {TerrainType as T,type Cell} from '../../engine/Map/Grid';
import {TERRAIN_FLAGS,T_OBSTRUCTS_PASSABILITY} from '../../engine/Map/TerrainCatalog';
import {boltLine} from '../../engine/Combat/BoltTrajectory';
import {route,safe,type Action} from './u19d-machine-actions';
import type {Pos} from '../../types';

const dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
const same=(a:Pos,b:Pos)=>a.x===b.x&&a.y===b.y;
export function runCrystalWormActions(game:Game,trace:MachineTrace,origin:Pos){
 const g:any=game,ce=trace.ceBlueprintId!,machine=trace.machineNumber;
 const cells:Cell[]=g.grid.cells.flat(),owned=cells.filter(c=>c.machineNumber===machine);
 const neighbors=(p:Pos)=>dirs.map(d=>({x:p.x+d.x,y:p.y+d.y})).filter(p=>safe(g,p,true));
 const levers=owned.filter(c=>c.layers.includes(T.TURRET_LEVER));
 const hidden=owned.find(c=>c.layers.includes(T.WALL_LEVER_HIDDEN));
 const entry=safe(g,origin,true)?origin:neighbors(origin).find(p=>hidden?neighbors(hidden).some(n=>route(g,p,n,true)):true);
 if(!entry)throw Error('no outer entry');
 const product=trace.products.find(p=>p.kind==='item'&&p.owner==='floor');
 const reward=g.items.find((i:any)=>i.id===product?.instanceId);
 if(!reward)throw Error('missing original adopted reward');
 g.player.loc={...entry};g.player.hp=g.player.maxHp=10000;g.player.statusDurations={};g.animationEnabled=false;g.onConfirmRequest=()=>true;
 // Keep this machine's original residents and their normal AI/bolts/combat.
 g.monsters=g.monsters.filter((m:any)=>m.machineHome===machine);g.dormantMonsters=g.dormantMonsters.filter((m:any)=>m.machineHome===machine);
 g.bindDormantAwakener();g.updateVision();
 const phases:any[]=[],commands:Action[]=[];g.u19fDiagnostics={phases,commands};
 const state=(label:string)=>{const r={label,commands:commands.length,player:{...g.player.loc},hp:g.player.hp,depth:g.depth,
  inventory:g.player.inventory.items.map((i:any)=>i.id),tiles:owned.map(c=>({x:c.x,y:c.y,layers:[...c.layers]})),
  residents:[...g.monsters,...g.dormantMonsters].map((m:any)=>({id:m.id,name:m.name,loc:{...m.loc},hp:m.hp,dormant:m.isDormant}))};phases.push(r);return r;};
 const initial=JSON.parse(JSON.stringify(g.toSnapshot()));state('entry');
 const act=(action:string,data?:any)=>{commands.push({action,data});g.handlePlayerAction(action,data);if(g.isGameOver)throw Error('observer died');};
 const walk=(to:Pos)=>{
  for(let n=0;n<600&&!same(g.player.loc,to);n++){
   const path=route(g,g.player.loc,to,true);if(!path?.length)throw Error(`CE${ce}: no route to ${JSON.stringify(to)}`);
   act('move',{x:path[0]!.x-g.player.x,y:path[0]!.y-g.player.y});
  }if(!same(g.player.loc,to))throw Error('walk exhausted');
 };
 if(ce===55){
  if(!hidden)throw Error('missing hidden lever');
  const adjacent=neighbors(hidden).find(p=>route(g,g.player.loc,p,true));if(!adjacent)throw Error('hidden lever inaccessible');
  walk(adjacent);for(let n=0;n<12&&hidden.layers.includes(T.WALL_LEVER_HIDDEN);n++)act('search');state('searched');
  act('move',{x:hidden.x-g.player.x,y:hidden.y-g.player.y});state('pulled');
  for(let n=0;n<350&&!route(g,g.player.loc,reward.loc,true);n++)act('wait');state('opened');
 }else if(ce===52){
  if(!levers.length)throw Error('missing turret levers');
  for(const lever of levers){
   const adjacent=neighbors(lever).find(p=>route(g,g.player.loc,p,true));if(!adjacent)throw Error('turret lever inaccessible');
   walk(adjacent);act('move',{x:lever.x-g.player.x,y:lever.y-g.player.y});
  }state('turrets');
  const crystals=owned.filter(c=>c.layers.includes(T.ELECTRIC_CRYSTAL_OFF)||c.layers.includes(T.ELECTRIC_CRYSTAL_ON));
  for(const crystal of crystals){
   if(crystal.layers.includes(T.ELECTRIC_CRYSTAL_ON))continue;
   // Choose ordinary walkable firing lanes behind each globe. The turret aims
   // at the player; no direct cast, promotion, monster teleport or provided wand.
   const targets=owned.filter(c=>safe(g,c,true)&&route(g,g.player.loc,c,true)&&g.monsters.some((m:any)=>{
    const line=boltLine(g.grid,m.loc,c),first=line.find(p=>g.grid.getCell(p.x,p.y).layers.some((t:T)=>TERRAIN_FLAGS[t].flags&T_OBSTRUCTS_PASSABILITY));
    return first&&same(first,crystal)&&g.hasLineOfSight(m.x,m.y,c.x,c.y);
   }));
   for(const target of targets){
    walk(target);for(let n=0;n<8&&crystal.layers.includes(T.ELECTRIC_CRYSTAL_OFF);n++)act('wait');
    if(crystal.layers.includes(T.ELECTRIC_CRYSTAL_ON))break;
   }
   state(`crystal-${crystal.x}-${crystal.y}`);
   if(crystal.layers.includes(T.ELECTRIC_CRYSTAL_OFF))throw Error(`globe stayed dark at ${crystal.x},${crystal.y}; ${targets.length} firing lanes`);
  }state('charged');
 }else throw Error(`unknown CE ${ce}`);
 walk(reward.loc);act('pickup');state('reward');walk(entry);state('final');
 return {ce,machine,entry,rewardId:reward.id,initial,commands,phases};
}
