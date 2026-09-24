/** U07: monster-only decisions. CE Monsters.c:1313,2098,2299,3049,3430.
 * No player targeting, item resource, generation or learning policy lives here.
 */
import type { Game } from '../Core/Game';
import { Monster, MonsterState, monstersAreEnemies, monstersAreTeammates } from '../../entities/Monster';
import type { Creature } from '../../entities/Creature';
import type { Pos } from '../../types';
import { DungeonLayer, TerrainType } from '../Map/Grid';
import { cellTerrainFlags, cellTerrainMechFlags, discoveredTerrainFlagsOfCell, burnedTerrainFlagsOfCell } from '../Map/DungeonFeature';
import * as T from '../Map/TerrainCatalog';
import { terrainBlocksMovement, terrainPassableOrSecretDoor, genericPathCost } from '../Map/TerrainRules';
import { allocShortGrid, getSafetyMapForMonster } from '../Map/SafetyMap';
import { DijkstraMap } from '../Map/Pathfinding';
import { teleportForbiddenFlags } from '../Movement/CreaturePlacement';
import { BoltEffect, MONSTER_BOLT_TABLE, type BoltConfig } from './Bolt';
import { CEBoltType } from './BoltCatalog';
import { boltLine, staffBlinkDistance, type BoltWorld } from './BoltTrajectory';
import { perimeterCoords } from './BoltReflection';
import { rng } from '../Random';
import { CombatSystem } from './Combat';
import { monsterDamageAdjustmentAmount } from './CombatFormulas';
import { entrancementDiagonalBlocked } from '../Movement/Entrancement';

export const MONSTER_BLINK: BoltConfig = { id: 'monster_blink', name: 'BLINKING', ceType: CEBoltType.BLINKING,
    effect: BoltEffect.BLINKING, magnitude: 5, char: '*', color: 0xffcc66,
    maxRange: 0, piercing: false, selfTargeting: false };
const sight: BoltConfig = { ...MONSTER_BLINK, ceType: CEBoltType.NONE, effect: BoltEffect.NONE };
const distance = (a: Pos, b: Pos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const flags = (g: Game, p: Pos) => cellTerrainFlags(g.grid, p.x, p.y);
const at = (g: Game, p: Pos): Creature | undefined => g.player.hp > 0 && distance(g.player.loc, p) === 0
    ? g.player : g.getMonsterAt(p.x, p.y);
const alliedState = (m: Monster) => m.isAlly && m.state !== MonsterState.FLEEING && !m.hasStatus('magical_fear');
const flying = (m: Creature) => m.hasStatus('levitating') || m.hasStatus('flying');
export const hasBlink = (m: Monster) => m.bolts.some(b => MONSTER_BOLT_TABLE[b]?.effect === BoltEffect.BLINKING);
export const blinkChance = (m: Monster) => hasBlink(m) && (m.hasBehavior('MONST_ALWAYS_USE_ABILITY') || rng.randPercent(30));

function futile(g: Game, m: Monster, target: Creature): boolean {
    return !!((flags(g, target.loc) & T.T_OBSTRUCTS_PASSABILITY)
        && !(target instanceof Monster && target.hasBehavior('MONST_ATTACKABLE_THRU_WALLS')))
        || (m.hasBehavior('MONST_RESTRICTED_TO_LIQUID') && !flying(m) && flying(target))
        || (target instanceof Monster && (target.isInvulnerable() || (target.isImmuneToWeapons() && !m.hasAbility('MA_POISONS'))));
}
function attacks(m: Monster, target: Creature): boolean {
    return target !== m && target.hp > 0 && !(target instanceof Monster && target.isCaged)
        && !(m.isAlly && target.hasStatus('entranced'))
        && (monstersAreEnemies(m, target) || m.hasStatus('confused'));
}
function permanentAvoided(m: Monster): number {
    let f = teleportForbiddenFlags(m) | T.T_HARMFUL_TERRAIN | T.T_SACRED;
    if (m.isInvulnerable()) f &= ~(T.T_HARMFUL_TERRAIN | T.T_IS_DF_TRAP);
    if (m.hasBehavior('MONST_INANIMATE')) f &= ~(T.T_CAUSES_POISON | T.T_CAUSES_DAMAGE | T.T_CAUSES_PARALYSIS | T.T_CAUSES_CONFUSION);
    if (m.hasBehavior('MONST_IMMUNE_TO_FIRE')) f &= ~T.T_IS_FIRE;
    if (m.hasBehavior('MONST_FLIES')) f &= ~T.T_CAUSES_POISON;
    return f;
}
function arcs(g: Game, p: Pos): number {
    const around = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]] as const;
    const pass = around.map(([dx,dy]) => {
        const c = g.grid.getCell(p.x + dx, p.y + dy);
        if (!c) return false;
        const f = flags(g, {x: p.x + dx, y: p.y + dy});
        return !(f & T.T_PATHING_BLOCKER) || !!((f & T.T_OBSTRUCTS_PASSABILITY)
            && (cellTerrainMechFlags(g.grid, p.x + dx, p.y + dy) & (T.TM_IS_SECRET | T.TM_PROMOTES_WITH_KEY | T.TM_CONNECTS_LEVEL)));
    });
    return pass.reduce((n, v, i) => n + (v && !pass[(i + 7) % 8] ? 1 : 0), 0);
}

/** Ordered monsterAvoids contract for blink preferences/maps. Occupancy is NOT
 * blanket rejection here: cardinal attack squares participate in the baseline.
 * Actual ray/commit owns physical obstruction and occupancy independently.
 * Unrepresented CE bookkeeping (submerged, plate depressed, enraged) stays out.
 */
export function monsterBlinkAvoids(g: Game, m: Monster, p: Pos): boolean {
    const cell = g.grid.getCell(p.x, p.y);
    if (!cell) return true;
    const f = flags(g, p), here = flags(g, m.loc), mech = cellTerrainMechFlags(g.grid, p.x, p.y);
    const defender = at(g, p);
    if (cell.layers.includes(TerrainType.STAIRS_UP) || cell.layers.includes(TerrainType.STAIRS_DOWN)) return true;
    if (m.hasBehavior('MONST_RESTRICTED_TO_LIQUID') && !(mech & T.TM_ALLOWS_SUBMERGING)) return true;
    if (defender === g.player && !alliedState(m)) return false;
    if (terrainBlocksMovement(cell)) {
        if ((mech & T.TM_IS_SECRET) && !(discoveredTerrainFlagsOfCell(cell) & permanentAvoided(m))) return false;
        return !(distance(m.loc, p) <= 1 && defender instanceof Monster && defender.hasBehavior('MONST_ATTACKABLE_THRU_WALLS'));
    }
    if (defender && distance(m.loc, p) <= 1 && attacks(m, defender)) return futile(g, m, defender);
    if (defender && monstersAreEnemies(m, defender) && futile(g, m, defender)) return true;
    let immune = 0;
    if (m.hasStatus('immune_fire')) immune |= T.T_IS_FIRE | T.T_SPONTANEOUSLY_IGNITES | T.T_LAVA_INSTA_DEATH;
    if (m.isInvulnerable()) immune |= T.T_HARMFUL_TERRAIN | T.T_ENTANGLES | T.T_SPONTANEOUSLY_IGNITES | T.T_LAVA_INSTA_DEATH;
    if (m.hasBehavior('MONST_INANIMATE')) immune |= T.T_CAUSES_DAMAGE | T.T_CAUSES_PARALYSIS | T.T_CAUSES_CONFUSION | T.T_CAUSES_NAUSEA | T.T_CAUSES_POISON;
    if (flying(m)) immune |= T.T_AUTO_DESCENT | T.T_CAUSES_POISON | T.T_IS_DEEP_WATER | T.T_IS_DF_TRAP | T.T_LAVA_INSTA_DEATH;
    if (m.hasBehavior('MONST_IMMUNE_TO_WEBS')) immune |= T.T_ENTANGLES;
    if (m.hasBehavior('MONST_IMMUNE_TO_WATER')) immune |= T.T_IS_DEEP_WATER;
    if (f & T.T_SACRED & ~immune) return true;
    if ((f & T.T_SPONTANEOUSLY_IGNITES & ~immune) && !defender && !(here & (T.T_IS_FIRE | T.T_SPONTANEOUSLY_IGNITES))
        && (alliedState(m) || (m.state !== MonsterState.HUNTING && m.state !== MonsterState.FLEEING))) return true;
    if (!alliedState(m) && m.state === MonsterState.WANDERING && m.hasBehavior('MONST_FIERY') && (f & T.T_IS_FLAMMABLE)) return true;
    if (((m.statusDurations as Record<string, number>).burning ?? 0) > 0 && (burnedTerrainFlagsOfCell(cell) & (T.T_CAUSES_EXPLOSIVE_DAMAGE | T.T_CAUSES_DAMAGE | T.T_AUTO_DESCENT) & ~immune)) return true;
    if ((f & T.T_IS_FIRE & ~immune) && !(here & T.T_IS_FIRE) && !defender) return true;
    if ((f & T.T_HARMFUL_TERRAIN & ~T.T_IS_FIRE & ~immune) && !(here & (T.T_HARMFUL_TERRAIN & ~T.T_IS_FIRE))) return true;
    const webBridge = !!(f & T.T_ENTANGLES) && m.hasBehavior('MONST_IMMUNE_TO_WEBS');
    if ((f & T.T_AUTO_DESCENT & ~immune) && !webBridge) return true;
    if ((f & T.T_IS_DF_TRAP & ~immune) && (alliedState(m) ? !(mech & T.TM_IS_SECRET) : m.state === MonsterState.WANDERING)
        && !m.hasStatus('entranced') && !webBridge) return true;
    if ((f & T.T_LAVA_INSTA_DEATH & ~immune) && !webBridge) return true;
    if ((f & T.T_IS_DEEP_WATER & ~immune) && !webBridge && !(here & T.T_IS_DEEP_WATER)) return true;
    if ((f & T.T_CAUSES_POISON & ~immune) && !(here & T.T_CAUSES_POISON) && (alliedState(m) || m.state !== MonsterState.HUNTING || m.hp < 10)) return true;
    if (m.hasAbility('MA_AVOID_CORRIDORS') && !alliedState(m) && m.state === MonsterState.HUNTING
        && (m.leader || g.monsters.some(other => other.leader === m)) && arcs(g, p) >= 2 && arcs(g, m.loc) < 2
        && !(here & T.T_HARMFUL_TERRAIN & ~immune)) return true;
    return false;
}
const world = (g: Game, m: Monster): BoltWorld => ({ caster: m, creatureAt: p => at(g, p) });
/** CE getImpactLoc ignores hidden creatures; actual zap does not. Thus a cast
 * chosen using hidden information can stop short/fail and still cost its turn. */
export function monsterBlinkImpact(g: Game, m: Monster, aim: Pos): Pos {
    let last = { ...m.loc };
    const line = boltLine(g.grid, m.loc, aim, MONSTER_BLINK, world(g, m));
    for (const p of line.slice(0, staffBlinkDistance(5))) {
        const occupant = at(g, p);
        const hidden = occupant?.hasStatus('invisible') && !g.grid.getCell(p.x, p.y)!.layers[DungeonLayer.GAS]
            && !monstersAreTeammates(m, occupant);
        if ((occupant && !hidden) || (flags(g, p) & (T.T_OBSTRUCTS_PASSABILITY | T.T_OBSTRUCTS_VISION))) break;
        last = p;
    }
    return last;
}
export interface BlinkChoice { aim: Pos; impact: Pos; preference: number }
/** Pure CE selector. The last strictly better candidate can clear gotOne;
 * do not retain a previous long jump when a later adjacent cell scores better. */
export function chooseMonsterBlink(origin: Pos, value: (p: Pos) => number, uphill: boolean,
    avoids: (p: Pos) => boolean, impactAt: (aim: Pos) => Pos, blocks: (p: Pos) => boolean): BlinkChoice | null {
    let best = value(origin), chosen: BlinkChoice | null = null, gotOne = false;
    const better = (n: number) => uphill ? n > best : n < best;
    for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]] as const) {
        const p = { x: origin.x + dx, y: origin.y + dy }, n = value(p);
        if (better(n) && !avoids(p)) best = n;
    }
    for (let i = 0; i < 40; i++) {
        const offset = perimeterCoords(i), aim = { x: origin.x + offset.x, y: origin.y + offset.y };
        const impact = impactAt(aim), n = value(impact);
        if (!better(n) || avoids(impact)) continue;
        best = n; chosen = { aim, impact, preference: n };
        gotOne = distance(origin, impact) > 1 || blocks({ x: impact.x, y: origin.y }) || blocks({ x: origin.x, y: impact.y });
    }
    return gotOne ? chosen : null;
}
export function monsterBlinkToPreferenceMap(g: Game, m: Monster, map: number[][] | ((p: Pos) => number), uphill: boolean): boolean {
    if (!hasBlink(m)) return false;
    const value = typeof map === 'function' ? map : (p: Pos) => map[p.x]?.[p.y] ?? (uphill ? -30000 : 30000);
    const choice = chooseMonsterBlink(m.loc, value, uphill, p => monsterBlinkAvoids(g, m, p),
        p => monsterBlinkImpact(g, m, p), p => !!(flags(g, p) & T.T_OBSTRUCTS_PASSABILITY));
    if (!choice) return false;
    m.ticksUntilTurn = m.attackSpeed * (m.hasBehavior('MONST_CAST_SPELLS_SLOWLY') ? 2 : 1);
    g.castMonsterBlink(m, choice.aim);
    return true;
}

/** New map consumers use CE negative costs without changing the shared scanner's
 * legacy positive-obstruction contract (U18a-2). Four-way scans can reuse it.
 * Enemy-map eight-way propagation must test -2 at both common neighbors. */
export function scanBlinkMap(g: Game, map: number[][], costs: number[][], diagonals = false): void {
    if (!diagonals) { new DijkstraMap(g.grid.width, g.grid.height).batchScan(map, costs, false); return; }
    // Multi-source shortest paths; sorting equal priorities is immaterial to distances.
    const queue: Pos[] = [];
    for (let x = 1; x < g.grid.width - 1; x++) for (let y = 1; y < g.grid.height - 1; y++) {
        if (costs[x]![y]! > 0 && map[x]![y]! < 30000) queue.push({ x, y });
    }
    while (queue.length) {
        queue.sort((a,b) => map[b.x]![b.y]! - map[a.x]![a.y]!);
        const p = queue.pop()!;
        for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]] as const) {
            const x = p.x + dx, y = p.y + dy;
            if (x <= 0 || y <= 0 || x >= g.grid.width - 1 || y >= g.grid.height - 1 || costs[x]![y]! <= 0) continue;
            if (dx && dy && (costs[p.x + dx]![p.y] === -2 || costs[p.x]![p.y + dy] === -2)) continue;
            const n = map[p.x]![p.y]! + costs[x]![y]!;
            if (n < map[x]![y]!) { map[x]![y] = n; if (!queue.some(q => q.x === x && q.y === y)) queue.push({ x,y }); }
        }
    }
}
export function buildBlinkSafeTerrainMap(g: Game): number[][] {
    const map = allocShortGrid(g.grid.width, g.grid.height, 30000), costs = allocShortGrid(g.grid.width, g.grid.height, 1);
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        const cell = g.grid.getCell(x,y)!, f = flags(g, { x,y }), occupant = g.getMonsterAt(x,y);
        if (!terrainPassableOrSecretDoor(cell)) costs[x]![y] = f & T.T_OBSTRUCTS_DIAGONAL_MOVEMENT ? -2 : -1;
        else if (occupant?.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION')
            || ((f & (T.T_PATHING_BLOCKER & ~T.T_HARMFUL_TERRAIN)) && !(cellTerrainMechFlags(g.grid,x,y) & T.TM_IS_SECRET))) costs[x]![y] = -1;
        else if (!(f & T.T_HARMFUL_TERRAIN) && cell.layers[DungeonLayer.DUNGEON] !== TerrainType.DOOR) map[x]![y] = 0;
    }
    scanBlinkMap(g, map, costs); return map;
}
export function buildBlinkAllySafetyMap(g: Game): number[][] {
    const map = allocShortGrid(g.grid.width,g.grid.height,30000), threatCosts = allocShortGrid(g.grid.width,g.grid.height,1), allyCosts = allocShortGrid(g.grid.width,g.grid.height,1);
    for (let x=0;x<g.grid.width;x++) for (let y=0;y<g.grid.height;y++) {
        const cell = g.grid.getCell(x,y)!, cost = genericPathCost(cell);
        threatCosts[x]![y] = allyCosts[x]![y] = cost;
        if (cost < 0) continue;
        if (flags(g,{x,y}) & T.T_SACRED) allyCosts[x]![y] = -1;
        else { const occupant = g.getMonsterAt(x,y); if (occupant && monstersAreEnemies(g.player,occupant)) { map[x]![y] = 0; allyCosts[x]![y] = -1; } }
    }
    threatCosts[g.player.x]![g.player.y] = allyCosts[g.player.x]![g.player.y] = -1;
    scanBlinkMap(g,map,threatCosts);
    for (let x=0;x<g.grid.width;x++) for (let y=0;y<g.grid.height;y++) {
        if (allyCosts[x]![y]! < 0) continue;
        const d = map[x]![y] === 30000 ? 150 : map[x]![y]!;
        map[x]![y] = -3 * Math.trunc(50 * d / (50 + d)) - (g.loopMap?.[x]?.[y] ? 10 : 0);
    }
    scanBlinkMap(g,map,allyCosts); return map;
}
export function monsterBlinkToSafety(g: Game, m: Monster): boolean {
    return monsterBlinkToPreferenceMap(g,m,alliedState(m) ? buildBlinkAllySafetyMap(g) : getSafetyMapForMonster(g,m),false);
}
export function blinkFromHarmfulTerrain(g: Game, m: Monster): boolean {
    if (!hasBlink(m)) return false;
    const f = flags(g,m.loc), gas = T.T_CAUSES_DAMAGE | T.T_CAUSES_PARALYSIS | T.T_CAUSES_CONFUSION;
    const harmful = alliedState(m)
        ? (f & T.T_HARMFUL_TERRAIN & ~(T.T_IS_FIRE | gas)) || ((f & T.T_IS_FIRE) && !m.hasStatus('immune_fire'))
            || ((f & gas) && !m.hasBehavior('MONST_INANIMATE') && !m.isInvulnerable())
        : (f & T.T_HARMFUL_TERRAIN & ~T.T_IS_FIRE) || ((f & T.T_IS_FIRE) && !m.hasStatus('immune_fire') && !m.isInvulnerable());
    return !!harmful && monsterBlinkToPreferenceMap(g,m,buildBlinkSafeTerrainMap(g),false);
}
export function blinkTraversiblePath(g: Game, m: Monster, target: Pos): boolean {
    if (distance(m.loc,target) === 0) return true;
    for (const p of boltLine(g.grid,m.loc,target,sight,world(g,m))) {
        if (distance(p,target) === 0) return true;
        if (monsterBlinkAvoids(g,m,p)) return false;
    }
    return false;
}
export function closestBlinkEnemy(g: Game, m: Monster): Monster | null {
    let closest: Monster | null = null, shortest = Math.max(g.grid.width,g.grid.height);
    for (const target of g.monsters) {
        const d = distance(m.loc,target.loc);
        if (!attacks(m,target) || d >= shortest || !blinkTraversiblePath(g,m,target.loc)
            || ((flags(g,target.loc) & T.T_OBSTRUCTS_PASSABILITY) && !target.hasBehavior('MONST_ATTACKABLE_THRU_WALLS'))
            || (target.hasStatus('invisible') && !rng.randPercent(33))) continue;
        closest = target; shortest = d;
    }
    return closest;
}
export function blinkAllyFlees(g: Game, m: Monster, target: Monster | null): boolean {
    if (!target || m.maxHp <= 1) return false;
    const d = distance(m.loc,target.loc), pct = Math.trunc(100*m.hp/m.maxHp);
    if (d < 10 && pct <= 33 && m.regenTurns > 0 && !m.carriedMonster
        && (m.hasBehavior('MONST_FLEES_NEAR_DEATH') || pct*2 < Math.trunc(100*g.player.hp/g.player.maxHp))) return true;
    return d < 4 && attacks(target,m) && (((target.isInvulnerable() || target.isImmuneToWeapons()) && !target.hasBehavior('MONST_IMMOBILE'))
        || m.hasBehavior('MONST_MAINTAINS_DISTANCE') || target.hasAbility('MA_KAMIKAZE')
        || (m.hasAbility('MA_POISONS') && target.getStatusDuration('poisoned') * target.poisonAmount > target.hp));
}
export function buildBlinkEnemyMap(g: Game, m: Monster, shortest: number): number[][] {
    const map = allocShortGrid(g.grid.width,g.grid.height,0), costs = allocShortGrid(g.grid.width,g.grid.height,1);
    for (let x=0;x<g.grid.width;x++) for (let y=0;y<g.grid.height;y++) {
        const p = {x,y}, f = flags(g,p);
        if (f & T.T_OBSTRUCTS_PASSABILITY) costs[x]![y] = f & T.T_OBSTRUCTS_DIAGONAL_MOVEMENT ? -2 : -1;
        else if (monsterBlinkAvoids(g,m,p)) costs[x]![y] = -1;
        else map[x]![y] = 10000;
    }
    for (const target of g.monsters) {
        // CE :3194 is deliberately strict < shortestDistance, NOT <=.
        if (!attacks(m,target) || distance(m.loc,target.loc) >= shortest || !blinkTraversiblePath(g,m,target.loc)
            || (monsterBlinkAvoids(g,m,target.loc) && !target.hasBehavior('MONST_ATTACKABLE_THRU_WALLS'))
            || (target.hasStatus('invisible') && !m.hasBehavior('MONST_ALWAYS_USE_ABILITY') && !rng.randPercent(33))) continue;
        map[target.x]![target.y] = 0; costs[target.x]![target.y] = 1;
    }
    scanBlinkMap(g,map,costs,true); return map;
}
/** CE calculateDistances(target,0,traveler,true,false). Rebuilt on demand in
 * web (no mapToMe cache carrier); no saved/hidden map is fabricated. */
export function buildBlinkTargetMap(g: Game, m: Monster, target: Creature): number[][] {
    const map = allocShortGrid(g.grid.width,g.grid.height,30000), costs = allocShortGrid(g.grid.width,g.grid.height,1);
    for (let x=0;x<g.grid.width;x++) for (let y=0;y<g.grid.height;y++) {
        const cell = g.grid.getCell(x,y)!, p = {x,y}, occupant = g.getMonsterAt(x,y);
        if (occupant && (occupant.isImmuneToWeapons() || occupant.isInvulnerable()) && (occupant.hasBehavior('MONST_IMMOBILE') || occupant.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION'))) costs[x]![y] = -1;
        else if (terrainBlocksMovement(cell) && terrainPassableOrSecretDoor(cell)) costs[x]![y] = 1;
        else if (terrainBlocksMovement(cell)) costs[x]![y] = flags(g,p) & T.T_OBSTRUCTS_DIAGONAL_MOVEMENT ? -2 : -1;
        else if (monsterBlinkAvoids(g,m,p)) costs[x]![y] = -1;
    }
    // calculateDistances uses pdsSetDistance, which seeds even a forbidden
    // destination. batchScan normally seeds only positive costs; allow this
    // one source so the target's neighbors receive the same distances.
    if (target.x > 0 && target.y > 0 && target.x < g.grid.width - 1 && target.y < g.grid.height - 1) {
        map[target.x]![target.y] = 0;
        costs[target.x]![target.y] = 1;
    }
    scanBlinkMap(g,map,costs); return map;
}
export function blinkTowardCreature(g: Game, m: Monster, target: Creature): boolean {
    return hasBlink(m) && !blinkTraversiblePath(g,m,target.loc)
        && (distance(m.loc,target.loc) > 10 || monstersAreEnemies(m,target))
        && monsterBlinkToPreferenceMap(g,m,buildBlinkTargetMap(g,m,target),false);
}
export function blinkAllyAfterMagic(g: Game, m: Monster, closest: Monster | null): boolean {
    let leash = m.seized ? Math.max(g.grid.width,g.grid.height) : g.allyBlinkLeashLength();
    if (closest && distance(m.loc,closest.loc) === 1) {
        if (closest.movementSpeed < m.movementSpeed && !closest.hasBehavior('MONST_FLITS') && !closest.hasBehavior('MONST_IMMOBILE') && closest.state === MonsterState.HUNTING) leash = Math.max(g.grid.width,g.grid.height);
        else leash++;
    }
    if (closest && (distance(m.loc,g.player.loc) < leash || m.doesNotTrackLeader)
        && !m.hasBehavior('MONST_MAINTAINS_DISTANCE') && !futile(g,m,closest)) {
        return blinkChance(m) && monsterBlinkToPreferenceMap(g,m,buildBlinkEnemyMap(g,m,distance(m.loc,closest.loc)),false);
    }
    if (m.doesNotTrackLeader || (distance(m.loc,g.player.loc) < 3 && g.grid.getCell(m.x,m.y)?.isVisible)) return false;
    if (!m.givenUpOnScent && distance(m.loc,g.player.loc) > 10
        && monsterBlinkToPreferenceMap(g,m,p => g.scent.get(p.x,p.y),true)) return true;
    if (m.givenUpOnScent || !g.scent.stepDirection(g.grid,m.x,m.y,{canEnter: (x,y) => !monsterBlinkAvoids(g,m,{x,y})})) {
        return blinkTowardCreature(g,m,m.leader ?? g.player);
    }
    return false;
}

/** CE Monsters.c:3552-3571: captors approach a healthy regenerative captive
 * before considering adjacent enemies. The pack-follow branch later in the turn
 * has no health/poison gate; both routes delegate to pathTowardCreature. */
export function blinkTowardCaptiveLeader(g: Game, m: Monster): boolean {
    const leader = m.leader;
    if (!leader?.isCaged || leader.regenTurns <= 0 || m.hasAbility('MA_POISONS')
        || distance(m.loc, leader.loc) === 1 || entrancementDiagonalBlocked(g.grid, m.loc, leader.loc)) return false;
    const upper = CombatSystem.parseDamageString(m.damageString).max;
    if (leader.hp <= Math.trunc(upper * monsterDamageAdjustmentAmount(m.weaknessAmount))) return false;
    return blinkTowardCreature(g, m, leader);
}
