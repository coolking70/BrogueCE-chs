import { afterEach, describe, expect, it, vi } from 'vitest';
import data from '../data/blueprints.json';
import { BlueprintEngine, type BlueprintDef, type MachineResult } from '../engine/Generator/BlueprintEngine';
import { Grid, TerrainType as T, DungeonLayer as L, DCOLS, DROWS } from '../engine/Map/Grid';
import * as auto from '../engine/Map/AutoGenerator';
import { rng } from '../engine/Random';
import type { Pos } from '../types';

const AREA_IDS = [8,15,28,33,34,39,43,50,56,58,60,61,62,63,64,65,66,67,68,69,70,71];
const key = (p: Pos) => p.y * DCOLS + p.x;
const at = { x: 10, y: 10 };
const bp = (over: Partial<BlueprintDef> = {}): BlueprintDef => ({
    id: 'area-probe', ceBlueprintId: 999, name: 'area-probe', depthRange: [1,26],
    roomSize: [2,2], frequency: 1, category: 'thematic', flags: [], features: [], ...over,
});
interface Internals {
    fillAreaInterior(b: BlueprintDef, p: Pos): Pos[] | null;
    fillVestibuleInterior(b: BlueprintDef, p: Pos): Pos[] | null;
    findGateRoom(b: BlueprintDef, analysis: unknown): { kind: 'noCandidates' } | { kind: 'room'; cells: Pos[]; center: Pos; door: Pos };
    interiorSatisfiesBlockingFlags(b: BlueprintDef, cells: readonly Pos[]): boolean;
    pendingItems: Set<number>;
    pendingMonsters: Set<number>;
    applyBlueprint(b: BlueprintDef, room: { cells: Pos[]; center: Pos; door: Pos | null }): MachineResult | null;
}
const internal = (engine: BlueprintEngine) => engine as unknown as Internals;
function grid(open = false): Grid {
    const g = new Grid(DCOLS, DROWS);
    for (let x=0; x<DCOLS; x++) for (let y=0; y<DROWS; y++) {
        g.setTerrain(x,y,open && x>0 && y>0 && x<DCOLS-1 && y<DROWS-1 ? T.FLOOR : T.GRANITE);
    }
    return g;
}
function floor(g: Grid, ...ps: Pos[]) { for (const p of ps) g.setTerrain(p.x,p.y,T.FLOOR); }
function engine(g: Grid, b = bp()) { return new BlueprintEngine(g, 10, [b]); }
afterEach(() => vi.restoreAllMocks());

describe('V-2b-9e routing and CE retry semantics', () => {
    // Adversary: a missing/extra area row or accidentally putting forced-only 65/66 in the lottery.
    it('audits exactly the 22 area rows including CE 8, retaining 65/66 frequency zero', () => {
        expect((data as BlueprintDef[]).filter(b => !b.flags.includes('BP_ROOM')
            && !b.flags.includes('BP_VESTIBULE')).map(b => b.ceBlueprintId).sort((a,b)=>a!-b!)).toEqual(AREA_IDS);
        for (const ce of [65,66]) expect(data.find(b=>b.ceBlueprintId===ce)!.frequency).toBe(0);
    });
    // Adversary: the old all-non-vestibules -> findGateRoom route. Each actual
    // catalog row must reach area selection, with the real flags left intact.
    it.each(AREA_IDS)('CE %i reaches area selection and never gate/vestibule selection', ce => {
        const b = (data as BlueprintDef[]).find(b=>b.ceBlueprintId===ce)!;
        const e=engine(grid(true),b), i=internal(e);
        const area=vi.spyOn(i,'fillAreaInterior').mockReturnValue(null);
        const gate=vi.spyOn(i,'findGateRoom').mockReturnValue({kind:'noCandidates'});
        const vestibule=vi.spyOn(i,'fillVestibuleInterior').mockReturnValue(null);
        expect(e.buildAMachine(ce,[],null,at)).toBeNull();
        expect(area).toHaveBeenCalledExactlyOnceWith(b,at);
        expect(gate).not.toHaveBeenCalled(); expect(vestibule).not.toHaveBeenCalled();
    });
    // Adversary: a disguised gate dependency, or treating origin as an area door.
    it('builds on a gate-free open map and keeps the sampled origin with no door', () => {
        const b=bp({roomSize:[5,5]}), e=engine(grid(true),b);
        vi.spyOn(auto,'randomMatchingLocation').mockReturnValue(at);
        rng.seedRandomGenerator(9101);
        const result=e.buildAMachine(999,[],null,null);
        expect(result).not.toBeNull(); expect(result!.center).toEqual(at);
        expect(result!.door).toBeNull();
        expect(new Set(result!.cells.map(key))).toEqual(new Set([at,{x:9,y:10},{x:11,y:10},{x:10,y:9},{x:10,y:11}].map(key)));
    });
    // Adversary: tryAgain becomes return null, occupied cells are silently
    // skipped, or failed interior leaks into the next attempt.
    it.each(['item','monster','machine'] as const)('retries a real %s collision and builds at the next location', kind => {
        const g=grid(), bad={x:11,y:10}, good={x:30,y:10};
        floor(g,at,bad,good,{x:31,y:10});
        const b=bp(), e=engine(g,b), i=internal(e);
        if(kind==='machine') g.getCell(bad.x,bad.y)!.machineNumber=77;
        else (kind==='item'?i.pendingItems:i.pendingMonsters).add(key(bad));
        const pick=vi.spyOn(auto,'randomMatchingLocation').mockReturnValueOnce(at).mockReturnValue(good);
        const attempts=vi.spyOn(i,'fillAreaInterior');
        const rolls=vi.spyOn(rng,'randRange');
        rng.seedRandomGenerator(9102);
        const result=e.buildAMachine(-1,[],null,null);
        expect(result).not.toBeNull(); expect(result!.center).toEqual(good);
        expect(new Set(result!.cells.map(key))).toEqual(new Set([good,{x:31,y:10}].map(key)));
        expect(pick).toHaveBeenCalledTimes(2); expect(attempts.mock.results[0]!.value).toBeNull();
        expect(rolls.mock.calls.filter(([lo,hi])=>lo===1 && hi===1)).toHaveLength(1); // same BP, not an outer retry
    });
    // Adversary: always retry ten locations, fail early, or retry fixed input.
    it.each([
        {requested:-1, origin:null, attempts:90, picks:90},
        {requested:999, origin:null, attempts:9, picks:9},
        {requested:999, origin:at, attempts:1, picks:0},
        {requested:-1, origin:at, attempts:90, picks:0},
    ])('bounds retries for requested=$requested origin=$origin', ({requested,origin,attempts,picks}) => {
        const e=engine(grid(true)), i=internal(e);
        const grow=vi.spyOn(i,'fillAreaInterior').mockReturnValue(null);
        const pick=vi.spyOn(auto,'randomMatchingLocation').mockReturnValue(at);
        expect(e.buildAMachine(requested,[],null,origin)).toBeNull();
        expect(grow).toHaveBeenCalledTimes(attempts); expect(pick).toHaveBeenCalledTimes(picks);
    });
    // Adversary: graft :1196 onto BP_ROOM again (the 9b Kennel regression).
    it('keeps blocking qualification exclusively in the interior growth branches', () => {
        const b=bp({flags:['BP_ROOM','BP_REQUIRE_BLOCKING']}), e=engine(grid(true),b), i=internal(e);
        vi.spyOn(i,'findGateRoom').mockReturnValue({kind:'room',cells:[at,{x:11,y:10}],center:{x:11,y:10},door:at});
        const validate=vi.spyOn(i,'interiorSatisfiesBlockingFlags');
        const area=vi.spyOn(i,'fillAreaInterior');
        expect(e.buildAMachine(999,[],null,null)).not.toBeNull();
        expect(area).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
    });
});

describe('V-2b-9e distance shells, occupancy and blocking', () => {
    // Adversary: 8-way scan, only top terrain checked, or reuse vestibule costs.
    it('uses four-way T_PATHING_BLOCKER costs across layers, admits secret doors, and accepts undersized components', () => {
        const g=grid();
        const cells=[at,{x:11,y:10},{x:12,y:10},{x:13,y:10},{x:14,y:10}];
        floor(g,...cells,{x:9,y:9});
        g.setTerrain(11,10,T.SECRET_DOOR);
        g.setTerrainLayer(13,10,L.SURFACE,T.PLAIN_FIRE);
        const e=engine(g);
        rng.seedRandomGenerator(9103);
        expect(internal(e).fillAreaInterior(bp({roomSize:[20,20]}),at)).toEqual(cells.slice(0,3));
    });
    // Adversary: batchScan drops a blocked source or admits a boundary source,
    // unlike CE pdsSetDistance when randomMatchingLocation's false is ignored.
    it('seeds an interior blocked origin but never a boundary origin', () => {
        const g=grid();floor(g,{x:11,y:10},{x:12,y:10});
        const i=internal(engine(g));
        expect(i.fillAreaInterior(bp({roomSize:[3,3]}),at)).toEqual([at,{x:11,y:10},{x:12,y:10}]);
        expect(i.fillAreaInterior(bp({roomSize:[1,1]}),{x:0,y:10})).toEqual([]);
    });
    // Adversary: dropping sCols/sRows shuffles or consuming the size roll after
    // shuffling; compare the literal CE scan order, independent of production.
    it('selects a partial shell in shuffled column/row order after rolling its size', () => {
        rng.seedRandomGenerator(9104);
        const goal=rng.randRange(7,9), xs=Array.from({length:DCOLS},(_,x)=>x), ys=Array.from({length:DROWS},(_,y)=>y);
        rng.shuffleList(xs);rng.shuffleList(ys);
        const expected: Pos[]=[];
        for(let k=0;expected.length<goal;k++) for(const x of xs) for(const y of ys) {
            if(expected.length<goal && Math.abs(x-at.x)+Math.abs(y-at.y)===k)expected.push({x,y});
        }
        rng.seedRandomGenerator(9104);
        expect(internal(engine(grid(true))).fillAreaInterior(bp({roomSize:[7,9]}),at)).toEqual(expected);
    });
    // Adversary: occupancy exists only in a test seam, fails to survive
    // BP_NO_INTERIOR_FLAG, or HAS_DORMANT_MONSTER is mistaken for HAS_MONSTER.
    it.each(['item','monster','dormant'] as const)('records real %s instructions even when interior flags are removed', kind => {
        const g=grid(true), b=bp({flags:['BP_NO_INTERIOR_FLAG'],features:[{
            instanceCount:[1,1],minimumInstanceCount:1,personalSpace:1,
            flags:['MF_BUILD_AT_ORIGIN', ...(kind==='item'?['MF_GENERATE_ITEM']:[]),...(kind==='dormant'?['MF_MONSTERS_DORMANT']:[])],
            ...(kind==='item'?{itemCategory:'GOLD'}:{monsterId:'rat'}),
        }]}), e=engine(g,b), i=internal(e);
        rng.seedRandomGenerator(9105);
        const built=e.buildAMachine(999,[],null,at);
        expect(built).not.toBeNull(); expect(g.getCell(at.x,at.y)!.machineNumber).toBe(0);
        expect(built![kind==='item'?'itemSpawns':'monsterSpawns']).toHaveLength(1);
        const interior=i.fillAreaInterior(bp({roomSize:[1,1]}),at);
        if(kind==='dormant')expect(interior).toEqual([at]); else expect(interior).toBeNull();
    });
    // Adversary: carried adopted items incorrectly leave HAS_ITEM on the floor.
    it('does not reserve the floor for an adopted item carried by a dormant monster', () => {
        const b=bp({flags:['BP_ADOPT_ITEM','BP_NO_INTERIOR_FLAG'],features:[{
            instanceCount:[1,1],minimumInstanceCount:1,monsterId:'rat',
            flags:['MF_BUILD_AT_ORIGIN','MF_ADOPT_ITEM','MF_MONSTER_TAKE_ITEM','MF_MONSTERS_DORMANT'],
        }]}), e=engine(grid(true),b);
        const result=e.buildAMachine(999,[],{category:'KEY',pos:at},at);
        expect(result).not.toBeNull();expect(result!.monsterSpawns[0]!.carriedItem?.category).toBe('KEY');
        expect(internal(e).fillAreaInterior(bp({roomSize:[1,1]}),at)).toEqual([at]);
    });
    // Adversary: failed child/parent leaves ghost occupied coordinates; existing
    // committed occupation must survive restoration at the same time.
    it('rolls pending occupation back with failed features, retaining committed occupation', () => {
        const b=bp(), e=engine(grid(true),b), i=internal(e), old=key({x:2,y:2});
        i.pendingItems.add(old); i.pendingMonsters.add(old);
        vi.spyOn(i,'applyBlueprint').mockImplementation(()=>{
            i.pendingItems.add(key(at));i.pendingMonsters.add(key(at));return null;
        });
        expect(e.buildAMachine(999,[],null,at)).toBeNull();
        expect([...i.pendingItems]).toEqual([old]); expect([...i.pendingMonsters]).toEqual([old]);
    });
    // Adversary: TREAT polarity reversed, REQUIRE threshold/polarity wrong,
    // wrong stride (the old 15x15 test bug), or loss of else-if precedence.
    it('qualifies both blocking flags on full-size open and divided maps, including the 100-cell threshold', () => {
        const g=grid(true), i=internal(engine(g)), small=[at];
        const band=Array.from({length:DROWS-2},(_,j)=>({x:Math.floor(DCOLS/2),y:j+1}));
        expect(i.interiorSatisfiesBlockingFlags(bp({flags:['BP_TREAT_AS_BLOCKING']}),small)).toBe(true);
        expect(i.interiorSatisfiesBlockingFlags(bp({flags:['BP_TREAT_AS_BLOCKING']}),band)).toBe(false);
        expect(i.interiorSatisfiesBlockingFlags(bp({flags:['BP_REQUIRE_BLOCKING']}),small)).toBe(false);
        expect(i.interiorSatisfiesBlockingFlags(bp({flags:['BP_REQUIRE_BLOCKING']}),band)).toBe(true);
        expect(i.interiorSatisfiesBlockingFlags(bp({flags:['BP_TREAT_AS_BLOCKING','BP_REQUIRE_BLOCKING']}),small)).toBe(true);
        for(const size of [99,100]) {
            const h=grid();
            // 10×10 left zone; remove one corner for the 99-cell case.
            for(let x=2;x<12;x++)for(let y=2;y<12;y++)h.setTerrain(x,y,T.FLOOR);
            if(size===99)h.setTerrain(2,2,T.GRANITE);
            for(let x=13;x<24;x++)for(let y=2;y<12;y++)h.setTerrain(x,y,T.FLOOR);
            h.setTerrain(12,6,T.FLOOR);
            expect(internal(engine(h)).interiorSatisfiesBlockingFlags(bp({flags:['BP_REQUIRE_BLOCKING']}),[{x:12,y:6}])).toBe(size===100);
        }
    });
    // Adversary: predicate correct but not called by area, or blocking failure
    // treated as hard failure. First open-room location fails REQUIRE, neck wins.
    it('retries actual blocking qualification before applying the machine', () => {
        const g=grid(), neck={x:12,y:6};
        for(let x=2;x<24;x++)for(let y=2;y<12;y++) if(x!==12)g.setTerrain(x,y,T.FLOOR);
        floor(g,neck);
        const b=bp({roomSize:[1,1],flags:['BP_REQUIRE_BLOCKING']}),e=engine(g,b);
        vi.spyOn(auto,'randomMatchingLocation').mockReturnValueOnce({x:5,y:5}).mockReturnValue(neck);
        const validate=vi.spyOn(internal(e),'interiorSatisfiesBlockingFlags');
        const result=e.buildAMachine(-1,[],null,null);
        expect(result).not.toBeNull();expect(result!.center).toEqual(neck);
        expect(validate.mock.results.map(r=>r.value)).toEqual([false,true]);
    });
});

describe('V-2b-9e randomMatchingLocation signature adaptation', () => {
    // Adversary: ignore pending occupation/foundation, change random draw count,
    // or conflate CE area ignoring false with autoGen respecting false.
    it('rejects both foundations and occupation without changing default callers', () => {
        const g=grid(true);
        g.setTerrainLayer(3,4,L.LIQUID,T.WATER_SHALLOW);
        g.setTerrain(5,6,T.WALL);
        const roll=vi.spyOn(rng,'randRange');
        for(const n of [1,2,3,4,5,6,7,8])roll.mockReturnValueOnce(n);
        expect(auto.randomMatchingLocation(g,T.FLOOR,T.NOTHING,{isOccupied:(x,y)=>x===1&&y===2})).toEqual({x:7,y:8});
        expect(roll).toHaveBeenCalledTimes(8);
    });
    it('retains attempt-500 failure for autoGen and the last coordinate for the CE area caller', () => {
        const g=grid(), roll=vi.spyOn(rng,'randRange').mockReturnValue(3);
        expect(auto.randomMatchingLocation(g,T.FLOOR,T.NOTHING)).toBeNull();
        expect(roll).toHaveBeenCalledTimes(1000);roll.mockClear();
        expect(auto.randomMatchingLocation(g,T.FLOOR,T.NOTHING,{acceptLastAttempt:true})).toEqual({x:3,y:3});
        expect(roll).toHaveBeenCalledTimes(1000);
    });
});
