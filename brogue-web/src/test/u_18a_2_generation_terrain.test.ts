import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DungeonLayer as L, DCOLS, DROWS } from '../engine/Map/Grid';
import { ItemSpawnHeatMap } from '../engine/Items/ItemSpawnHeatMap';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { DijkstraMap, MAX_DISTANCE } from '../engine/Map/Pathfinding';

// Counterfactual failures must not leak an observation spy into the next guard.
afterEach(()=>vi.restoreAllMocks());

function arena(width=9,height=9): any {
    const g:any=new Game();g.grid=new Grid(width,height);g.monsters=[];g.items=[];g.machineCells=new Set();
    for(let x=0;x<width;x++)for(let y=0;y<height;y++)g.grid.setTerrain(x,y,T.GRANITE);
    return g;
}
function tile(g:any,x:number,y:number,d=T.FLOOR,l=T.NOTHING,s=T.NOTHING) {
    g.grid.setTerrainLayer(x,y,L.DUNGEON,d);
    g.grid.setTerrainLayer(x,y,L.LIQUID,l);
    g.grid.setTerrainLayer(x,y,L.SURFACE,s);
}
describe('U18a-2 step 1: entry PB and occupancy',()=>{
    it.each([
        [T.FLOOR,T.NOTHING,T.NOTHING,true], [T.DOOR,T.NOTHING,T.NOTHING,true],
        [T.FLOOR,T.WATER_SHALLOW,T.WEB,true], [T.FLOOR,T.WATER_DEEP,T.WEB,false],
        [T.FLOOR,T.WATER_DEEP,T.PLAIN_FIRE,false], [T.WALL_LEVER_HIDDEN,T.NOTHING,T.NOTHING,false],
        [T.PRESSURE_PLATE,T.NOTHING,T.WEB,false], [T.FLOOR,T.INERT_BRIMSTONE,T.NOTHING,false],
        [T.FLOOR,T.NOTHING,T.FORCEFIELD,false], [T.FLOOR,T.NOTHING,T.PLAIN_FIRE,false],
        [T.STAIRS_UP,T.NOTHING,T.WEB,false], [T.SECRET_DOOR,T.NOTHING,T.NOTHING,false],
    ] as const)('literal layers %s/%s/%s => %s',(d,l,s,expected)=>{
        const g=arena();tile(g,4,4,d,l,s);
        expect(g.entryQualifiesForPlacement(4,4)).toBe(expected);
        const c=g.grid.getCell(4,4);c.isPassable=!c.isPassable;
        expect(g.entryQualifiesForPlacement(4,4)).toBe(expected);
    });
    it('retains monster/machine exclusions and north-first zero-draw entry',()=>{
        const g=arena();tile(g,4,4,T.STAIRS_UP);tile(g,4,3);tile(g,4,5);tile(g,3,4);
        const state=rng.getState();g.placePlayerOnLevelEntry({x:4,y:4});expect(g.player.loc).toEqual({x:4,y:3});expect(rng.getState()).toEqual(state);
        g.machineCells.add(3*DCOLS+4);g.monsters=[{loc:{x:4,y:5},hp:1}];
        g.placePlayerOnLevelEntry({x:4,y:4});expect(g.player.loc).toEqual({x:3,y:4});
    });
});

describe('U18a-2 step 4b: amulet floor-deck bypass',()=>{
    it('filters only amulet candidates; leaves dangerous terrain in horde deck and produces one amulet',()=>{
        const g=arena(DCOLS,DROWS);g.depth=26;g.levelSeeds[25].upStairsLoc={x:1,y:1};
        tile(g,15,10,T.FLOOR,T.INERT_BRIMSTONE);tile(g,16,10);tile(g,20,10);
        const shuffle=vi.spyOn(rng,'shuffleList').mockImplementation(()=>{});
        const draw=vi.spyOn(rng,'randRange').mockImplementationOnce(a=>a);
        const heat=vi.spyOn(ItemSpawnHeatMap,'build').mockReturnValue({getItemSpawnLoc:()=>null,coolHeatMapAt:()=>{}} as unknown as ItemSpawnHeatMap);
        const item=vi.spyOn(g,'spawnPopulateItem').mockReturnValue(null);
        const horde=vi.spyOn(g,'spawnHordeAt').mockImplementation(()=>0);
        const amulet=vi.spyOn(ItemLoader,'spawnAmulet');
        try{
            g.populateLevel(26,false,false,[]);
            expect(amulet).toHaveBeenCalledExactlyOnceWith('amulet_of_yendor',16,10);
            expect(g.items.filter((i:any)=>i.identityId==='amulet_of_yendor')).toHaveLength(1);
            expect(g.grid.getCell(15,10).layers[L.LIQUID]).toBe(T.INERT_BRIMSTONE);
        }finally{amulet.mockRestore();horde.mockRestore();item.mockRestore();heat.mockRestore();draw.mockRestore();shuffle.mockRestore();}
    });
});

describe('U18a-2 step 4c: key floor-deck bypass',()=>{
    it('takes the last legal item tile, retaining one bound key and no extra RNG selection',()=>{
        const g=arena(DCOLS,DROWS);g.depth=2;g.levelSeeds[1].upStairsLoc={x:1,y:1};
        tile(g,15,10);tile(g,16,10,T.FLOOR,T.INERT_BRIMSTONE);tile(g,19,10);tile(g,20,10);
        const shuffle=vi.spyOn(rng,'shuffleList').mockImplementation(()=>{});
        const heat=vi.spyOn(ItemSpawnHeatMap,'build').mockReturnValue({getItemSpawnLoc:()=>null,coolHeatMapAt:()=>{}} as unknown as ItemSpawnHeatMap);
        const item=vi.spyOn(g,'spawnPopulateItem').mockReturnValue(null),horde=vi.spyOn(g,'spawnHordeAt').mockReturnValue(0);
        const beforeSelection=rng.getState(),spawnKey=ItemLoader.spawnKey;
        let selectedAt:unknown;
        const key=vi.spyOn(ItemLoader,'spawnKey').mockImplementation((...args)=>{selectedAt=rng.getState();return spawnKey.apply(ItemLoader,args);});
        try{
            g.populateLevel(2,false,false,[{needsKey:true,generatedKey:false,door:{x:25,y:10},machineNumber:7,itemSpawns:[],monsterSpawns:[],cells:[]}]);
            expect(key).toHaveBeenCalledExactlyOnceWith('iron_key',15,10);
            expect(selectedAt).toEqual(beforeSelection);
            expect(g.items).toHaveLength(1);expect(g.items[0].keyLoc).toEqual([{loc:{x:25,y:10},machine:7,disposableHere:true}]);
            expect(g.grid.getCell(16,10).layers[L.LIQUID]).toBe(T.INERT_BRIMSTONE);
        }finally{key.mockRestore();horde.mockRestore();item.mockRestore();heat.mockRestore();shuffle.mockRestore();}
    });
});

describe('U18a-2 step 4a: heat uses discovery successors',()=>{
    it.each([[T.SECRET_DOOR,3005],[T.WALL_LEVER_HIDDEN,0]] as const)('secret %s has literal far-room heat %s',(secret,expected)=>{
        const g=arena(DCOLS,DROWS);
        for(const [left,right] of [[2,4],[6,8]])for(let x=left!;x<=right!;x++)for(let y=3;y<=5;y++)tile(g,x,y);
        tile(g,5,4,secret);const before=rng.getState();
        const hm=ItemSpawnHeatMap.build(g.grid,{x:2,y:4},{machineCells:new Set([3*DCOLS+2])});
        expect(hm.heatAt(8,3)).toBe(expected);expect(hm.heatAt(2,3)).toBe(0);
        expect(g.grid.getCell(5,4).layers[L.DUNGEON]).toBe(secret);expect(rng.getState()).toEqual(before);
    });
    it('stacked PB/ITEMS and machine cells have zero heat without changing draw rules',()=>{
        const g=arena(DCOLS,DROWS);for(let x=2;x<=8;x++)for(let y=2;y<=8;y++)tile(g,x,y);
        tile(g,3,3,T.PRESSURE_PLATE,T.NOTHING,T.WEB);tile(g,4,4,T.FLOOR,T.WATER_DEEP,T.PLAIN_FIRE);
        tile(g,5,5,T.FLOOR,T.INERT_BRIMSTONE);tile(g,6,6,T.FLOOR,T.NOTHING,T.FORCEFIELD);
        const hm=ItemSpawnHeatMap.build(g.grid,{x:2,y:2},{machineCells:new Set([7*DCOLS+7])});
        for(const [x,y] of [[3,3],[4,4],[5,5],[6,6],[7,7]])expect(hm.heatAt(x!,y!)).toBe(0);
        const before=rng.randomNumbersGenerated;expect(hm.getItemSpawnLoc()).not.toBeNull();expect(rng.randomNumbersGenerated-before).toBe(1);
    });
});

describe('U18a-2 step 3: negative and legacy positive costs',()=>{
    const matrix=(value:number)=>Array.from({length:5},()=>Array(5).fill(value));
    it.each([-2,30000])('O=%s blocks either common neighbor, symmetrically',(obstruction)=>{
        for(const side of [[2,1],[1,2]]){
            const cost=matrix(-1),dist=matrix(MAX_DISTANCE);cost[1]![1]=cost[2]![2]=1;cost[side[0]!]![side[1]!]=obstruction;dist[1]![1]=0;
            new DijkstraMap(5,5).batchScan(dist,cost,true);expect(dist[2]![2]).toBe(30000);
        }
    });
    it.each([-1,29999])('F=%s forbids entry but allows a diagonal past it',(forbidden)=>{
        const cost=matrix(forbidden),dist=matrix(MAX_DISTANCE);cost[1]![1]=cost[2]![2]=1;dist[1]![1]=0;
        new DijkstraMap(5,5).batchScan(dist,cost,true);expect(dist[2]![2]).toBe(1);expect(dist[1]![2]).toBe(30000);
    });
    it.each([-2,-1,29999,30000])('blocked seed %s does not propagate',(blocked)=>{
        const cost=matrix(1),dist=matrix(MAX_DISTANCE);cost[2]![2]=blocked;dist[2]![2]=-10;
        new DijkstraMap(5,5).batchScan(dist,cost,true);expect(dist[2]![2]).toBe(-10);expect(dist[1]![2]).toBe(30000);
    });
    it('weighted four-way multi-source negatives, boundary override and zero transit retain CE values',()=>{
        const cost=matrix(1),dist=matrix(MAX_DISTANCE);dist[1]![1]=-5;dist[3]![3]=0;dist[0]![2]=-100;cost[2]![1]=0;cost[2]![2]=5;
        new DijkstraMap(5,5).batchScan(dist,cost,false);
        expect([dist[1]!.slice(1,4),dist[2]!.slice(1,4),dist[3]!.slice(1,4)]).toEqual([[-5,-4,-3],[-5,0,-2],[-4,-3,-2]]);
        expect(dist[0]![2]).toBe(-100);
    });
});

describe('U18a-2 step 2: entry path and CE fallbacks',()=>{
    it('first-cell success returns before scan or RNG even at the boundary',()=>{
        const g=arena();tile(g,0,4);const spy=vi.spyOn(DijkstraMap.prototype,'batchScan');const before=rng.getState();
        expect(g.findQualifyingPathLocNear({x:0,y:4})).toEqual({x:0,y:4});
        expect(spy).not.toHaveBeenCalled();expect(rng.getState()).toEqual(before);spy.mockRestore();
    });
    it('DL allows fire and brimstone in the route, PB rejects both destinations; source is forced to 1',()=>{
        const g=arena();tile(g,1,4,T.STAIRS_UP);tile(g,2,4,T.FLOOR,T.NOTHING,T.PLAIN_FIRE);
        tile(g,3,4,T.FLOOR,T.INERT_BRIMSTONE);tile(g,4,4);
        const original=DijkstraMap.prototype.batchScan;let costs:number[][]=[],dist:number[][]=[];
        const spy=vi.spyOn(DijkstraMap.prototype,'batchScan').mockImplementation(function(this:DijkstraMap,d,c,diag,max){
            costs=c.map(r=>[...r]);original.call(this,d,c,diag,max);dist=d.map(r=>[...r]);
        });
        expect(g.findQualifyingPathLocNear({x:1,y:4})).toEqual({x:4,y:4});
        expect([costs[1]![4],costs[2]![4],costs[3]![4],costs[0]![4]]).toEqual([1,1,1,-2]);
        expect([dist[1]![4],dist[2]![4],dist[3]![4],dist[4]![4]]).toEqual([1,2,3,4]);spy.mockRestore();
    });
    it('four-layer DL, D/obstruction and forbidden are distinct',()=>{
        const g=arena();tile(g,4,4,T.STAIRS_UP);tile(g,4,3,T.PRESSURE_PLATE,T.NOTHING,T.WEB);
        tile(g,4,5,T.FLOOR,T.WATER_DEEP,T.PLAIN_FIRE);tile(g,3,4,T.FLOOR,T.NOTHING,T.FORCEFIELD);
        tile(g,5,4);let cost:number[][]=[];const original=DijkstraMap.prototype.batchScan;
        const spy=vi.spyOn(DijkstraMap.prototype,'batchScan').mockImplementation(function(this:DijkstraMap,d,c,diag,max){cost=c.map(r=>[...r]);original.call(this,d,c,diag,max);});
        expect(g.findQualifyingPathLocNear({x:4,y:4})).toEqual({x:5,y:4});
        expect([cost[4]![3],cost[4]![5],cost[3]![4]]).toEqual([-1,-1,-2]);spy.mockRestore();
    });
    it('nearest ties enumerate x then y and consume exactly one nondegenerate draw',()=>{
        const g=arena();tile(g,4,4,T.STAIRS_UP);tile(g,3,4);tile(g,5,4);
        const spy=vi.spyOn(rng,'randRange').mockReturnValue(1);
        expect(g.findQualifyingPathLocNear({x:4,y:4})).toEqual({x:5,y:4});expect(spy.mock.calls).toEqual([[0,1]]);spy.mockRestore();
    });
    it('pathless final fallback includes boundary, uses one-based CE tie draw and does not invent reachability',()=>{
        const g=arena();tile(g,2,4,T.STAIRS_UP);tile(g,0,3);tile(g,0,5);
        const spy=vi.spyOn(rng,'randRange').mockReturnValue(2);
        expect(g.findQualifyingPathLocNear({x:2,y:4})).toEqual({x:0,y:5});expect(spy.mock.calls).toEqual([[1,2]]);spy.mockRestore();
        tile(g,0,3,T.GRANITE);tile(g,0,5,T.GRANITE);expect(g.findQualifyingPathLocNear({x:2,y:4})).toBeNull();
    });
});
