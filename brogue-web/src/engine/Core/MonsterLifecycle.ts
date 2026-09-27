import type { Monster } from '../../entities/Monster';

// Runtime ownership is deliberately outside the serialized creature graph.
// Bind on array insertion/replacement so spawns, restored floors and passengers
// all use their owning Game, including when combat has no Grid argument.
interface DeathOwner {
    monsters: Monster[];
    dormantMonsters: Monster[];
    killMonster(monster: Monster): void;
}
const owners = new WeakMap<Monster, DeathOwner>();
const lists = new WeakMap<Monster[], { raw: Monster[]; owner: DeathOwner }>();
// Like ownership, DYING is a runtime association, not an opaque Game field.
// Persisted deathProcessed carries HAS_DIED; revival explicitly clears DYING.
export const dyingMonsters = new WeakSet<Monster>();

export function ownedMonsterList(input: Monster[], owner: DeathOwner): Monster[] {
    const old = lists.get(input);
    if (old?.owner === owner) return input;
    const raw = old?.raw ?? input;
    for (const monster of raw) owners.set(monster, owner);
    const list = new Proxy(raw, {
        set(target, key, value, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) owners.set(value, owner);
            return Reflect.set(target, key, value, receiver);
        },
    });
    lists.set(list, { raw, owner });
    return list;
}

export function notifyMonsterDeath(monster: Monster): void {
    const owner = owners.get(monster);
    if (owner && (owner.monsters.includes(monster) || owner.dormantMonsters.includes(monster))) {
        owner.killMonster(monster);
    }
}
