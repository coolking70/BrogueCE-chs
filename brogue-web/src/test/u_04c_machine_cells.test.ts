import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Grid, DCOLS, DROWS, TerrainType as T } from '../engine/Map/Grid';
import { collectMachineCells } from '../engine/Map/MachineCells';
import { BlueprintEngine, type BlueprintDef, type MachineResult } from '../engine/Generator/BlueprintEngine';
import { ItemSpawnHeatMap, randomMatchingLocation } from '../engine/Items/ItemSpawnHeatMap';
import { teleportCandidates } from '../engine/Movement/CreaturePlacement';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import type { Pos } from '../types';

const key = (p: Pos) => p.y * DCOLS + p.x;
// Independent oracle: deliberately does not use the production projection helper.
function numbered(grid: Grid) {
    const cells = new Set<number>();
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        if (grid.getCell(x, y)!.machineNumber !== 0) cells.add(key({ x, y }));
    }
    return cells;
}
const json = <V>(v: V): V => JSON.parse(JSON.stringify(v));
const stable = (g: Game) => { const { savedAt: _time, ...s } = g.toSnapshot(); return json(s); };
function enter(g: Game, depth: number) { const up = depth < g.depth; g.depth = depth; (g as any).generateDepth(up); }
function blank() {
    const grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) grid.setTerrain(x, y, T.GRANITE);
    return grid;
}
function carve(grid: Grid, x1: number, y1: number, x2: number, y2: number): Pos[] {
    const cells: Pos[] = [];
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) {
        grid.setTerrain(x, y, T.FLOOR); cells.push({ x, y });
    }
    return cells;
}
function build(grid: Grid, cells: Pos[], flags: string[], features: BlueprintDef['features']) {
    const bp: BlueprintDef = { id: 'u04c-probe', name: 'probe', category: 'thematic', depthRange: [1,26],
        roomSize: [cells.length,cells.length], frequency: 1, flags, features };
    return (new BlueprintEngine(grid, 5) as any).applyBlueprint(bp, { cells, center: cells[0], door: null }) as MachineResult;
}
afterEach(() => vi.restoreAllMocks());

describe('U04c CE machine membership, independent of construction interiors', () => {
    it('area NO_INTERIOR_FLAG retains its wired origin and frees every ordinary interior cell', () => {
        const grid = blank(), cells = carve(grid, 5, 5, 9, 9);
        rng.seedRandomGenerator(404);
        const result = build(grid, cells, ['BP_NO_INTERIOR_FLAG'], [{ terrain: 'GAS_TRAP_PARALYSIS',
            instanceCount: [1,1], minimumInstanceCount: 1, flags: ['MF_BUILD_AT_ORIGIN','MF_PERMIT_BLOCKING'] }]);
        expect(result).not.toBeNull(); expect(result.cells).toHaveLength(25);
        expect(grid.getCell(5,5)!.machineNumber).toBe(result.machineNumber);
        expect(grid.getCell(6,6)!.machineNumber).toBe(0);
        const before = rng.getState(), copy = json(grid);
        expect(collectMachineCells(grid)).toEqual(new Set([key({x:5,y:5})]));
        expect(json(grid)).toEqual(copy); expect(rng.getState()).toEqual(before);
    });

    it('successful external feature joins the same machine and its key matches by that cell number', () => {
        const game = createHeadlessGame(7), grid = blank(), cells = carve(grid,5,5,8,6);
        carve(grid,2,2,2,2); rng.seedRandomGenerator(404);
        const result = build(grid,cells,['BP_ROOM'], [{ itemCategory:'SCROLL', itemId:'scroll_of_identify',
            instanceCount:[1,1], minimumInstanceCount:1, flags:['MF_GENERATE_ITEM','MF_BUILD_ANYWHERE_ON_LEVEL'] }]);
        expect(result).not.toBeNull(); expect(result.itemSpawns[0]!.pos).toEqual({x:2,y:2});
        expect(result.cells).not.toContainEqual({x:2,y:2});
        expect(grid.getCell(2,2)!.machineNumber).toBe(result.machineNumber);
        expect(collectMachineCells(grid)).toEqual(new Set([...cells,{x:2,y:2}].map(key)));
        game.grid = grid;
        const item = ItemLoader.spawnKey('iron_key',-1,-1)!; item.originDepth = game.depth;
        item.keyLoc = [{loc:{x:0,y:0},machine:result.machineNumber,disposableHere:true}];
        expect((game as any).keyMatchesLocation(item,2,2,grid.getCell(2,2))).toBe(true);
        grid.getCell(2,2)!.machineNumber = 0;
        expect((game as any).keyMatchesLocation(item,2,2,grid.getCell(2,2))).toBe(false);
        grid.getCell(2,2)!.machineNumber = result.machineNumber; item.originDepth++;
        expect((game as any).keyMatchesLocation(item,2,2,grid.getCell(2,2))).toBe(false);
    });

    it('seed424242 D2: fixes the real 45-interior / 15-numbered mismatch before save and on every return', () => {
        const game = createHeadlessGame(424242); enter(game,2);
        expect(numbered(game.grid).size).toBe(15);
        expect((game as any).machineCells).toEqual(numbered(game.grid));
        const saved = json(game.toSnapshot()), before = rng.getState();
        expect(new Set(saved.machineCells)).toEqual(numbered(game.grid));
        expect(rng.getState()).toEqual(before);
        const branch = (g: Game) => { enter(g,1); expect((g as any).machineCells).toEqual(numbered(g.grid)); enter(g,2);
            expect((g as any).machineCells).toEqual(numbered(g.grid)); return stable(g); };
        const direct = branch(game), loaded = createHeadlessGame(9);
        expect(loaded.loadSnapshot(saved)).toBe(true); expect((loaded as any).machineCells).toEqual(numbered(loaded.grid));
        expect(stable(loaded)).toEqual((({savedAt:_time,...s})=>s)(saved)); expect(branch(loaded)).toEqual(direct);
    });

    it('real seed777 external features and cleared areas feed the exact grid membership into heat maps', () => {
        const buildHeat = ItemSpawnHeatMap.build, observations: {numbered:number; interior:number; external:number}[] = [];
        let interior = new Set<number>();
        const proto = Game.prototype as any, populate = proto.populateLevel;
        vi.spyOn(proto,'populateLevel').mockImplementation(function(this:any,...args:any[]) {
            interior = new Set((args[3]??[]).flatMap((m:MachineResult)=>m.cells.map(key)));
            return populate.apply(this,args);
        });
        vi.spyOn(ItemSpawnHeatMap,'build').mockImplementation((grid,up,exclusions) => {
            const expected = numbered(grid);
            expect(exclusions.machineCells).toEqual(expected);
            observations.push({numbered:expected.size,interior:interior.size,external:[...expected].filter(p=>!interior.has(p)).length});
            const hm = buildHeat(grid,up,exclusions);
            for(const p of expected) expect(hm.heatAt(p%DCOLS,Math.floor(p/DCOLS))).toBe(0);
            return hm;
        });
        const game = createHeadlessGame(777); enter(game,2); enter(game,3);
        expect(observations.some(r=>r.interior>r.numbered)).toBe(true);
        expect(observations.some(r=>r.external>0)).toBe(true);
    });

    it('heat, random item placement, entry, falling and teleport allow cleared floor and exclude numbered floor', () => {
        const g = createHeadlessGame(7), grid = blank(); carve(grid,5,5,10,10); carve(grid,20,5,25,10);
        const free={x:21,y:7},machine={x:22,y:7};grid.getCell(machine.x,machine.y)!.machineNumber=77;
        g.grid=grid;g.monsters=[];g.dormantMonsters=[];g.items=[];g.player.loc={x:7,y:7};
        (g as any).machineCells=collectMachineCells(grid);
        const hm=ItemSpawnHeatMap.build(grid,{x:20,y:5},{machineCells:(g as any).machineCells});
        expect(hm.heatAt(free.x,free.y)).toBeGreaterThan(0);expect(hm.heatAt(machine.x,machine.y)).toBe(0);
        const cells=teleportCandidates(g,g.player);
        expect(cells).toContainEqual(free);expect(cells).not.toContainEqual(machine);
        expect((g as any).entryQualifiesForPlacement(free.x,free.y)).toBe(true);
        expect((g as any).entryQualifiesForPlacement(machine.x,machine.y)).toBe(false);
        const roll=vi.spyOn(rng,'randRange').mockReturnValueOnce(machine.x).mockReturnValueOnce(machine.y)
            .mockReturnValueOnce(free.x).mockReturnValueOnce(free.y);
        expect(randomMatchingLocation(grid,{dungeonType:T.FLOOR,liquidType:T.NOTHING,isOccupied:()=>false,
            isMachineCell:(x,y)=>(g as any).machineCells.has(key({x,y}))})).toEqual(free);
        expect(roll).toHaveBeenCalledTimes(4);roll.mockRestore();
        // Falling searches rings starting at radius one: leave exactly one ordinary destination.
        for(let x=20;x<=25;x++)for(let y=5;y<=10;y++) {
            if(x!==free.x || y!==free.y)grid.getCell(x,y)!.machineNumber=77;
        }
        (g as any).machineCells=collectMachineCells(grid);
        (g as any).placePlayerOnFallLanding(machine.x,machine.y);expect(g.player.loc).toEqual(free);
    });

    it.each(['active','cached'] as const)('rejects mismatched, absent or duplicate %s snapshot membership without altering state or RNG', which => {
        const g=createHeadlessGame(424242);enter(g,2);const saved=json(g.toSnapshot()),before=stable(g),rngBefore=rng.getState();
        for(const kind of ['extra','missing','duplicate','absent']) {
            const bad=json(saved), row=which==='active'?bad:bad.levels[0]!;
            if(kind==='extra')row.machineCells.push(-1);
            else if(kind==='absent')delete (row as any).machineCells;
            else if(kind==='duplicate')row.machineCells.push(row.machineCells[0]!);
            else row.machineCells.pop();
            expect(g.loadSnapshot(bad),`${which}/${kind}`).toBe(false);
            expect(stable(g)).toEqual(before);expect(rng.getState()).toEqual(rngBefore);
        }
    });
});
