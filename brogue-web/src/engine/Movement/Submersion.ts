import type { Creature } from '../../entities/Creature';
import type { Monster } from '../../entities/Monster';
import type { Grid } from '../Map/Grid';
import { cellTerrainFlags, cellTerrainMechFlags } from '../Map/DungeonFeature';
import { T_IS_DEEP_WATER, T_LAVA_INSTA_DEATH, T_OBSTRUCTS_PASSABILITY, TM_ALLOWS_SUBMERGING } from '../Map/TerrainCatalog';

/** MB_SUBMERGED is bookkeeping, independent of invisibility and MONST_SUBMERGES. */
export function isSubmerged(creature: Creature | undefined | null): boolean {
    return !!creature && 'submerged' in creature && creature.submerged === true;
}

/** CE Monsters.c:692–700. Temporary levitation is deliberately not a veto. */
export function monsterCanSubmergeNow(m: Monster, grid: Grid): boolean {
    return m.hasBehavior('MONST_SUBMERGES')
        && !!(cellTerrainMechFlags(grid, m.x, m.y) & TM_ALLOWS_SUBMERGING)
        && !(cellTerrainFlags(grid, m.x, m.y) & T_OBSTRUCTS_PASSABILITY)
        && !m.seizing && !m.seized && !m.isCaged
        && (m.hasBehavior('MONST_IMMUNE_TO_FIRE') || m.isInvulnerable() || m.hasStatus('immune_fire')
            || !(cellTerrainFlags(grid, m.x, m.y) & T_LAVA_INSTA_DEATH));
}

/** CE Monsters.c:179–192. Gas does not outline submerged creatures. */
export function hiddenBySubmersion(grid: Grid, target: Creature, observer?: Creature | null): boolean {
    return isSubmerged(target) && !(observer
        && (cellTerrainFlags(grid, observer.x, observer.y) & T_IS_DEEP_WATER)
        && !observer.hasStatus('levitating') && !observer.hasStatus('flying'));
}

/** CE Time.c:149 and setMonsterLocation: terrain changes surface immediately. */
export function surfaceOnDryLand(m: Monster, grid: Grid): void {
    if (m.submerged && !(cellTerrainMechFlags(grid, m.x, m.y) & TM_ALLOWS_SUBMERGING)) m.submerged = false;
}
