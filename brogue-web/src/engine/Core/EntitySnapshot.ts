/** U01: explicit instance contract. These lists are audited against declarations
 * and live own properties in u_01_instance_snapshot.test.ts. No catalog inference
 * or legacy defaults: optional values retain their actual undefined semantics. */
import { Item } from '../Items/Item';
import { Creature, type StatusId } from '../../entities/Creature';
import { Monster, type MonsterData, type MonsterAbility } from '../../entities/Monster';
import { Player, type HungerState } from '../../entities/Player';

export const ITEM_FIELDS = [
    'id', 'name', 'char', 'color', 'loc', 'category', 'weight', 'quantity',
    'damage', 'clumping', 'armor', 'strengthRequired', 'flags', 'isCursed', 'isProtected',
    'enchantment', 'runicType', 'runicKnown', 'arcanaInstanceVersion', 'maxCharges',
    'charges', 'identified', 'canBeIdentified', 'maxChargesKnown', 'magicDetected',
    'timesUsed', 'staffRechargeRemaining', 'rechargeTurns', 'rechargeCounter',
    'cooldownTurns', 'cooldownRemaining', 'quiverNumber', 'vorpalEnemy', 'keyLoc',
    'originDepth', 'identityId', 'consumableId', 'description',
] as const satisfies readonly (keyof Item)[];
export const CREATURE_FIELDS = [
    'id', 'loc', 'hp', 'maxHp', 'name', 'color', 'char', 'statusDurations',
    'poisonAmount', 'weaknessAmount', 'maxStatus', 'maxShield', 'ticksUntilTurn', 'seized', 'seizing',
    'movementSpeed', 'attackSpeed',
] as const satisfies readonly (keyof Creature)[];
export const MONSTER_FIELDS = [
    ...CREATURE_FIELDS, 'state', 'damageString', 'damageClumping', 'goldDropChance', 'itemDropChance',
    'onHitStatus', 'onHitChance', 'onHitDuration', 'statusResistTurns', 'isAlly',
    'dominated', 'boundToLeader', 'isCaged', 'mutation', 'polymorphed', 'isClone',
    'wasNegated', 'newPowerCount', 'totalPowerCount', 'polymorphKeepsSpeed',
    'targetCorpseLoc', 'targetCorpseName', 'corpseAbsorptionCounter',
    'absorptionFlags', 'absorbBehavior', 'absorptionBolt', 'isAbsorbing',
    'description', 'deathEffectTriggered', 'bolts', 'typeId', 'boundToPlayer',
    'doesNotTrackLeader', 'givenUpOnScent', 'safetySnapshot', 'falling', 'preplaced',
    'isDormant', 'machineHome', 'targetWaypointIndex', 'waypointAlreadyVisited',
    'regenTurns', 'accuracy', 'defense', 'regenCounter', 'spawnLoc',
] as const satisfies readonly (keyof Monster)[];
export const PLAYER_FIELDS = [
    ...CREATURE_FIELDS, 'strength', 'lastMoveDirection', 'nutrition', 'maxNutrition',
    'hungerState', 'regenCarry', 'temporaryImmunities',
] as const satisfies readonly (keyof Player)[];

// Copy only registered fields, including optional undefined fields on restore.
// Copy JSON-like containers explicitly so Vue reactive proxies work as well;
// structuredClone cannot clone a Proxy. Sets and entity edges have explicit codecs.
function copyValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(v => copyValue(v)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, copyValue(v)])) as T;
    return value;
}
export function copyFields<T, K extends keyof T>(source: T, fields: readonly K[]): Pick<T, K> {
    return Object.fromEntries(fields.map(key => [key, copyValue(source[key])])) as Pick<T, K>;
}
export type GameSnapshotItem = Pick<Item, typeof ITEM_FIELDS[number]>;
export type GameSnapshotMonster = Pick<Monster, typeof MONSTER_FIELDS[number]> & {
    form: MonsterData;
    statusImmunities: StatusId[];
    abilities: MonsterAbility[];
    behaviorFlags: string[];
    abilityFlags: string[];
    leaderId: number | null;
    carriedItemId: number | null | undefined;
    carriedMonsterId: number | null;
    /** Standalone test-room snapshots carry their reachable detached graph. */
    graph?: EntitySnapshotGraph;
};
export interface EntitySnapshotGraph {
    monsters: GameSnapshotMonster[];
    items: GameSnapshotItem[];
}
export type GameSnapshotPlayer = Pick<Player, typeof PLAYER_FIELDS[number]> & {
    statusImmunities: StatusId[];
    hungerTransition: HungerState | null;
    inventoryCapacity: number;
    inventory: GameSnapshotItem[];
    equippedWeaponId: number | null;
    equippedArmorId: number | null;
    ringLeftId: number | null;
    ringRightId: number | null;
};

export function serializeItem(item: Item): GameSnapshotItem { return copyFields(item, ITEM_FIELDS); }
export function deserializeItem(saved: GameSnapshotItem): Item {
    return Object.assign(Object.create(Item.prototype) as Item, copyFields(saved, ITEM_FIELDS));
}
export function serializeMonsterRow(m: Monster): GameSnapshotMonster {
    return { ...copyFields(m, MONSTER_FIELDS), form: m.snapshotForm(),
        statusImmunities: [...m.statusImmunities], abilities: [...m.abilities],
        behaviorFlags: [...m.behaviorFlags], abilityFlags: [...m.abilityFlags],
        leaderId: m.leader?.id ?? null,
        carriedItemId: m.carriedItem === undefined ? undefined : m.carriedItem?.id ?? null,
        carriedMonsterId: m.carriedMonster?.id ?? null };
}

/** Visit references once, before encoding: cycles and shared payload identity
 * must not become recursion or duplicate instances. machineHome is a grid
 * machine ID (a scalar), not a Monster pointer. */
export function collectEntityGraph(roots: readonly Monster[], items: readonly Item[] = []): { monsters: Monster[]; items: Item[] } {
    const monsters = new Set<Monster>(), allItems = new Set(items);
    const visit = (m: Monster): void => {
        if (monsters.has(m)) return;
        monsters.add(m);
        if (m.carriedItem) allItems.add(m.carriedItem);
        if (m.carriedMonster) visit(m.carriedMonster);
        if (m.leader) visit(m.leader);
    };
    roots.forEach(visit);
    return { monsters: [...monsters], items: [...allItems] };
}
export function serializeMonster(m: Monster): GameSnapshotMonster {
    const graph = collectEntityGraph([m]);
    return { ...serializeMonsterRow(m), graph: {
        monsters: graph.monsters.filter(v => v !== m).map(serializeMonsterRow),
        items: graph.items.map(serializeItem),
    } };
}

/** Phase 1: allocate ALL entities. Phase 2: resolve ALL pointers by ID. */
export function restoreEntityGraph(rows: readonly GameSnapshotMonster[], itemRows: readonly GameSnapshotItem[] = [],
    existingMonsters: readonly Monster[] = [], existingItems: readonly Item[] = []): { monsters: Map<number, Monster>; items: Map<number, Item> } {
    const saved = new Map<number, GameSnapshotMonster>();
    const items = new Map(existingItems.map(i => [i.id, i]));
    const read = (row: GameSnapshotMonster): void => {
        if (saved.has(row.id)) return;
        saved.set(row.id, row);
        row.graph?.items.forEach(i => { if (!items.has(i.id)) items.set(i.id, deserializeItem(i)); });
        row.graph?.monsters.forEach(read);
    };
    itemRows.forEach(i => { if (!items.has(i.id)) items.set(i.id, deserializeItem(i)); });
    rows.forEach(read);
    const monsters = new Map(existingMonsters.map(m => [m.id, m]));
    for (const s of saved.values()) {
        if (monsters.has(s.id)) continue;
        const m = Object.assign(Monster.allocateForSnapshot(s.form), copyFields(s, MONSTER_FIELDS));
        m.statusImmunities = new Set(s.statusImmunities);
        m.abilities = new Set(s.abilities);
        m.behaviorFlags = new Set(s.behaviorFlags);
        m.abilityFlags = new Set(s.abilityFlags);
        monsters.set(m.id, m);
    }
    const resolve = <T>(map: Map<number, T>, id: number): T => {
        const value = map.get(id);
        if (!value) throw new Error(`Missing snapshot entity ${id}`);
        return value;
    };
    for (const s of saved.values()) {
        const m = monsters.get(s.id)!;
        m.leader = s.leaderId === null ? null : resolve(monsters, s.leaderId);
        m.carriedMonster = s.carriedMonsterId === null ? null : resolve(monsters, s.carriedMonsterId);
        m.carriedItem = s.carriedItemId == null ? s.carriedItemId : resolve(items, s.carriedItemId);
    }
    return { monsters, items };
}
