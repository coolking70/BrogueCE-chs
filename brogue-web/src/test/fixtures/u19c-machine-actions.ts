import {preparePendingScene,pendingSceneState} from './u19b-machine-scenes';
import {TerrainType as T} from '../../engine/Map/Grid';
import {ItemLoader} from '../../engine/Items/ItemLoader';
import type {Game} from '../../engine/Core/Game';
export function prepareImmediateAction(game:Game,ce:number,seed:number,size:number){
 const g:any=game,scene=preparePendingScene(game,ce,seed,size,true);
 let action='search',direction:{x:number;y:number}|undefined,targetId:number|undefined,scrollId:number|undefined;
 if(scene.itemId!==undefined&&scene.observer.x===scene.target.x&&scene.observer.y===scene.target.y)action='pickup';
 else {
  const dormant=g.dormantMonsters.find((m:any)=>m.machineHome>0&&Math.max(Math.abs(m.x-g.player.x),Math.abs(m.y-g.player.y))<=8);
  if(dormant&&ce===11){
   outer:for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++)if(g.grid.getCell(x,y).layers.includes(T.MACHINE_TRIGGER_FLOOR)){
    for(const d of [{x:0,y:1},{x:1,y:0},{x:0,y:-1},{x:-1,y:0}]){
     const pos={x:x-d.x,y:y-d.y};if(g.grid.getCell(pos.x,pos.y)?.isPassable&&!g.getMonsterAt(pos.x,pos.y)&&!g.grid.getCell(pos.x,pos.y).layers.includes(T.MACHINE_TRIGGER_FLOOR)){g.player.loc=pos;action='move';direction=d;targetId=dormant.id;break outer;}
    }
   }
  }
  else if(dormant){const scroll=ItemLoader.spawnScroll('scroll_of_shattering',0,0)!;scroll.identified=true;g.player.inventory.addItem(scroll);action='read';scrollId=scroll.id;targetId=dormant.id;}
  else {
   const target=g.monsters.find((m:any)=>m.machineHome>0&&!m.isAlly&&!m.isCaged);
   if(target){
    for(const d of [{x:0,y:1},{x:1,y:0},{x:0,y:-1},{x:-1,y:0}]){
     const pos={x:target.x-d.x,y:target.y-d.y};
     if(g.grid.getCell(pos.x,pos.y)?.isPassable&&!g.getMonsterAt(pos.x,pos.y)){
      g.player.loc=pos;g.player.accuracy=10000;if(!target.isInvulnerable()&&!target.hasBehavior('MONST_IMMUNE_TO_WEAPONS'))target.hp=1;targetId=target.id;direction=d;action='move';break;
     }
    }
   }
  }
 }
 g.updateVision();g.update();g.needsRender=true;g.onRenderRequested?.();
 const state=()=>({scene:pendingSceneState(game,scene),target:targetId===undefined?null:[...g.monsters,...g.dormantMonsters].filter((m:any)=>m.id===targetId).map((m:any)=>({id:m.id,hp:m.hp,dormant:m.isDormant,loc:{...m.loc},carried:m.carriedItem?.id??null})),items:g.items.map((i:any)=>({id:i.id,loc:{...i.loc}})),inventory:g.player.inventory.items.map((i:any)=>i.id),inputs:g.recordedInputEvents.length});
 return {scene,action,direction,targetId,scrollId,before:state()};
}
export function performImmediateAction(game:Game,prepared:ReturnType<typeof prepareImmediateAction>){
 const g:any=game;
 if(prepared.action==='read'){
  const scroll=g.player.inventory.items.find((i:any)=>i.id===prepared.scrollId);g.executeItemCommand('read',scroll,undefined,()=>g.readItem(scroll));
 }else g.handlePlayerAction(prepared.action,prepared.direction,'system');
 return immediateActionState(game,prepared);
}
export function immediateActionState(game:Game,p:ReturnType<typeof prepareImmediateAction>){
 const g:any=game;g.updateVision();g.update();g.onRenderRequested?.();
 return {scene:pendingSceneState(game,p.scene),target:p.targetId===undefined?null:[...g.monsters,...g.dormantMonsters].filter((m:any)=>m.id===p.targetId).map((m:any)=>({id:m.id,hp:m.hp,dormant:m.isDormant,loc:{...m.loc},carried:m.carriedItem?.id??null})),items:g.items.map((i:any)=>({id:i.id,loc:{...i.loc}})),inventory:g.player.inventory.items.map((i:any)=>i.id),inputs:g.recordedInputEvents.length};
}
