import type { Creature } from '../../entities/Creature';
import type { Pos } from '../../types';
import type { Grid } from '../Map/Grid';
import { DF } from '../Map/DungeonFeatureCatalog';
import { catalogFeature, spawnDungeonFeature } from '../Map/DungeonFeature';
import { ItemCategory, type Item } from './Item';

/** Items.c:6914-6916: test BEFORE resolving an ordinary projectile attack.
 * Incendiary darts do not roll weapon accuracy, physical damage or runes. */
export function isIncendiaryDart(item: Item): boolean {
    return item.category === ItemCategory.WEAPON && item.identityId === 'incendiary_dart';
}

export interface IncendiaryDartWorld {
    grid: Grid;
    creatureAt(pos: Pos): Creature | undefined | null;
    exposeToFire(creature: Creature): void;
}

/** Items.c:7049-7055. Receives the single unit already detached by
 * prepareThrownItem and the final trajectory cell (including empty ground,
 * water, chasms and a point-blank thrower's cell). true means DESTROY/return:
 * do not place this item, convert it to a dart, or consume the stack again.
 * Query the occupant after the DF transaction, just as CE does. Fire immunity
 * and submersion remain the existing exposeCreatureToFire owner's concern. */
export function resolveIncendiaryDart(item: Item, impact: Pos, world: IncendiaryDartWorld): boolean {
    if (!isIncendiaryDart(item)) return false;
    spawnDungeonFeature(world.grid, impact.x, impact.y, catalogFeature(DF.DF_DART_EXPLOSION), false);
    const target = world.creatureAt(impact);
    if (target) world.exposeToFire(target);
    return true;
}
