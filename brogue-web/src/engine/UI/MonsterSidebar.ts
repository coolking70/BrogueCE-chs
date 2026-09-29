import { getTerrainDescription, type TerrainTextOptions } from './TerrainTextCatalog';
import i18next from 'i18next';
import { TerrainType, type Grid, type Cell } from '../Map/Grid';
import { TERRAIN_FLAGS, TM_ALLOWS_SUBMERGING, TM_LIST_IN_SIDEBAR } from '../Map/TerrainCatalog';
import { terrainAppearance } from './Appearance';
import type { Player } from '../../entities/Player';
import { MonsterState, type Monster } from '../../entities/Monster';
import type { Item } from '../Items/Item';
import type { Pos } from '../../types';
import { ItemLoader } from '../Items/ItemLoader';
import { playerDefense, strengthModifier } from '../Combat/CombatFormulas';
import { creatureStatusRows, isSidebarVisibleStatus } from '../Status/statusConfig';
import { canSeeMonster } from './MonsterVisibility';

const colorString = (color: string | number) => typeof color === 'number'
    ? `#${color.toString(16).padStart(6, '0')}` : color;
const sameLocation = (a: Pos, b: Pos | null) => !!b && a.x === b.x && a.y === b.y;
const distanceSquared = (a: Pos, b: Pos) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
// isVisible includes clairvoyance in this engine (Game.updateVision).
const directlyVisible = (cell: Cell | null) => !!cell?.isVisible && !cell.isClairvoyantVisible;
const seeOrSense = (cell: Cell | null) => !!cell && (cell.isVisible || cell.isClairvoyantVisible);

/** CE IO.c:4893-4923 priority; no AI/status mutation or cosmetic RNG. */
export function monsterBehaviorLabel(player: Player, grid: Grid, monster: Monster): string {
    if (player.hasStatus('hallucinating') || monster.hasBehavior('MONST_INANIMATE')) return '';
    if (monster.isCaged) return i18next.t('sidebar.behavior.captive', { defaultValue: '(Captive)' });
    if (monster.hasBehavior('MONST_RESTRICTED_TO_LIQUID')
        && !grid.getCell(monster.x, monster.y)?.layers.some(t => TERRAIN_FLAGS[t].mechFlags & TM_ALLOWS_SUBMERGING)) {
        return i18next.t('sidebar.behavior.helpless', { defaultValue: '(Helpless)' });
    }
    if (monster.state === MonsterState.ASLEEP) return i18next.t('sidebar.behavior.sleeping', { defaultValue: '(Sleeping)' });
    // isAlly is web's separate carrier of CE MONSTER_ALLY (state may remain WANDERING).
    if (monster.isAlly) return i18next.t('sidebar.behavior.ally', { defaultValue: '(Ally)' });
    if (monster.state === MonsterState.FLEEING) return i18next.t('sidebar.behavior.fleeing', { defaultValue: '(Fleeing)' });
    if (monster.state === MonsterState.WANDERING) {
        if (monster.leader?.hasBehavior('MONST_IMMOBILE')) return i18next.t('sidebar.behavior.worshiping', { defaultValue: '(Worshiping)' });
        if (monster.leader?.isCaged) return i18next.t('sidebar.behavior.guarding', { defaultValue: '(Guarding)' });
        return i18next.t('sidebar.behavior.wandering', { defaultValue: '(Wandering)' });
    }
    if (monster.ticksUntilTurn > Math.max(0, player.ticksUntilTurn) + player.movementSpeed) {
        return i18next.t('sidebar.behavior.off_balance', { defaultValue: '(Off balance)' });
    }
    if (monster.state === MonsterState.HUNTING) return i18next.t('sidebar.behavior.hunting', { defaultValue: '(Hunting)' });
    return '';
}

/** Shared identity gate, with CE sidebar exclusions and direct/sensed distance ordering. */
export function visibleMonsterRows(player: Player, grid: Grid, monsters: readonly Monster[]) {
    return monsters.filter(monster => canSeeMonster(player, grid, monster)
        && !monster.hasBehavior('MONST_NOT_LISTED_IN_SIDEBAR'))
        .sort((a, b) => Number(directlyVisible(grid.getCell(b.x, b.y))) - Number(directlyVisible(grid.getCell(a.x, a.y)))
            || distanceSquared(a.loc, player.loc) - distanceSquared(b.loc, player.loc))
        .map(monster => ({
            kind: 'monster' as const,
            id: monster.id,
            loc: { ...monster.loc },
            direct: directlyVisible(grid.getCell(monster.x, monster.y)),
            focused: false,
            char: monster.char,
            name: monster.name,
            hp: monster.hp,
            maxHp: monster.maxHp,
            color: colorString(monster.color),
            ally: monster.isAlly,
            behavior: monsterBehaviorLabel(player, grid, monster),
            negated: monster.displaysNegation && !player.hasStatus('hallucinating'),
            statuses: player.hasStatus('hallucinating') ? [] : creatureStatusRows(monster, isSidebarVisibleStatus),
        }));
}

type MonsterRow = ReturnType<typeof visibleMonsterRows>[number];
type OtherRow = {
    kind: 'item' | 'terrain'; id: number | string; loc: Pos; direct: boolean;
    focused: boolean; char: string; name: string; color: string;
};
export type SidebarEntityRow = MonsterRow | OtherRow;

/** Player's stats card precedes these rows. CE IO.c:3797-3890 uses one row per
 * location, except for the item at the player's feet. Each vision pass groups
 * monsters, items, then terrain; X3-E01 specifies squared Euclidean distance. */
export function sidebarEntityRows(player: Player, grid: Grid, monsters: readonly Monster[],
    items: readonly Item[], focus: Pos | null = null, depth?: number): SidebarEntityRow[] {
    const monsterRows = visibleMonsterRows(player, grid, monsters);
    const itemRow = (item: Item): OtherRow => ({ kind: 'item', id: item.id, loc: { ...item.loc },
        direct: directlyVisible(grid.getCell(item.x, item.y)), focused: sameLocation(item.loc, focus),
        char: item.char, name: item.displayName, color: colorString(item.color) });
    const itemRows = items.filter(item => seeOrSense(grid.getCell(item.x, item.y))).map(itemRow);
    const terrainRows: OtherRow[] = [];
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) {
        const cell = grid.getCell(x, y)!;
        if (!seeOrSense(cell)) continue;
        const terrain = cell.layers.find(t => TERRAIN_FLAGS[t].mechFlags & TM_LIST_IN_SIDEBAR);
        if (terrain === undefined) continue;
        const visual = terrainAppearance(terrain, true);
        terrainRows.push({ kind: 'terrain', id: `${x},${y}`, loc: { x, y },
            direct: directlyVisible(cell), focused: sameLocation(cell, focus),
            char: visual.char, color: visual.color, name: sidebarTerrainName(terrain, { atDungeonExit: depth === 1 }) });
    }
    const rows: SidebarEntityRow[] = [];
    const added = new Set([`${player.x},${player.y}`]);
    const underfoot = items.find(item => sameLocation(item.loc, player.loc));
    if (underfoot) rows.push(itemRow(underfoot));
    const add = (row: SidebarEntityRow) => {
        const key = `${row.loc.x},${row.loc.y}`;
        if (added.has(key)) return;
        added.add(key);
        rows.push({ ...row, focused: sameLocation(row.loc, focus) });
    };
    const groups = [monsterRows, itemRows, terrainRows];
    // Focus uses creature > item > terrain precedence and cannot reveal unknown cells.
    const focused = groups.flat().find(row => sameLocation(row.loc, focus));
    if (focused) add(focused);
    for (const direct of [true, false]) for (const group of groups) {
        group.filter(row => row.direct === direct)
            .sort((a, b) => distanceSquared(a.loc, player.loc) - distanceSquared(b.loc, player.loc))
            .forEach(add);
    }
    return rows;
}

/** CE IO.c:4636/4840-4887, Items.c:3909-3923. Never read an unknown armor's
 * rolled defense/enchantment: use the public kind's unenchanted estimate. */
export function sidebarPlayerStats(player: Player, gold: number, stealthRange: number) {
    const armor = player.equippedArmor;
    const donning = player.getStatusDuration('donning');
    let armorValue = '0';
    if (armor?.isIdentified) {
        armorValue = String(Math.trunc(playerDefense(armor.armor ?? 0, armor.enchantment,
            player.effectiveStrength, armor.strengthRequired ?? 0, donning) / 10));
    } else if (armor) {
        const kind = ItemLoader.armors.find(kind => kind.id === armor.identityId);
        armorValue = kind ? `${Math.max(0, Math.trunc(kind.armor
            + strengthModifier(player.effectiveStrength, armor.strengthRequired ?? kind.strengthRequired)) - donning)}?` : '?';
    }
    return { strength: player.effectiveStrength, maxStrength: player.strength, armor: armorValue, gold, stealthRange };
}

/** Only TM_LIST_IN_SIDEBAR tiles; names reuse the existing localized terrain vocabulary. */
export function sidebarTerrainName(terrain: TerrainType, options: TerrainTextOptions = {}): string {
    return getTerrainDescription(terrain, options);
}
