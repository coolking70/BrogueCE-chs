import type { Pos } from '../../types';
import type { Creature } from '../../entities/Creature';
import { Monster, monstersAreEnemies, monstersAreTeammates } from '../../entities/Monster';
import { Player } from '../../entities/Player';
import { DungeonLayer, type Grid } from '../Map/Grid';
import { cellTerrainFlags, cellTerrainMechFlags } from '../Map/DungeonFeature';
import { T_IS_FLAMMABLE, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, TM_REFLECTS_BOLTS } from '../Map/TerrainCatalog';
import { BoltEffect, createBoltResult, type BoltConfig, type BoltHit, type BoltReflection } from './Bolt';
import { projectileReflects, randomReflectionOffset } from './BoltReflection';
import { CE_BOLT_CATALOG, CEBoltFlags as F } from './BoltCatalog';

const BLOCKS = T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION;
const FP = 1 << 16; // CE Rogue.h FP_FACTOR; C integer divisions truncate toward zero.
const OFFSETS = [[50,50], [40,40], [60,40], [60,60], [40,60],
    [50,30], [70,50], [50,70], [30,50], [50,20], [80,50], [50,80], [20,50],
    [50,10], [90,50], [50,90], [10,50], [50,1], [99,50], [50,99], [1,50]] as const;

export interface BoltWorld {
    readonly caster: Creature | null;
    /** Live occupancy, excluding dead/dormant creatures, never auto-target eligibility. */
    creatureAt(pos: Pos): Creature | undefined;
    /** CE hideDetails selects BOLT_NONE for scoring, but not for collisions. */
    readonly hideDetails?: boolean;
}

function flagsFor(bolt: BoltConfig): number {
    return bolt.ceType === null ? (bolt.piercing ? F.PASSES_THRU_CREATURES : 0)
        : CE_BOLT_CATALOG[bolt.ceType].flags;
}

function offsetLine(grid: Grid, from: Pos, to: Pos, offset: readonly [number, number]): Pos[] {
    let x = from.x * FP + FP / 2, y = from.y * FP + FP / 2;
    let dx = to.x * FP + Math.trunc(offset[0] * FP / 100) - x;
    let dy = to.y * FP + Math.trunc(offset[1] * FP / 100) - y;
    const divisor = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.trunc(dx * FP / divisor); dy = Math.trunc(dy * FP / divisor);
    const path: Pos[] = [];
    for (;;) {
        x += dx; y += dy;
        const pos = { x: x < 0 ? -1 : Math.trunc(x / FP), y: y < 0 ? -1 : Math.trunc(y / FP) };
        if (!grid.getCell(pos.x, pos.y)) return path;
        path.push(pos);
    }
}

/** CE Items.c:4146-4291, including the 21 diamond offsets and first-best tie.
 * No bolt = untuned center line. No RNG or mutation. Range limits belong to travel,
 * not scoring. Web has no MAGIC_MAPPED/submerged/IMPREGNABLE cell bookkeeping;
 * discovery uses its visible/remembered cells. Tunneling tuning remains W-13. */
export function boltLine(grid: Grid, from: Pos, to: Pos, bolt?: BoltConfig, world?: BoltWorld): Pos[] {
    if (from.x === to.x && from.y === to.y) return [];
    if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger)) return [];
    if (!bolt || !world) return offsetLine(grid, from, to, OFFSETS[0]);
    const flags = world.hideDetails ? 0 : flagsFor(bolt);
    // CE bestOffset starts at zero even if every candidate scores <= 0.
    let bestScore = 0, best = offsetLine(grid, from, to, OFFSETS[0]);
    for (const offset of OFFSETS) {
        const path = offsetLine(grid, from, to, offset);
        let score = 0, unknown = false;
        for (const p of path) {
            const cell = grid.getCell(p.x, p.y)!;
            const terrain = cellTerrainFlags(grid, p.x, p.y);
            const occupant = world.creatureAt(p);
            const invisible = occupant?.hasStatus('invisible') || (occupant instanceof Monster && occupant.isTrulyInvisible());
            // CE monsterIsHidden ignores telepathy but gas outlines invisible
            // creatures; teammates can see one another, including the player.
            const hidden = invisible && !cell.layers[DungeonLayer.GAS]
                && (!world.caster || !occupant || !monstersAreTeammates(world.caster, occupant));
            const creature = hidden ? undefined : occupant;
            const enemy = !!occupant && !!world.caster && monstersAreEnemies(world.caster, occupant);
            const ally = !!occupant && !!world.caster && monstersAreTeammates(world.caster, occupant);
            const burning = !!(flags & F.FIERY) && !!(terrain & T_IS_FLAMMABLE);
            score += 2;
            if (p.x === to.x && p.y === to.y) {
                if (!(flags & (F.TARGET_ALLIES | F.TARGET_ENEMIES))
                    || (creature && (((flags & F.TARGET_ENEMIES) && enemy) || ((flags & F.TARGET_ALLIES) && ally)))) {
                    score += unknown ? 2500 : 5000;
                }
                break;
            }
            if (world.caster instanceof Player && !cell.isVisible && !cell.hasMemory) {
                unknown = true;
                continue;
            }
            if (creature && (flags & F.TARGET_ENEMIES)) score += enemy ? 50 : -200;
            if (creature && (flags & F.TARGET_ALLIES)) score += ally ? 50 : -200;
            if (burning) score--;
            if (creature && (flags & F.PASSES_THRU_CREATURES)) continue;
            if (creature || (terrain & T_OBSTRUCTS_PASSABILITY) || ((terrain & T_OBSTRUCTS_VISION) && !burning)) break;
        }
        if (score > bestScore) { bestScore = score; best = path; }
    }
    return best;
}

/** CE Items.c:4998-5065. The first return retraces the exact incoming cells;
 * later returns use an untuned line toward the original origin. Random targets
 * retry at most 50 times to find an unobstructed first step. No aim/candidate
 * eligibility checks: a new segment can reach either team or the caster. */
function reflectedPath(grid: Grid, path: readonly Pos[], origin: Pos, towardCaster: boolean, alreadyReflected: boolean): Pos[] {
    const kink = path[path.length - 1]!;
    if (towardCaster && !alreadyReflected) {
        const back = path.slice(0, -1).reverse();
        const extensionOrigin = back[back.length - 1] ?? kink;
        return [...back, ...boltLine(grid, extensionOrigin, {
            x: 2 * origin.x - kink.x, y: 2 * origin.y - kink.y,
        })];
    }
    const random = !towardCaster || (origin.x === kink.x && origin.y === kink.y);
    let line: Pos[] = [];
    for (let attempt = 0; attempt < 50; attempt++) {
        const offset = random ? randomReflectionOffset() : undefined;
        const target = offset ? { x: kink.x + offset.x, y: kink.y + offset.y } : origin;
        line = boltLine(grid, kink, target);
        if (!random || (line[0] && !(cellTerrainFlags(grid, line[0].x, line[0].y) & BLOCKS))) break;
    }
    return line;
}

/** Execution-only hooks; previews omit these and consume no reflection RNG. */
export interface BoltExecution {
    onCell(pos: Pos, hit: BoltHit | undefined): void;
    onReflection?(reflection: BoltReflection): void;
}

/** CE PowerTables.c:52. The zap loop's 2E+1 is a zero-based index. */
export function staffBlinkDistance(enchantment: number): number {
    return Math.trunc(2 + 2 * enchantment);
}

/** CE travel: creature reflection -> contact/path effects -> updated terrain ->
 * HALTS_BEFORE -> terrain reflection. Blink has a first-cell guard and E range;
 * tunneling excavation remains separate. A bare
 * onCell callback retains the W-3 pure-geometry API; execution hooks enable W-4. */
export function traceBolt(grid: Grid, bolt: BoltConfig, from: Pos, aim: Pos, world: BoltWorld,
    execution?: BoltExecution | ((pos: Pos, hit: BoltHit | undefined) => void),
    options: { reverseBlink?: boolean } = {}) {
    const flags = flagsFor(bolt), piercing = !!(flags & F.PASSES_THRU_CREATURES);
    const hooks = typeof execution === 'object' ? execution : undefined;
    const onCell = typeof execution === 'function' ? execution : hooks?.onCell;
    const canReflect = !!hooks && !(flags & F.NEVER_REFLECTS);
    // CE Rogue.h:182 MAX_BOLT_LENGTH = DCOLS*10, zap :5679/:5841 reserves
    // one map-sized extension. Scale to the actual grid used by this engine.
    const maxLength = grid.width * 10;
    const reflectionLimit = maxLength - Math.max(grid.width, grid.height);
    const path: Pos[] = [], hits: BoltHit[] = [], reflections: BoltReflection[] = [];
    let pending = boltLine(grid, from, aim, bolt, world);
    if (options.reverseBlink && bolt.effect === BoltEffect.BLINKING) {
        // CE Items.c:5599-5624: tune FROM the beckoner, then reverse the
        // coordinates before the blinker's cell and append the beckoner's cell.
        // Re-aiming from the target is not equivalent on asymmetric diagonals.
        const forward = boltLine(grid, aim, from, bolt, {
            ...world, caster: world.creatureAt(aim) ?? null,
        });
        const end = forward.findIndex(p => p.x === from.x && p.y === from.y);
        pending = end < 0 ? [] : [...forward.slice(0, end).reverse(), { ...aim }];
    }
    const blinkRange = bolt.effect === BoltEffect.BLINKING ? staffBlinkDistance(bolt.magnitude) : Infinity;
    let next = 0;
    const reflect = (creature: Creature | null, towardCaster: boolean) => {
        const reflection = { pos: { ...path[path.length - 1]! }, pathIndex: path.length - 1, creature, towardCaster };
        pending = reflectedPath(grid, path, from, towardCaster, reflections.length > 0);
        next = 0;
        reflections.push(reflection);
        hooks?.onReflection?.(reflection);
    };
    while (next < pending.length && path.length < maxLength) {
        if (path.length >= blinkRange) break;
        if (bolt.maxRange > 0 && path.length >= bolt.maxRange) break;
        const pos = pending[next++]!;
        const creature = world.creatureAt(pos);
        const blocked = !!(cellTerrainFlags(grid, pos.x, pos.y) & BLOCKS);
        // Keep W-3's no-excavation boundary and blink's first-cell guard.
        if ((blocked && bolt.effect === BoltEffect.TUNNELING)
            || (!path.length && bolt.effect === BoltEffect.BLINKING && (blocked || (creature && !piercing)))) break;
        path.push(pos);
        if (creature && canReflect && projectileReflects(creature, world.caster) && path.length - 1 < reflectionLimit) {
            reflect(creature, projectileReflects(creature, world.caster));
            continue; // CE :5704: no effect or path exposure on the reflector.
        }
        const hit = creature ? { creature, pos: { ...pos } } : undefined;
        if (hit) hits.push(hit);
        onCell?.(pos, hit);
        if ((creature && !piercing) || (cellTerrainFlags(grid, pos.x, pos.y) & BLOCKS)) break;
        const ahead = pending[next];
        if (!ahead) break;
        const aheadBlocked = !!(cellTerrainFlags(grid, ahead.x, ahead.y) & BLOCKS);
        if ((flags & F.HALTS_BEFORE_OBSTRUCTION) && (aheadBlocked || (!piercing && world.creatureAt(ahead)))) break;
        if (canReflect && aheadBlocked && (cellTerrainMechFlags(grid, ahead.x, ahead.y) & TM_REFLECTS_BOLTS)
            && path.length - 1 < reflectionLimit) {
            reflect(null, false); // CE projectileReflects(caster, NULL) is false.
        }
    }
    const result = createBoltResult(bolt, world.caster, from, aim, path, hits);
    result.reflections = reflections;
    return result;
}
