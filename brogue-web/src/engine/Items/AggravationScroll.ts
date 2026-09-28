import i18next from 'i18next';
import type { Pos } from '../../types';
import { logger } from '../Systems/Logger';

export interface AggravationScrollWorld {
    width: number;
    height: number;
    playerLoc: Pos;
    /** Existing CE Items.c:4089-4135 alarm implementation: waypoint, path
     * distance, wake/alert, pursuit flags, scent, aggravating status and flash. */
    aggravate(radius: number, origin: Pos): void;
}

/** Items.c:7973-7976. Game's read-scroll switch calls this for the data effect,
 * then retains its shared consumption, auto-identification and turn tail. */
export function applyAggravationScroll(world: AggravationScrollWorld): void {
    world.aggravate(world.width + world.height, { ...world.playerLoc });
    logger.log(i18next.t('scroll.aggravate', {
        defaultValue: 'the scroll emits a piercing shriek that echoes throughout the dungeon!',
    }), '#aaaaaa');
}
