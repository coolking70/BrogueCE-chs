import type { Pos } from '../../types';
import type { Creature } from '../../entities/Creature';
import { Monster, monstersAreEnemies, monstersAreTeammates } from '../../entities/Monster';
import { Player } from '../../entities/Player';
import { DungeonLayer, type Grid } from '../Map/Grid';
import { cellTerrainFlags } from '../Map/DungeonFeature';
import { T_IS_FLAMMABLE, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION } from '../Map/TerrainCatalog';
import { BoltEffect, createBoltResult, type BoltConfig, type BoltHit } from './Bolt';
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

/** Ordinary CE travel: contact -> path effects -> test the updated terrain.
 * HALTS_BEFORE checks the next cell after an update; only blink rejects a
 * point-blank obstruction before its first update (CE :5635/5790). No reflection or special
 * blink/tunnel operations. onCell is execution-only; omission gives a pure trace. */
export function traceBolt(grid: Grid, bolt: BoltConfig, from: Pos, aim: Pos, world: BoltWorld,
    onCell?: (pos: Pos, hit: BoltHit | undefined) => void) {
    const flags = flagsFor(bolt), piercing = !!(flags & F.PASSES_THRU_CREATURES);
    const path: Pos[] = [], hits: BoltHit[] = [];
    for (const pos of boltLine(grid, from, aim, bolt, world)) {
        if (bolt.maxRange > 0 && path.length >= bolt.maxRange) break;
        const creature = world.creatureAt(pos);
        const blocked = !!(cellTerrainFlags(grid, pos.x, pos.y) & BLOCKS);
        // Do not activate the old, previously unreachable excavation switch.
        const checksAhead = path.length > 0 || bolt.effect === BoltEffect.BLINKING;
        if ((blocked && bolt.effect === BoltEffect.TUNNELING)
            || (checksAhead && (flags & F.HALTS_BEFORE_OBSTRUCTION) && (blocked || (creature && !piercing)))) break;
        path.push(pos);
        const hit = creature ? { creature, pos: { ...pos } } : undefined;
        if (hit) hits.push(hit);
        onCell?.(pos, hit);
        if ((creature && !piercing) || (cellTerrainFlags(grid, pos.x, pos.y) & BLOCKS)) break;
    }
    return createBoltResult(bolt, world.caster, from, aim, path, hits);
}
