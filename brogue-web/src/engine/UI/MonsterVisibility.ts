import type { Player } from '../../entities/Player';
import type { Monster } from '../../entities/Monster';
import { DungeonLayer, TerrainType, type Grid } from '../Map/Grid';

/** CE Monsters.c:166-252: identity and location are separate kinds of knowledge. */
export function monsterRevealed(player: Player, monster: Monster): boolean {
    return monster.hasStatus('entranced')
        || (player.hasStatus('telepathy') && !monster.hasBehavior('MONST_INANIMATE'));
}

export function monsterHidden(grid: Grid, monster: Monster): boolean {
    if (monster.isDormant) return true;
    if (monster.isAlly) return false;
    return monster.hasStatus('invisible') && !monsterInGas(grid, monster);
}

export function monsterInGas(grid: Grid, monster: Monster): boolean {
    const gas = grid.getCell(monster.loc.x, monster.loc.y)?.layers[DungeonLayer.GAS];
    return gas !== undefined && gas !== TerrainType.NOTHING;
}

export function canSeeMonster(player: Player, grid: Grid, monster: Monster): boolean {
    if (monster.hp <= 0 || monsterHidden(grid, monster)) return false;
    return !!grid.getCell(monster.loc.x, monster.loc.y)?.isVisible || monsterRevealed(player, monster);
}

export function canDirectlySeeMonster(_player: Player, grid: Grid, monster: Monster): boolean {
    return monster.hp > 0 && !monsterHidden(grid, monster)
        && !!grid.getCell(monster.loc.x, monster.loc.y)?.isVisible;
}

/** A revealed but hidden creature has a location marker, never an identity. */
export function canDisplayMonster(player: Player, grid: Grid, monster: Monster): boolean {
    return monster.hp > 0 && (canSeeMonster(player, grid, monster) || monsterRevealed(player, monster));
}
