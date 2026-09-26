import {expect,it,afterEach} from 'vitest';
import {createHeadlessGame} from './harness';
import {runAutoActions} from './fixtures/u19f-auto-actions';
import {TerrainType as T,DungeonLayer as L} from '../engine/Map/Grid';
import {Item,ItemCategory} from '../engine/Items/Item';
import {getBoltForItem} from '../engine/Combat/Bolt';
import {setMachineObservationHook,type MachineTrace} from '../engine/Generator/MachineObservation';
import {safe} from './fixtures/u19d-machine-actions';
const fire=(g:any,to:{x:number;y:number})=>{
 const staff=new Item('fire','/',0xffffff,ItemCategory.STAFF);
 Object.assign(staff,{identityId:'staff_of_fire',enchantment:2,charges:20,maxCharges:20,arcanaInstanceVersion:1});
 g.player.inventory.addItem(staff);return g.zapBoltFromPlayer(getBoltForItem('staff_of_fire')!,staff,to);
};
afterEach(()=>setMachineObservationHook(null));
it('U19f autoGen fungal regrowth burns through the normal player fire bolt',()=>{
 const r=runAutoActions(9),g=r.game;expect(g.grid.getCell(r.target.x,r.target.y).layers).toContain(T.FUNGUS_FOREST);
 fire(g,r.target);expect(g.grid.getCell(r.target.x,r.target.y).layers[L.SURFACE]).toBe(T.PLAIN_FIRE);
});
it('U19f autoGen methane dewar releases combustible gas; player fire produces an explosion',()=>{
 const r=runAutoActions(37),g=r.game,c=g.grid.getCell(r.target.x,r.target.y);
 expect(c.layers[L.GAS]).toBe(T.METHANE_GAS);fire(g,r.target);
 for(let n=0;n<12&&!g.grid.cells.flat().some((c:any)=>c.layers.includes(T.GAS_EXPLOSION));n++)g.handlePlayerAction('wait');
 expect(g.grid.cells.flat().some((c:any)=>c.layers.includes(T.GAS_EXPLOSION))).toBe(true);
});
it('U19f existing bridge autoGen remains natural: entering the stone span, returning and resisting player fire',()=>{
 let traces:MachineTrace[]=[];setMachineObservationHook(()=>{});
 const g:any=createHeadlessGame(4),populate=g.populateLevel.bind(g);
 g.populateLevel=(...args:any[])=>{const r=populate(...args);traces=args[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
 for(let d=2;d<=8;d++){g.depth=d;g.generateDepth(false,false);}
 const trace=traces.find(t=>t.ceBlueprintId===65&&t.machineNumber===3);expect(trace).toBeDefined();
 const positions=trace!.features[1]!.placements;const bridges=positions.map(p=>g.grid.getCell(p.x,p.y)).filter((c:any)=>c.layers.includes(T.STONE_BRIDGE));expect(bridges.length).toBeGreaterThan(1);
 const dirs=[[-1,0],[1,0],[0,-1],[0,1]],ends=bridges.flatMap((c:any)=>dirs.map(([x,y])=>({x:c.x+x!,y:c.y+y!}))).filter((p:any)=>safe(g,p)&&!g.grid.getCell(p.x,p.y).layers.includes(T.STONE_BRIDGE));
 const start=ends[0]!,target=bridges.find((c:any)=>Math.abs(c.x-start.x)+Math.abs(c.y-start.y)===1);expect(target).toBeDefined();
 g.monsters=[];g.dormantMonsters=[];g.player.loc={...start};g.player.hp=g.player.maxHp=10000;g.animationEnabled=false;g.onConfirmRequest=()=>true;
 g.handlePlayerAction('move',{x:target.x-start.x,y:target.y-start.y});expect(g.player.loc).toEqual({x:target.x,y:target.y});
 g.handlePlayerAction('move',{x:start.x-target.x,y:start.y-target.y});expect(g.player.loc).toEqual(start);expect(g.depth).toBe(8);
 fire(g,target);expect(target.layers[L.LIQUID]).toBe(T.STONE_BRIDGE);
 for(let n=0;n<5;n++)g.handlePlayerAction('wait');
 expect(bridges.every((c:any)=>c.layers.includes(T.STONE_BRIDGE))).toBe(true);
},120000);
