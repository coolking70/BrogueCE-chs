/** CE Monsters.c:1591–1827. Allegiance is separate from creatureState in web. */
import { Monster, MonsterMode, MonsterState, monstersAreEnemies, monstersAreTeammates } from '../../entities/Monster';
import { Player } from '../../entities/Player';
import type { Creature } from '../../entities/Creature';
import type { Game } from '../Core/Game';
import { ScentMap } from '../Map/Scent';
import { blinkTraversiblePath, openCreaturePath, playerTraversiblePath } from './MonsterBlink';

const distance = (a: Creature, b: Creature) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const allyState = (m: Monster) => m.isAlly && m.state !== MonsterState.FLEEING;
const immobile = (m: Monster) => m.hasBehavior('MONST_IMMOBILE') || m.hasBehavior('MONST_TURRET');

export function alertMonster(g: Game, m: Monster): void {
    m.state = m.creatureMode === MonsterMode.PERM_FLEEING ? MonsterState.FLEEING : MonsterState.HUNTING;
    m.lastSeenPlayerAt = { ...g.player.loc };
}

export function wakeMonster(g: Game, m: Monster, stealthRange: number): void {
    if (!allyState(m)) alertMonster(g, m);
    m.ticksUntilTurn = 100;
    for (const mate of g.monsters) {
        if (mate.hp <= 0 || mate === m || !monstersAreTeammates(m, mate) || mate.creatureMode !== MonsterMode.NORMAL) continue;
        if (!allyState(mate) && (mate.state === MonsterState.ASLEEP || mate.state === MonsterState.WANDERING)) {
            mate.ticksUntilTurn = Math.max(100, mate.ticksUntilTurn);
        }
        if (!allyState(m)) {
            mate.state = MonsterState.HUNTING;
            updateMonsterState(g, mate, stealthRange);
        }
    }
}

export function wanderTowardLastSeen(g: Game, m: Monster): void {
    const p = m.lastSeenPlayerAt;
    if (!p || !g.grid.isValidPos(p.x, p.y)) return;
    let best = 1000, index = -1;
    for (let i = 0; i < g.waypoints.count; i++) {
        const d = g.waypoints.distanceMaps[i]?.[p.x]?.[p.y] ?? 30000;
        if (d < best) { best = d; index = i; }
    }
    if (index >= 0) {
        // CE wanderToward consumes no RNG. Web defers spawn-time waypoint
        // initialization until actual wandering; retain that existing boundary.
        if (m.waypointAlreadyVisited) m.waypointAlreadyVisited[index] = false;
        m.targetWaypointIndex = index;
    }
}

/** Fear is of an attacking enemy, including discord and lethal poison. */
export function monsterFleesFrom(m: Monster, target: Creature): boolean {
    if (target === m || m.hp <= 0 || distance(m, target) >= 4) return false;
    // CE monsterWillAttackTarget(target, m), in its original priority order.
    let attacks: boolean;
    if (target instanceof Player && allyState(m)) attacks = m.hasStatus('discordant');
    else if (target.hasStatus('entranced') && !allyState(m)) attacks = true;
    else if (target instanceof Monster && allyState(target) && m.hasStatus('entranced')) attacks = false;
    else if (m.isCaged) attacks = false;
    else if (target.hasStatus('discordant') || m.hasStatus('discordant') || target.hasStatus('confused')) attacks = true;
    else attacks = monstersAreEnemies(target, m) && !monstersAreTeammates(target, m);
    if (!attacks) return false;
    if (target instanceof Monster && (target.isInvulnerable() || target.isImmuneToWeapons()) && !immobile(target)) return true;
    if (allyState(m) && !m.hasStatus('discordant') && target instanceof Monster && target.markedForSacrifice) return true;
    return m.hasBehavior('MONST_MAINTAINS_DISTANCE')
        || (target instanceof Monster && target.hasAbility('MA_KAMIKAZE'))
        || (m.hasAbility('MA_POISONS') && target.getStatusDuration('poisoned') * target.poisonAmount > target.hp);
}

export function updateMonsterState(g: Game, m: Monster, stealthRange: number): void {
    if (m.hasBehavior('MONST_ALWAYS_HUNTING') && !allyState(m)) {
        m.state = MonsterState.HUNTING;
        return;
    }
    const scent = g.scent ??= new ScentMap(g.grid.width, g.grid.height);
    const aware = scent.awareOfTarget(g.grid, m.x, m.y, g.player.x, g.player.y, {
        alwaysHunting: m.hasBehavior('MONST_ALWAYS_HUNTING'), immobile: immobile(m),
        tracking: !allyState(m) && m.state === MonsterState.HUNTING, stealthRange,
    });
    if (immobile(m) && !allyState(m)) {
        m.state = aware ? MonsterState.HUNTING : MonsterState.ASLEEP;
        return;
    }
    if (!allyState(m) && m.creatureMode === MonsterMode.PERM_FLEEING
        && (m.state === MonsterState.WANDERING || m.state === MonsterState.HUNTING)) m.state = MonsterState.FLEEING;

    let closest = g.grid.width + g.grid.height;
    for (const target of [g.player, ...g.monsters]) {
        if (!monsterFleesFrom(m, target) || distance(m, target) >= closest) continue;
        // CE tests traversibility from the feared enemy, then an open sight path.
        const traversible = target instanceof Monster ? blinkTraversiblePath(g, target, m.loc)
            : playerTraversiblePath(g, target as Player, m.loc);
        if (traversible && openCreaturePath(g, m, target.loc)) closest = distance(m, target);
    }
    if (!allyState(m) && m.state === MonsterState.WANDERING && aware && g.grid.getCell(g.player.x, g.player.y)?.isVisible) {
        alertMonster(g, m);
    } else if (!allyState(m) && m.state === MonsterState.ASLEEP) {
        if (aware) wakeMonster(g, m, stealthRange);
    } else if (!allyState(m) && m.state === MonsterState.HUNTING && !aware) {
        m.state = MonsterState.WANDERING;
        wanderTowardLastSeen(g, m);
    } else if (!allyState(m) && m.state === MonsterState.HUNTING && closest < 3) {
        m.state = MonsterState.FLEEING;
    } else if (!allyState(m) && m.hasBehavior('MONST_FLEES_NEAR_DEATH') && m.hp <= Math.trunc(3 * m.maxHp / 4)) {
        if (m.state === MonsterState.FLEEING || m.hp <= Math.trunc(m.maxHp / 4)) m.state = MonsterState.FLEEING;
    } else if (m.creatureMode === MonsterMode.NORMAL && m.state === MonsterState.FLEEING && !m.hasStatus('magical_fear') && closest >= 3) {
        m.state = MonsterState.HUNTING;
    } else if (m.creatureMode === MonsterMode.PERM_FLEEING && m.state === MonsterState.FLEEING
        && m.hasAbility('MA_HIT_STEAL_FLEE') && !m.hasStatus('magical_fear') && !m.carriedItem) {
        m.creatureMode = MonsterMode.NORMAL;
        if (m.isAlly || m.leader instanceof Player) { m.isAlly = true; m.state = MonsterState.WANDERING; }
        else alertMonster(g, m);
    } else if (m.creatureMode === MonsterMode.NORMAL && m.state === MonsterState.FLEEING
        && m.hasBehavior('MONST_FLEES_NEAR_DEATH') && !m.hasStatus('magical_fear') && m.hp >= Math.trunc(3 * m.maxHp / 4)) {
        if (m.isAlly || m.leader instanceof Player) { m.isAlly = true; m.state = MonsterState.WANDERING; }
        else alertMonster(g, m);
    }
    if (aware && !allyState(m) && (m.state === MonsterState.FLEEING || m.state === MonsterState.HUNTING)) m.lastSeenPlayerAt = { ...g.player.loc };
}
