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
    items: readonly Item[], focus: Pos | null = null): SidebarEntityRow[] {
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
            char: visual.char, color: visual.color, name: sidebarTerrainName(terrain) });
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
export function sidebarTerrainName(terrain: TerrainType): string {
    switch (terrain) {
        case TerrainType.MACHINE_PRESSURE_PLATE_USED: return i18next.t('terrain.pressure_plate_used', { defaultValue: 'An inactive pressure plate' });
        case TerrainType.WALL_LEVER: return i18next.t('terrain.wall_lever', { defaultValue: 'A lever' });
        case TerrainType.STAIRS_UP: return i18next.t('terrain.stairs_up', { defaultValue: 'the upward staircase' });
        case TerrainType.STAIRS_DOWN: return i18next.t('terrain.stairs_down', { defaultValue: 'the downward staircase' });
        case TerrainType.DUNGEON_PORTAL: return i18next.t('terrain.crystal_portal', { defaultValue: 'a crystal portal' });
        case TerrainType.TRAP: return i18next.t('terrain.trap', { defaultValue: 'a trap' });
        case TerrainType.PRESSURE_PLATE: return i18next.t('terrain.pressure_plate', { defaultValue: 'a pressure plate' });
        case TerrainType.LOCKED_DOOR: return i18next.t('terrain.locked_door', { defaultValue: 'a locked door' });
        case TerrainType.ALTAR: return i18next.t('terrain.altar', { defaultValue: 'an altar' });
        case TerrainType.PORTCULLIS_CLOSED: return i18next.t('sidebar.terrain.portcullis', { defaultValue: 'a heavy portcullis' });
        case TerrainType.GAS_TRAP_PARALYSIS: return i18next.t('sidebar.terrain.paralysis_trigger', { defaultValue: 'a paralysis trigger' });
        case TerrainType.ALTAR_CAGE_OPEN: return i18next.t('sidebar.terrain.candle_altar', { defaultValue: 'a candle-lit altar' });
        case TerrainType.ALTAR_CAGE_RETRACTABLE: return i18next.t('sidebar.terrain.cage', { defaultValue: 'an iron cage' });
        case TerrainType.COMMUTATION_ALTAR: return i18next.t('terrain.commutation_altar', { defaultValue: 'a commutation altar' });
        case TerrainType.RESURRECTION_ALTAR: return i18next.t('terrain.resurrection_altar', { defaultValue: 'a resurrection altar' });
        case TerrainType.ALTAR_SWITCH: return i18next.t('sidebar.terrain.candle_altar', { defaultValue: 'a candle-lit altar' });
        case TerrainType.MONSTER_CAGE_CLOSED: return i18next.t('sidebar.terrain.locked_cage', { defaultValue: 'a locked iron cage' });
        case TerrainType.COFFIN_CLOSED: return i18next.t('sidebar.terrain.coffin_closed', { defaultValue: 'a sealed coffin' });
        case TerrainType.ALTAR_KEYHOLE: return i18next.t('sidebar.terrain.candle_altar', { defaultValue: 'a candle-lit altar' });
        case TerrainType.ALTAR_SWITCH_RETRACTING: return i18next.t('sidebar.terrain.candle_altar', { defaultValue: 'a candle-lit altar' });
        case TerrainType.BRAZIER: return i18next.t('sidebar.terrain.brazier', { defaultValue: 'a ceremonial brazier' });
        case TerrainType.PORTAL: return i18next.t('sidebar.terrain.portal', { defaultValue: 'a stone archway' });
        case TerrainType.SACRIFICE_ALTAR_DORMANT: return i18next.t('terrain.sacrifice_dormant', { defaultValue: 'a dormant sacrificial altar' });
        case TerrainType.SACRIFICE_CAGE_DORMANT: return i18next.t('sidebar.terrain.cage', { defaultValue: 'an iron cage' });
        case TerrainType.BLOODFLOWER_STALK: return i18next.t('sidebar.terrain.bloodwort_stalk', { defaultValue: 'a bloodwort stalk' });
        case TerrainType.FLOOD_TRAP: return i18next.t('sidebar.terrain.flood_trap', { defaultValue: 'a flood trap' });
        case TerrainType.ELECTRIC_CRYSTAL_OFF: return i18next.t('sidebar.terrain.crystal_off', { defaultValue: 'a darkened crystal globe' });
        case TerrainType.TURRET_LEVER: return i18next.t('sidebar.terrain.lever', { defaultValue: 'a lever' });
        case TerrainType.ELECTRIC_CRYSTAL_ON: return i18next.t('sidebar.terrain.crystal_on', { defaultValue: 'a shining crystal globe' });
        case TerrainType.MACHINE_METHANE_VENT_DORMANT: return i18next.t('terrain.inactive_gas_vent', { defaultValue: 'An inactive gas vent' });
        case TerrainType.MACHINE_METHANE_VENT: return i18next.t('terrain.gas_vent', { defaultValue: 'A gas vent' });
        case TerrainType.PILOT_LIGHT: return i18next.t('terrain.fallen_torch', { defaultValue: 'A fallen torch' });
        case TerrainType.MACHINE_PARALYSIS_VENT: return i18next.t('terrain.inactive_gas_vent', { defaultValue: 'An inactive gas vent' });
        case TerrainType.MACHINE_POISON_GAS_VENT_DORMANT: return i18next.t('terrain.inactive_gas_vent', { defaultValue: 'An inactive gas vent' });
        case TerrainType.MACHINE_POISON_GAS_VENT: return i18next.t('terrain.gas_vent', { defaultValue: 'A gas vent' });
        case TerrainType.GAS_TRAP_POISON: return i18next.t('terrain.poison_gas_trap', { defaultValue: 'A caustic gas trap' });
        case TerrainType.FLAMETHROWER: return i18next.t('terrain.fire_trap', { defaultValue: 'A fire trap' });
        case TerrainType.ALTAR_CAGE_CLOSED: return i18next.t('terrain.altar_cage_closed', { defaultValue: 'an iron cage altar' });
        case TerrainType.COMMUTATION_ALTAR_INERT: return i18next.t('terrain.commutation_inert', { defaultValue: 'a burnt commutation altar' });
        case TerrainType.RESURRECTION_ALTAR_INERT: return i18next.t('terrain.resurrection_inert', { defaultValue: 'a burnt resurrection altar' });
        case TerrainType.SACRIFICE_ALTAR: return i18next.t('terrain.sacrifice_altar', { defaultValue: 'a sacrificial altar' });
        case TerrainType.SACRIFICE_LAVA: return i18next.t('terrain.sacrifice_lava', { defaultValue: 'a sacrificial lava pit' });
        case TerrainType.RAT_TRAP_WALL_CRACKING: return i18next.t('terrain.rat_trap_wall_cracking', { defaultValue: 'a cracking wall' });
        case TerrainType.STATUE_CRACKING: return i18next.t('terrain.statue_cracking', { defaultValue: 'a cracking statue' });
        case TerrainType.COFFIN_OPEN: return i18next.t('terrain.coffin_open', { defaultValue: 'an empty coffin' });
        case TerrainType.NET_TRAP: return i18next.t('terrain.net_trap', { defaultValue: "a net trap" });
        case TerrainType.ALARM_TRAP: return i18next.t('terrain.alarm_trap', { defaultValue: "an alarm trap" });
        case TerrainType.GAS_TRAP_CONFUSION: return i18next.t('terrain.gas_trap_confusion', { defaultValue: "a confusion trap" });
        case TerrainType.STEAM_VENT: return i18next.t('terrain.steam_vent', { defaultValue: "a steam vent" });
        case TerrainType.DEWAR_CAUSTIC_GAS: return i18next.t('terrain.dewar_caustic_gas', { defaultValue: "a glass dewar of caustic gas" });
        case TerrainType.DEWAR_CONFUSION_GAS: return i18next.t('terrain.dewar_confusion_gas', { defaultValue: "a glass dewar of confusion gas" });
        case TerrainType.DEWAR_PARALYSIS_GAS: return i18next.t('terrain.dewar_paralysis_gas', { defaultValue: "a glass dewar of paralytic gas" });
        case TerrainType.DEWAR_METHANE_GAS: return i18next.t('terrain.dewar_methane_gas', { defaultValue: "a glass dewar of methane gas" });
        default: return i18next.t('terrain.floor', { defaultValue: 'the floor' });
    }
}
