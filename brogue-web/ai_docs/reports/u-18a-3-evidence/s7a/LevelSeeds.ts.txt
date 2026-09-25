import { type Random } from '../Random';
import { isSeed } from '../Seed';
import { DCOLS, DROWS, type Pos } from '../../types';

/** CE GlobalsBrogue.c: deepestLevel=40, including terminal levels[40].
 * D26 contains the amulet; D40 contains the terminal portal. */
export const CE_DEEPEST_LEVEL = 40;
export interface LevelSeed {
    levelSeed: string;
    visited: boolean;
    /** Planned coordinates until generated; then actual CE stair coordinates. */
    upStairsLoc: Pos;
    downStairsLoc: Pos;
}

/** CE RogueMain.c initializeRogue; Monsters.c distanceBetween uses Chebyshev distance. */
export function initializeLevelSeeds(random: Random, seed: string): LevelSeed[] {
    const levels: LevelSeed[] = [];
    let upStairsLoc = { x: Math.floor((DCOLS - 1) / 2) - 1, y: DROWS - 2 };
    for (let i = 0; i <= CE_DEEPEST_LEVEL; i++) {
        let levelSeed: bigint;
        if (BigInt(seed) >> 32n) levelSeed = random.rand64bits();
        else levelSeed = BigInt(random.randRange(0, 9999) + 10000 * random.randRange(0, 9999));
        if (levelSeed === 0n) levelSeed = BigInt(i + 1);
        let downStairsLoc: Pos;
        do {
            downStairsLoc = { x: random.randRange(1, DCOLS - 2), y: random.randRange(1, DROWS - 2) };
        } while (Math.max(Math.abs(upStairsLoc.x - downStairsLoc.x), Math.abs(upStairsLoc.y - downStairsLoc.y)) < Math.floor(DCOLS / 3));
        levels.push({ levelSeed: levelSeed.toString(), visited: false, upStairsLoc: { ...upStairsLoc }, downStairsLoc });
        upStairsLoc = downStairsLoc;
    }
    return levels;
}

export function copyLevelSeeds(levels: readonly LevelSeed[]): LevelSeed[] {
    return levels.map(level => ({ ...level, upStairsLoc: { ...level.upStairsLoc }, downStairsLoc: { ...level.downStairsLoc } }));
}

export function isLevelSeeds(value: unknown): value is LevelSeed[] {
    if (!Array.isArray(value) || value.length !== CE_DEEPEST_LEVEL + 1) return false;
    const pos = (p: Pos) => p && Number.isInteger(p.x) && p.x >= 1 && p.x <= DCOLS - 2
        && Number.isInteger(p.y) && p.y >= 1 && p.y <= DROWS - 2;
    return Array.from(value).every(level => level && isSeed(level.levelSeed) && level.levelSeed !== '0'
        && typeof level.visited === 'boolean' && pos(level.upStairsLoc) && pos(level.downStairsLoc));
}
