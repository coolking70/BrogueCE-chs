import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { BoltEffect, getBoltForItem, type BoltConfig } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { boltLine, traceBolt } from '../engine/Combat/BoltTrajectory';
import { cellTerrainFlags } from '../engine/Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION } from '../engine/Map/TerrainCatalog';
import { CombatSystem } from '../engine/Combat/Combat';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import type { Pos } from '../types';

function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(18, 12);
    for (let x = 0; x < 18; x++) for (let y = 0; y < 12; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        g.grid.getCell(x, y)!.isVisible = true;
        g.grid.getCell(x, y)!.hasMemory = true;
    }
    g.player = new Player(4, 5); g.monsters = []; g.items = [];
    g.environment = new EnvironmentManager(g.grid);
    g.spawnFloatingText = vi.fn();
    (g as unknown as { updateVision(): void }).updateVision = vi.fn();
    return g;
}
function rat(g: Game, x: number, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.maxHp = m.hp = 100; g.monsters.push(m); return m;
}
const config = (id = 'staff_of_lightning') => getBoltForItem(id)!;
// W-5: construct before RNG spies/counters; these suites observe casting, not generation.
function prepareZap(g: Game, id = 'staff_of_lightning', aim: Pos = { x: 6, y: 5 }, override?: Partial<BoltConfig>) {
    const item = id.startsWith('staff') ? ItemLoader.spawnStaff(id, -1, -1)! : ItemLoader.spawnWand(id, -1, -1)!;
    // W-8: fix instance E for trajectory fixtures; old 6/10 HP constants are retired.
    if (id.startsWith('staff')) item.enchantment = 2;
    return () => g.zapBoltFromPlayer({ ...config(id), ...override }, item, aim);
}
function zap(g: Game, id = 'staff_of_lightning', aim: Pos = { x: 6, y: 5 }, override?: Partial<BoltConfig>) {
    return prepareZap(g, id, aim, override)();
}
function world(g: Game, hideDetails = false) {
    return { caster: g.player, hideDetails, creatureAt: (p: Pos) => g.monsters.find(m => m.hp > 0 && !m.isDormant && m.loc.x === p.x && m.loc.y === p.y) };
}
beforeEach(() => { ItemLoader.identifiedItems.clear(); vi.restoreAllMocks(); });

describe('W-3 seven required stages', () => {
    it('two collinear creatures: lightning passes the aimed first creature, fire stops at it', () => {
        for (const [id, damage, count] of [['staff_of_lightning', 3, 2], ['staff_of_fire', 3, 1]] as const) {
            const g = scene(), first = rat(g, 6), second = rat(g, 9);
            const cast = prepareZap(g, id, first.loc);
            vi.spyOn(rng, 'randClumpedRange').mockReturnValue(3); // CE E2 minimum, PowerTables.c:49-51
            const result = cast();
            expect(result.hits.map(h => h.creature)).toEqual(count === 2 ? [first, second] : [first]);
            expect([first.hp, second.hp]).toEqual([100 - damage, count === 2 ? 100 - damage : 100]);
            expect(result.aimPos).toEqual(first.loc);
            expect(result.landingPos).toEqual(count === 2 ? { x: 17, y: 5 } : first.loc);
        }
    });

    it('empty shot reaches the actual map edge beyond both aim and the old 40-cell cutoff; maxRange is explicit', () => {
        const g = scene(); g.grid = new Grid(100, 12);
        for (let x = 0; x < 100; x++) for (let y = 0; y < 12; y++) g.grid.setTerrain(x, y, T.FLOOR);
        g.environment = new EnvironmentManager(g.grid);
        const result = zap(g);
        expect(result.path).toHaveLength(95); expect(result.landingPos).toEqual({ x: 99, y: 5 });
        expect(result.hits).toEqual([]); expect(result.outcome?.autoID).toBe(false);
        expect(zap(g, 'staff_of_lightning', { x: 6, y: 5 }, { maxRange: 3 }).path).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }]);
    });

    it('adjacent obstruction: CE first-update exception for conjuration; blink guard has no landing or origin exposure', () => {
        const g = scene(); g.grid.setTerrain(5, 5, T.WALL); g.grid.setTerrain(4, 5, T.GRASS);
        expect(zap(g, 'staff_of_fire').path).toEqual([{ x: 5, y: 5 }]);
        // CE checks HALTS_BEFORE after the first update; conjuration has no
        // blink-specific point-blank guard. Do not silently invent one.
        expect(zap(g, 'staff_of_conjuration').path).toEqual([{ x: 5, y: 5 }]);
        const stopped = zap(g, 'wand_of_slowness', { x: 6, y: 5 }, { effect: BoltEffect.BLINKING, ceType: CEBoltType.BLINKING });
        expect(stopped.path).toEqual([]); expect(stopped.landingPos).toBeNull(); expect(stopped.hits).toEqual([]);
        expect(stopped.outcome).toEqual({ autoID: false, casterMovement: null });
        expect(g.grid.getCell(4, 5)!.isBurning).toBe(false);
    });

    it.each([T.WALL, T.GRANITE, T.DOOR, T.LOCKED_DOOR, T.CRYSTAL_WALL, T.FORCEFIELD, T.PORTCULLIS_CLOSED])(
        'door/crystal/machine obstruction %s blocks forward travel without weakening map flags (W-4 crystal now reflects)', terrain => {
            const g = scene(), beyond = rat(g, 10); g.grid.setTerrain(7, 5, terrain);
            const flags = cellTerrainFlags(g.grid, 7, 5);
            expect(flags & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION)).not.toBe(0);
            // W-4 CE Items.c:5830-5852: crystal bounces at (6,5); all other
            // original samples still stop at the obstacle. Pin the random branch south.
            const cast = prepareZap(g, 'wand_of_slowness', beyond.loc);
            if (terrain === T.CRYSTAL_WALL) vi.spyOn(rng, 'randRange').mockReturnValue(16);
            const result = cast();
            expect(result.landingPos).toEqual(terrain === T.CRYSTAL_WALL ? { x: 6, y: 11 } : { x: 7, y: 5 }); expect(result.hits).toEqual([]);
            expect(beyond.hasStatus('slowed')).toBe(false); expect(result.outcome?.autoID).toBe(false);
            expect(cellTerrainFlags(g.grid, 7, 5)).toBe(flags);
        });

    it.each([L.DUNGEON, L.LIQUID, L.SURFACE, L.GAS])('all-layer obstruction includes layer %s even when floor is the base', layer => {
        const g = scene(); g.grid.setTerrainLayer(7, 5, layer, T.FORCEFIELD);
        const target = rat(g, 10);
        expect(zap(g, 'staff_of_poison', target.loc).landingPos).toEqual({ x: 7, y: 5 });
        expect(target.hasStatus('poisoned')).toBe(false);
    });

    it('same origin/aim yields no travel, contacts, animation, effect, autoID, RNG or time', () => {
        const g = scene(); g.grid.setTerrain(4, 5, T.GRASS);
        const casts = ['staff_of_fire', 'staff_of_lightning', 'staff_of_healing'].map(id => prepareZap(g, id, g.player.loc));
        const before = [rng.randomNumbersGenerated, timeSystem.currentTick, g.player.hp];
        for (const cast of casts) {
            const result = cast();
            expect(result.path).toEqual([]); expect(result.frames).toEqual([]); expect(result.hits).toEqual([]);
            expect(result.landingPos).toBeNull(); expect(result.outcome).toEqual({ autoID: false, casterMovement: null });
        }
        expect(g.grid.getCell(4, 5)!.isBurning).toBe(false);
        expect([rng.randomNumbersGenerated, timeSystem.currentTick, g.player.hp]).toEqual(before);
    });

    it('aim is a direction waypoint: even non-piercing empty aim continues to a later creature', () => {
        const g = scene(), target = rat(g, 10);
        const result = zap(g, 'wand_of_slowness');
        expect(result.aimPos).toEqual({ x: 6, y: 5 }); expect(result.landingPos).toEqual(target.loc);
        expect(result.hits.map(h => h.creature)).toEqual([target]); expect(target.hasStatus('slowed')).toBe(true);
    });

    it('CE diagonal center rounding in all octants and exact corner passage do not use movement corner blocking', () => {
        const g = scene(), origin = { x: 8, y: 6 };
        for (const [dx, dy] of [[4,2], [2,4], [-4,2], [-2,4], [4,-2], [2,-4], [-4,-2], [-2,-4]]) {
            const aim = { x: origin.x + dx!, y: origin.y + dy! };
            // C fixed point centerline: floor(center + integer major steps).
            const expected = Array.from({ length: 4 }, (_, i) => ({
                x: Math.floor(origin.x + 0.5 + dx! * (i + 1) / 4),
                y: Math.floor(origin.y + 0.5 + dy! * (i + 1) / 4),
            }));
            expect(boltLine(g.grid, origin, aim).slice(0, 4)).toEqual(expected);
        }
        g.grid.setTerrain(5, 5, T.WALL); g.grid.setTerrain(4, 6, T.WALL);
        expect(zap(g, 'staff_of_lightning', { x: 5, y: 6 }).path[0]).toEqual({ x: 5, y: 6 });
    });

    it('CE diamond offset selection goes around a centerline obstruction while still passing the aim', () => {
        const g = scene(), target = rat(g, 8, 7);
        g.grid.setTerrain(5, 6, T.WALL); // centerline's first step (5,6)
        const center = boltLine(g.grid, g.player.loc, target.loc);
        expect(center[0]).toEqual({ x: 5, y: 6 });
        const result = zap(g, 'wand_of_slowness', target.loc);
        expect(result.path.slice(0, 4)).toEqual([{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 7 }]);
        expect(result.hits[0]!.creature).toBe(target); expect(target.hasStatus('slowed')).toBe(true);
    });
});

describe('W-3 sequencing, recipients and W-2 observation', () => {
    it('halts-before stops before terrain or first creature; preview is pure and does not fake a contact', () => {
        for (const obstruction of ['terrain', 'creature']) {
            const g = scene();
            if (obstruction === 'terrain') g.grid.setTerrain(8, 5, T.DOOR); else rat(g, 8);
            const before = JSON.stringify([g.grid, g.monsters, rng.randomNumbersGenerated]);
            const result = traceBolt(g.grid, config('staff_of_conjuration'), g.player.loc, { x: 10, y: 5 }, world(g));
            expect(result.landingPos).toEqual({ x: 7, y: 5 }); expect(result.hits).toEqual([]); expect(result.outcome).toBeNull();
            expect(JSON.stringify([g.grid, g.monsters, rng.randomNumbersGenerated])).toBe(before);
        }
    });

    it('CE defaults to center when every candidate scores nonpositive (collinear teammates)', () => {
        const g = scene(), first = rat(g, 6), second = rat(g, 10);
        first.isAlly = second.isAlly = true;
        const result = traceBolt(g.grid, config('wand_of_slowness'), g.player.loc, second.loc, world(g));
        expect(result.path).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }]);
        expect(result.hits.map(h => h.creature)).toEqual([first]);
    });

    it('unknown cells cannot steer the player around hidden obstacles; known route is preferred', () => {
        const g = scene(), aim = { x: 8, y: 7 };
        g.grid.setTerrain(5, 6, T.WALL);
        const cell = g.grid.getCell(5, 6)!; cell.isVisible = false; cell.hasMemory = false;
        // The fully known off-center path beats a route through unknown cells.
        expect(boltLine(g.grid, g.player.loc, aim, config(), world(g, true))[0]).toEqual({ x: 5, y: 5 });
        for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
            const c = g.grid.getCell(x, y)!; c.isVisible = false; c.hasMemory = false;
        }
        const before = boltLine(g.grid, g.player.loc, aim, config(), world(g, true));
        g.grid.setTerrain(5, 6, T.FLOOR);
        expect(boltLine(g.grid, g.player.loc, aim, config(), world(g, true))).toEqual(before);
    });

    it('fire burns a door before testing continued travel, but cannot pass an unburnable upper layer', () => {
        for (const overlay of [false, true]) {
            const g = scene(), target = rat(g, 10); g.grid.setTerrain(7, 5, T.DOOR);
            if (overlay) g.grid.setTerrainLayer(7, 5, L.SURFACE, T.FORCEFIELD);
            const cast = prepareZap(g, 'staff_of_fire', target.loc);
            vi.spyOn(rng, 'randClumpedRange').mockReturnValue(3);
            const result = cast();
            expect(result.outcome?.autoID).toBe(true); // real ignition, regardless of reaching target
            expect(result.hits.map(h => h.creature)).toEqual(overlay ? [] : [target]);
            expect(target.hp).toBe(overlay ? 100 : 97);
            expect(result.landingPos).toEqual(overlay ? { x: 7, y: 5 } : target.loc);
        }
    });

    it('W-2 autoID sees fire beyond aim, but not through crystal; a southward reflection does not reach origin', () => {
        for (const blocked of [false, true]) {
            const g = scene(); g.grid.setTerrain(4, 5, T.GRASS); g.grid.setTerrain(10, 5, T.GRASS);
            const cast = prepareZap(g, 'staff_of_fire');
            if (blocked) { g.grid.setTerrain(8, 5, T.CRYSTAL_WALL); vi.spyOn(rng, 'randRange').mockReturnValue(16); }
            const result = cast();
            expect(result.outcome?.autoID).toBe(!blocked);
            expect(g.grid.getCell(10, 5)!.isBurning).toBe(!blocked);
            expect(g.grid.getCell(4, 5)!.isBurning).toBe(false);
        }
    });

    it('W-2 electricity identifies only real promotion: beyond aim works, behind door does not, crystal still stops', () => {
        for (const blocked of [false, true]) {
            const g = scene(); g.grid.setTerrain(10, 5, T.ELECTRIC_CRYSTAL_OFF);
            if (blocked) g.grid.setTerrain(8, 5, T.DOOR);
            const result = zap(g);
            expect(result.outcome?.autoID).toBe(!blocked);
            expect(result.landingPos).toEqual({ x: blocked ? 8 : 10, y: 5 });
            expect(g.grid.getCell(10, 5)!.terrain).toBe(blocked ? T.ELECTRIC_CRYSTAL_OFF : T.ELECTRIC_CRYSTAL_ON);
        }
    });

    it('monster spark uses ordered actual contacts beyond aim; non-piercing spell is intercepted before intended target', () => {
        for (const name of ['SPARK', 'SLOW_2']) {
            const g = scene(), caster = rat(g, 2), first = rat(g, 6), second = rat(g, 10);
            g.player.loc = { x: 15, y: 8 }; first.isAlly = second.isAlly = true;
            const attacks = vi.spyOn(CombatSystem, 'attack');
            const result = g.castMonsterBolt(caster, name === 'SPARK' ? first : second, name)!;
            expect(result.hits.map(h => h.creature)).toEqual(name === 'SPARK' ? [first, second] : [first]);
            if (name === 'SPARK') expect(attacks.mock.calls.map(c => c[1])).toEqual([first, second]);
            else { expect(first.hasStatus('slowed')).toBe(true); expect(second.hasStatus('slowed')).toBe(false); }
            attacks.mockRestore();
        }
    });

    it('player is a real intervening recipient; invisible creatures collide, dormant/dead ones do not', () => {
        const g = scene(), caster = rat(g, 2), target = rat(g, 10);
        const result = g.castMonsterBolt(caster, target, 'SLOW_2')!;
        expect(result.hits[0]!.creature).toBe(g.player); expect(g.player.hasStatus('slowed')).toBe(true);
        expect(target.hasStatus('slowed')).toBe(false);
        g.monsters = []; const dead = rat(g, 5), dormant = rat(g, 6), invisible = rat(g, 7);
        dead.hp = 0; dormant.isDormant = true; invisible.applyStatus('invisible', 10);
        expect(zap(g).hits.map(h => h.creature)).toEqual([invisible]);
    });

    it('a dormant occupant at the landing is not resurrected as an effect target by a location lookup', () => {
        for (const id of ['staff_of_fire', 'staff_of_lightning', 'wand_of_slowness']) {
            const g = scene(), dormant = rat(g, 17); dormant.isDormant = true;
            const result = zap(g, id);
            expect(result.landingPos).toEqual(dormant.loc); expect(result.hits).toEqual([]);
            expect(result.outcome?.autoID).toBe(false); expect(dormant.hp).toBe(100);
            expect(dormant.hasStatus('slowed')).toBe(false);
        }
    });

    it('monster fire cannot hurt a target behind crystal; dragonfire uses existing path DF before fire on its reflected route', () => {
        const g = scene(), caster = rat(g, 2), target = rat(g, 10); g.player.loc = { x: 15, y: 9 };
        g.grid.setTerrain(7, 5, T.CRYSTAL_WALL);
        vi.spyOn(rng, 'randRange').mockReturnValue(16); // W-4: reflect south at the previous cell.
        const fire = g.castMonsterBolt(caster, target, 'FIRE')!;
        expect(fire.hits).toEqual([]); expect(target.hp).toBe(100); expect(fire.outcome?.autoID).toBe(false);
        g.grid.setTerrain(4, 5, T.GRASS);
        const terrainAtIgnition: T[] = [];
        const ignite = g.environment.ignite.bind(g.environment);
        vi.spyOn(g.environment, 'ignite').mockImplementation((x, y) => {
            if (x === 4 && y === 5) terrainAtIgnition.push(g.grid.getCell(x, y)!.layers[L.SURFACE]!);
            ignite(x, y);
        });
        const dragon = g.castMonsterBolt(caster, target, 'DRAGONFIRE')!;
        expect(terrainAtIgnition).toEqual([T.OBSIDIAN]);
        expect(g.grid.getCell(8, 5)!.layers[L.SURFACE]).not.toBe(T.OBSIDIAN);
        expect(dragon.landingPos).toEqual({ x: 6, y: 11 });
        expect(dragon.reflections[0]!.pos).toEqual({ x: 6, y: 5 }); expect(target.hp).toBe(100);
        expect(dragon.outcome?.autoID).toBe(false); // pathDF alone is not a CE identification observation
    });

    it('contact precedes terrain exposure and is snapshotted before target movement; effect failure still is a hit', () => {
        const g = scene(), target = rat(g, 7);
        let hpAtExposure = 0;
        vi.spyOn(g.environment, 'ignite').mockImplementation((x, y) => { if (x === 7 && y === 5) hpAtExposure = target.hp; });
        const cast = prepareZap(g, 'staff_of_fire', target.loc);
        vi.spyOn(rng, 'randClumpedRange').mockReturnValue(3);
        cast();
        expect(hpAtExposure).toBe(97); // W-8 CE E2 minimum, contact still precedes exposure
        const before = { ...target.loc };
        const moved = zap(g, 'wand_of_beckoning', target.loc);
        expect(moved.hits[0]!.pos).toEqual(before); expect(moved.landingPos).toEqual(before);
        expect(target.loc).not.toEqual(before);
        target.statusImmunities.add('poisoned');
        expect(zap(g, 'staff_of_poison', target.loc).hits[0]!.creature).toBe(target);
        expect(target.hasStatus('poisoned')).toBe(false);
    });

    it('W-4 reflection and W-12 blink move the correct caster; W-13 tunneling stays deferred, machine flags unchanged', () => {
        const g = scene(), guardian = rat(g, 7, 5, 'stone_guardian');
        const reflected = zap(g, 'staff_of_fire', guardian.loc);
        expect(reflected.hits.map(h => h.creature)).toEqual([g.player]);
        expect(reflected.path.map(p => p.x)).toEqual([5, 6, 7, 6, 5, 4]); // CE :5682 retraces the incoming route
        g.monsters = []; g.grid.setTerrain(7, 5, T.WALL);
        const before = JSON.stringify(g.grid), origin = { ...g.player.loc };
        for (const [effect, ceType] of [[BoltEffect.TUNNELING, CEBoltType.TUNNELING], [BoltEffect.BLINKING, CEBoltType.BLINKING]] as const) {
            const result = zap(g, 'wand_of_slowness', { x: 10, y: 5 }, { effect, ceType });
            expect(result.landingPos).toEqual({ x: 6, y: 5 });
            // W-12 closes the previously explicit blink gap (CE Items.c:5516).
            const destination = effect === BoltEffect.BLINKING ? { x: 6, y: 5 } : origin;
            expect(result.outcome?.casterMovement).toEqual(effect === BoltEffect.BLINKING ? { from: origin, to: destination } : null);
            expect(JSON.stringify(g.grid)).toBe(before); expect(g.player.loc).toEqual(destination);
        }
    });
});
