import type { Grid } from '../Map/Grid';
import type { Player } from '../../entities/Player';
import type { Monster } from '../../entities/Monster';
import { creatureStatusRows, isSidebarVisibleStatus } from '../Status/statusConfig';
import { canSeeMonster } from './MonsterVisibility';

/** The same identity predicate used by the map and render_game_to_text. */
export function visibleMonsterRows(player: Player, grid: Grid, monsters: readonly Monster[]) {
    return monsters.filter(monster => canSeeMonster(player, grid, monster))
        .sort((a, b) =>
            Math.max(Math.abs(a.loc.x - player.loc.x), Math.abs(a.loc.y - player.loc.y))
            - Math.max(Math.abs(b.loc.x - player.loc.x), Math.abs(b.loc.y - player.loc.y)))
        .map(monster => ({
            id: monster.id,
            char: monster.char,
            name: monster.name,
            hp: monster.hp,
            maxHp: monster.maxHp,
            color: typeof monster.color === 'number' ? `#${monster.color.toString(16).padStart(6, '0')}` : monster.color,
            ally: monster.isAlly,
            statuses: creatureStatusRows(monster, isSidebarVisibleStatus),
        }));
}
