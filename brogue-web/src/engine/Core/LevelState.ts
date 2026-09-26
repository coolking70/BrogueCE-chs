import type { Grid } from '../Map/Grid';
import type { EnvironmentManager } from '../Environment/Gas';
import type { FOVSys } from '../Lighting/FOV';
import type { LightMap } from '../Lighting/LightMap';
import type { Monster } from '../../entities/Monster';
import type { Item } from '../Items/Item';
import type { ScentMap } from '../Map/Scent';
import type { WaypointSystem } from '../Map/WaypointMap';
import type { Pos } from '../../types';

/** Detached floor ownership; the active floor's fields remain on Game. */
export interface LevelState {
    grid: Grid;
    environment: EnvironmentManager;
    fov: FOVSys;
    lightMap: LightMap;
    monsters: Monster[];
    /** CE levels[d].dormantMonsters: dormant ownership belongs to its floor. */
    dormantMonsters?: Monster[];
    items: Item[];
    visibleMonsters: Set<Monster>;
    visibleItems: Set<Item>;
    /** P1-31: derived machine membership stays with its cached floor. */
    machineCells?: Set<number>;
    scent?: ScentMap;
    waypoints?: WaypointSystem;
    awaySince?: number;
    playerExitedVia?: Pos;
    pendingCaughtFireCells?: Pos[];
}
