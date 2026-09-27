import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Random, RNGType, rng } from '../engine/Random';
import { Grid, TerrainType as T } from '../engine/Map/Grid';
import { Monster, type MonsterData } from '../entities/Monster';
import { blueprintQualifies, RETIRED_INVENTED_BLUEPRINT_IDS, type BlueprintDef } from '../engine/Generator/BlueprintEngine';
import hordes from '../data/hordes.json';
import blueprints from '../data/blueprints.json';
import monsters from '../data/monsters.json';
import golden from './fixtures/x2o-ce-catalog.json';
import oracle from './fixtures/x2o-clump-oracle.json';

afterEach(() => vi.restoreAllMocks());
function arena(terrain = T.FLOOR): any {
    const g: any = new Game();
    g.grid = new Grid(79, 29); g.monsters = []; g.dormantMonsters = [];
    g.player.loc = { x: 2, y: 2 }; g.depth = 30;
    for (let x = 1; x < 78; x++) for (let y = 1; y < 28; y++) g.grid.setTerrain(x, y, terrain);
    rng.seedRandomGenerator(20260927);
    return g;
}

describe('X2o independent CE catalog and exhaustive original-C randClump', () => {
    it('pins CE source provenance and every member triple in all 175 rows', () => {
        for (const [file, hash] of Object.entries(golden.sources))
            expect(createHash('sha256').update(readFileSync(`../${file}`)).digest('hex')).toBe(hash);
        expect(hordes).toHaveLength(golden.hordes.length);
        hordes.forEach((h, index) => {
            const ce = golden.hordes[index]!;
            expect(h.leader).toBe(ce.leader);
            expect(h.members.map(m => ({ type: m.type, lower: m.minCount, upper: m.maxCount, clumpFactor: m.clumpFactor }))).toEqual(ce.members);
        });
    });
    it('all CE-mapped blueprints match both depth endpoints; unmapped rows remain explicitly retired', () => {
        const mapped = blueprints.filter(b => b.ceBlueprintId !== null);
        expect(mapped).toHaveLength(70);
        expect(new Set(mapped.map(b => b.ceBlueprintId)).size).toBe(70);
        // CE48 is the existing audited unsupported blueprint, not an omitted depth check.
        expect(golden.blueprints.filter(c => !mapped.some(b => b.ceBlueprintId === c.ceBlueprintId)).map(c => c.ceBlueprintId)).toEqual([48]);
        for (const b of blueprints) {
            if (b.ceBlueprintId === null) { expect(RETIRED_INVENTED_BLUEPRINT_IDS.has(b.id)).toBe(true); continue; }
            const ce = golden.blueprints.find(c => c.ceBlueprintId === b.ceBlueprintId)!;
            expect(b.depthRange, b.id).toEqual(ce.depthRange);
            const flags = ['BP_ADOPT_ITEM', 'BP_VESTIBULE'].filter(f => b.flags.includes(f) || (f === 'BP_ADOPT_ITEM' && b.category === 'key_guard') || (f === 'BP_VESTIBULE' && b.category === 'vestibule'));
            for (const d of [ce.depthRange[0]! - 1, ce.depthRange[0]!, ce.depthRange[1]!, ce.depthRange[1]! + 1])
                expect(blueprintQualifies(b as BlueprintDef, d, flags), `${b.id} D${d}`).toBe(d >= ce.depthRange[0]! && d <= ce.depthRange[1]!);
        }
    });
    it('exhausts every C branch, value and rand_range call sequence, including constant and oversized clumps', () => {
        for (const row of oracle) for (const c of row.cases) {
            const r = new Random(37); let index = 0;
            const spy = vi.spyOn(r, 'randRange').mockImplementation((lo, hi) => {
                const call = c.calls[index++]; expect(call).toBeDefined();
                expect([lo, hi]).toEqual(call!.slice(0, 2)); return call![2]!;
            });
            expect(r.randClumpedRange(row.range[0]!, row.range[1]!, row.range[2]!)).toBe(c.value);
            expect(index).toBe(c.calls.length); spy.mockRestore();
        }
        const deep = oracle.find(r => r.range.join() === '5,10,2')!;
        expect([5,6,7,8,9,10].map(n => deep.cases.filter(c => c.value === n).length)).toEqual([1,2,3,3,2,1]);
        expect(deep.cases.every(c => c.calls.length === 2)).toBe(true);
    });
    it('same initial real RNG has the C-oracle result, logical draw count and complete final state on both streams', () => {
        for (const row of oracle) for (let seed = 1; seed <= 16; seed++) for (const stream of [RNGType.RNG_SUBSTANTIVE, RNGType.RNG_COSMETIC]) {
            const actual = new Random(seed), expected = new Random(seed);
            actual.setRNG(stream); expected.setRNG(stream);
            const bounds = row.cases[0]!.calls;
            const tape = bounds.map(([lo, hi]) => expected.randRange(lo!, hi!));
            const match = row.cases.find(c => c.calls.every((call, i) => call[2] === tape[i]))!;
            expect(actual.randClumpedRange(row.range[0]!, row.range[1]!, row.range[2]!)).toBe(match.value);
            expect(actual.getState()).toEqual(expected.getState());
        }
    });
});

describe('X2o horde consumers', () => {
    it('every ordinary/captive/machine horde consumes each member triple exactly once before placement', () => {
        const g = arena();
        vi.spyOn(g, 'findMinionSpawnSpot').mockReturnValue(null);
        const roll = vi.spyOn(rng, 'randClumpedRange');
        for (const h of hordes) {
            g.monsters = []; roll.mockClear();
            expect(g.spawnHordeAt(h, { x: 35, y: 14 }, 1, false)).toBe(true);
            expect(roll.mock.calls).toEqual(h.members.map(m => [m.minCount, m.maxCount, m.clumpFactor]));
            expect(g.monsters).toHaveLength(1);
            expect(g.monsters[0].isCaged).toBe(h.flags.includes('HORDE_LEADER_CAPTIVE'));
        }
    });
    it.each(['GOLEM', 'KRAKEN'])('%s clumped D30 horde places exactly the rolled members on real terrain', type => {
        const h = hordes.find(h => h.leader === type && h.minLevel === 30)!;
        expect(h).toBeDefined();
        const g = arena(type === 'KRAKEN' ? T.WATER_DEEP : T.FLOOR);
        const roll = vi.spyOn(rng, 'randClumpedRange');
        const collected: Monster[] = [];
        expect(g.spawnHordeAt(h, { x: 35, y: 14 }, 30, false, undefined, collected)).toBe(true);
        expect(roll.mock.calls).toEqual([[5, 10, 2]]);
        expect(collected.length).toBe(1 + roll.mock.results[0]!.value);
        expect(new Set(collected.map(m => `${m.x},${m.y}`)).size).toBe(collected.length);
        expect(collected.slice(1).every(m => m.leader === collected[0])).toBe(true);
        expect(collected.every(m => g.grid.getCell(m.x,m.y).terrain === (type === 'KRAKEN' ? T.WATER_DEEP : T.FLOOR))).toBe(true);
    });
    it('all summon rows use their complete CE triple through the actual summon consumer', () => {
        const g = arena();
        const pick = vi.spyOn(g, 'pickHordeType');
        const roll = vi.spyOn(rng, 'randClumpedRange');
        for (const h of hordes.filter(h => h.flags.includes('HORDE_IS_SUMMONED'))) {
            const summoner = new Monster(35, 14, (monsters as MonsterData[]).find(m => m.id === h.leader.toLowerCase())!);
            g.monsters = [summoner]; pick.mockReturnValue(h); roll.mockClear();
            g.summonMinionsFor(summoner);
            expect(roll.mock.calls).toEqual(h.members.map(m => [m.minCount, m.maxCount, m.clumpFactor]));
            expect(g.monsters.filter((m: Monster) => m !== summoner).length).toBe(roll.mock.results.reduce((n, r) => n + r.value, 0));
        }
    });
});
