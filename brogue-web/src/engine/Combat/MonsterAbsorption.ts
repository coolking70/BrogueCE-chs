/** U11: CE Combat.c canAbsorb/anyoneWantABite and Monsters.c corpse branch.
 * A corpse is a position/name task, not a persistent item or global token. */
import type { Game } from '../Core/Game';
import { MonsterState, type Monster } from '../../entities/Monster';
import type { Pos } from '../../types';
import { rng } from '../Random';
import { CEBoltType, CEBoltFlags, CE_BOLT_CATALOG } from './BoltCatalog';
import { monsterBlinkAvoids, scanBlinkMap, buildBlinkSafeTerrainMap, buildBlinkAllySafetyMap, blinkAllyFlees } from './MonsterBlink';
import { teleportForbiddenFlags } from '../Movement/CreaturePlacement';
import { terrainPassableOrSecretDoor } from '../Map/TerrainRules';
import { cellTerrainFlags } from '../Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_DIAGONAL_MOVEMENT } from '../Map/TerrainCatalog';
import * as T from '../Map/TerrainCatalog';
import { allocShortGrid, safetyNextStep } from '../Map/SafetyMap';
import { canObserveBoltCreature } from './BoltTargeting';
import { logger } from '../Systems/Logger';
import i18next from 'i18next';
import verbs from '../../data/monsterAbsorptionVerbs.json';

// Rogue.h:2095,2129: bit order matters to the second lottery.
export const LEARNABLE_ABILITIES = ['MA_TRANSFERENCE', 'MA_CAUSES_WEAKNESS'] as const;
export const LEARNABLE_BEHAVIORS = ['MONST_INVISIBLE', 'MONST_FLIES', 'MONST_IMMUNE_TO_FIRE', 'MONST_REFLECT_50'] as const;
const abilityDescriptions: Record<string, string> = {
    MA_TRANSFERENCE: 'recovers health when $HESHE inflicts damage',
    MA_CAUSES_WEAKNESS: 'saps strength when $HESHE inflicts damage',
    MONST_INVISIBLE: 'is invisible', MONST_FLIES: 'flies',
    MONST_IMMUNE_TO_FIRE: 'is immune to fire', MONST_REFLECT_50: 'can reflect magic spells',
};
const same = (a: Pos, b: Pos | null) => !!b && a.x === b.x && a.y === b.y;
const valid = (g: Game, p: Pos | null): p is Pos => !!p && g.grid.isValidPos(p.x, p.y);
const allied = (m: Monster) => m.isAlly && m.state !== MonsterState.FLEEING && !m.hasStatus('magical_fear');
const excluded = (m: Monster) => m.hasCEBehavior('MONST_INANIMATE') || m.hasCEBehavior('MONST_IMMOBILE');
const boltType = (name: string) => CEBoltType[name as keyof typeof CEBoltType];
const learnableBolt = (b: CEBoltType) => b !== undefined && b !== CEBoltType.NONE
    && !(CE_BOLT_CATALOG[b].flags & CEBoltFlags.NOT_LEARNABLE);

/** calculateDistances(... forbiddenFlagsForMonster(info), NULL, true, true).
 * Only the destination gets monsterAvoids, not every tile of this distance map. */
export function corpseDistanceMap(g: Game, ally: Monster, at: Pos): number[][] {
    const map = allocShortGrid(g.grid.width, g.grid.height, 30000);
    const costs = allocShortGrid(g.grid.width, g.grid.height, 1);
    const forbidden = teleportForbiddenFlags(ally);
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        const cell = g.grid.getCell(x, y)!, flags = cellTerrainFlags(g.grid, x, y), occupant = g.getMonsterAt(x, y);
        if (occupant && (occupant.isImmuneToWeapons() || occupant.isInvulnerable())
            && (occupant.hasCEBehavior('MONST_IMMOBILE') || occupant.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION'))) costs[x]![y] = -1;
        else if ((flags & T_OBSTRUCTS_PASSABILITY) && terrainPassableOrSecretDoor(cell)) costs[x]![y] = 1;
        else if (flags & T_OBSTRUCTS_PASSABILITY) costs[x]![y] = flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT ? -2 : -1;
        else if (flags & forbidden) costs[x]![y] = -1;
    }
    map[at.x]![at.y] = 0;
    costs[at.x]![at.y] = 1; // pdsSetDistance seeds even a forbidden destination.
    scanBlinkMap(g, map, costs, true);
    return map;
}

export function canAbsorb(g: Game, ally: Monster, ourBolts: Set<CEBoltType>, prey: Monster, map: number[][]): boolean {
    if (!allied(ally) || ally.newPowerCount <= 0 || valid(g, ally.targetCorpseLoc)
        || excluded(ally) || excluded(prey) || monsterBlinkAvoids(g, ally, prey.loc)
        || (map[ally.x]?.[ally.y] ?? 30000) > 10) return false;
    if (LEARNABLE_ABILITIES.some(f => !ally.hasAbility(f) && prey.hasAbility(f))) return true;
    if (LEARNABLE_BEHAVIORS.some(f => !ally.hasBehavior(f) && prey.hasBehavior(f))) return true;
    // CE only populates this scratch array on the bolt branch. Flag success and
    // failed eligibility deliberately retain the preceding call's contents.
    ourBolts.clear();
    for (const b of ally.bolts) ourBolts.add(boltType(b));
    return prey.bolts.some(b => learnableBolt(boltType(b)) && !ourBolts.has(boltType(b)));
}

export function anyoneWantABite(g: Game, decedent: Monster,
    distances: typeof corpseDistanceMap = corpseDistanceMap): boolean {
    if ((!LEARNABLE_ABILITIES.some(f => decedent.hasAbility(f))
        && !LEARNABLE_BEHAVIORS.some(f => decedent.hasBehavior(f)) && !decedent.bolts.length)
        || !valid(g, decedent.loc) || (cellTerrainFlags(g.grid, decedent.x, decedent.y) & T_OBSTRUCTS_PASSABILITY)
        || ['spectral_image', 'spectral_sword'].includes(decedent.typeId) || excluded(decedent)) return false;
    // CE iterateCreatures excludes HAS_DIED and dormant/detached entities.
    const roster = g.monsters.filter(m => m.hp > 0 && !m.deathProcessed && !m.isDormant && m !== decedent);
    const ourBolts = new Set<CEBoltType>();
    let map: number[][] = [], candidates = 0;
    for (const ally of roster) {
        if (allied(ally)) map = distances(g, ally, decedent.loc);
        if (canAbsorb(g, ally, ourBolts, decedent, map)) candidates++;
    }
    if (!candidates) return false;
    let index = rng.randRange(1, candidates);
    // CE defect, intentionally retained: second pass reuses the LAST ally's
    // map, even if that ally had no slots/was busy. Never retry a missed index.
    for (const ally of roster) {
        if (!canAbsorb(g, ally, ourBolts, decedent, map) || --index) continue;
        ally.targetCorpseLoc = { ...decedent.loc };
        ally.targetCorpseName = decedent.name;
        ally.corpseAbsorptionCounter = 20;
        const flags = [
            ...LEARNABLE_ABILITIES.filter(f => !ally.hasAbility(f) && decedent.hasAbility(f)).map(flag => ({ flag, behavior: false })),
            ...LEARNABLE_BEHAVIORS.filter(f => !ally.hasBehavior(f) && decedent.hasBehavior(f)).map(flag => ({ flag, behavior: true })),
        ];
        if (flags.length) {
            const selected = flags[rng.randRange(1, flags.length) - 1]!;
            ally.absorptionFlags = selected.flag;
            ally.absorbBehavior = selected.behavior;
            return true;
        }
        const bolts = decedent.bolts.map(boltType).filter(b => learnableBolt(b) && !ourBolts.has(b));
        if (bolts.length) { ally.absorptionBolt = bolts[rng.randRange(1, bolts.length) - 1]!; return true; }
        return false;
    }
    return false;
}

function absorptionMessage(g: Game, m: Monster, finished: boolean): void {
    if (!canObserveBoltCreature(g.player, g.grid, m)) return;
    const verb = (verbs as Record<string, string>)[m.typeId] ?? 'studying';
    const action = i18next.t(`learning.verbs.${verb}`, { defaultValue: verb });
    logger.log(i18next.t(finished ? 'learning.finished' : 'learning.begins', {
        name: m.name, corpse: m.targetCorpseName, action,
        defaultValue: finished ? 'The {{name}} finished {{action}} the {{corpse}}.' : 'The {{name}} begins {{action}} the fallen {{corpse}}.',
    }), '#88ff88');
    if (!finished) return;
    const isBolt = m.absorptionBolt !== CEBoltType.NONE;
    const id = isBolt ? CEBoltType[m.absorptionBolt] : m.absorptionFlags!;
    const description = isBolt ? CE_BOLT_CATALOG[m.absorptionBolt].abilityDescription : abilityDescriptions[id] ?? '';
    const female = m.hasBehavior('MONST_FEMALE'), male = m.hasBehavior('MONST_MALE');
    const resolved = description.replace(/\$HISHER/g, female ? 'her' : male ? 'his' : 'its')
        .replace(/\$HESHE/g, female ? 'she' : male ? 'he' : 'it');
    const power = i18next.t(`learning.powers.${id}`, { defaultValue: resolved });
    logger.log(i18next.t(isBolt ? 'learning.gained_bolt' : 'learning.gained_flag', {
        name: m.name, power, defaultValue: isBolt ? 'The {{name}} {{power}}!' : 'The {{name}} now {{power}}!',
    }), '#ffff66');
}

/** Returns true when the whole action (including the final one) costs 100 ticks. */
export function updateMonsterCorpseAbsorption(g: Game, m: Monster): boolean {
    if (same(m.loc, m.targetCorpseLoc) && m.isAbsorbing) {
        if (--m.corpseAbsorptionCounter <= 0) {
            m.targetCorpseLoc = null;
            if (m.absorptionBolt !== CEBoltType.NONE) m.bolts.push(CEBoltType[m.absorptionBolt]);
            else if (m.absorptionFlags) (m.absorbBehavior ? m.behaviorFlags : m.abilityFlags).add(m.absorptionFlags);
            m.newPowerCount--;
            m.isAbsorbing = false;
            m.syncFlagDerivedStatuses(true);
            absorptionMessage(g, m, true);
            m.absorptionFlags = null;
            m.absorptionBolt = CEBoltType.NONE;
        }
        m.ticksUntilTurn = 100;
        return true;
    }
    if (--m.corpseAbsorptionCounter <= 0) {
        m.targetCorpseLoc = null;
        m.isAbsorbing = false;
        m.absorptionFlags = null;
        m.absorptionBolt = CEBoltType.NONE;
    } else if (m.isAbsorbing) {
        m.isAbsorbing = false;
        if (m.corpseAbsorptionCounter <= 15) {
            m.targetCorpseLoc = null;
            m.absorptionFlags = null;
            m.absorptionBolt = CEBoltType.NONE;
        }
    }
    return false;
}

export function canApproachCorpse(g: Game, m: Monster): boolean {
    return valid(g, m.targetCorpseLoc) && !m.hasStatus('poisoned')
        && (!((m.statusDurations as Record<string, number>).burning ?? 0) || m.hasStatus('immune_fire'));
}

/** Only pending learners use these walking fallbacks. Existing blink attempts
 * still run first; unrelated ally AI remains U12. Escape/retreat outrank magic
 * and the corpse branch in CE moveAlly. */
export function corpseAllyBeforeMagic(g: Game, m: Monster, enemy: Monster | null, move: (p: Pos) => boolean): boolean {
    const f = cellTerrainFlags(g.grid, m.x, m.y);
    const gas = T.T_CAUSES_DAMAGE | T.T_CAUSES_PARALYSIS | T.T_CAUSES_CONFUSION;
    const harmful = (f & T.T_HARMFUL_TERRAIN & ~(T.T_IS_FIRE | gas))
        || ((f & T.T_IS_FIRE) && !m.hasStatus('immune_fire'))
        || ((f & gas) && !m.hasCEBehavior('MONST_INANIMATE') && !m.isInvulnerable());
    const walkDown = (map: number[][]) => {
        const step = safetyNextStep(map, g.grid, m.x, m.y);
        return !!step && passiveCorpseStep(g, m, { x: m.x + step[0], y: m.y + step[1] }, move);
    };
    if (harmful && walkDown(buildBlinkSafeTerrainMap(g))) return true;
    return blinkAllyFlees(g, m, enemy) && walkDown(buildBlinkAllySafetyMap(g));
}

/** The corpse branch's CE passive approach; no pathfinder detour or extra bolt.
 * move owns ordinary movement effects. Occupancy is checked by that callback. */
export function moveAllyToCorpse(g: Game, m: Monster, move: (p: Pos) => boolean): boolean {
    if (!canApproachCorpse(g, m)) return false;
    const target = m.targetCorpseLoc!;
    passiveCorpseStep(g, m, target, move);
    if (same(m.loc, target) && !m.isAbsorbing) {
        absorptionMessage(g, m, false);
        m.corpseAbsorptionCounter = 20;
        m.isAbsorbing = true;
    }
    return true;
}

export function passiveCorpseStep(g: Game, m: Monster, target: Pos, move: (p: Pos) => boolean): boolean {
    const x = m.x, y = m.y, ax = Math.abs(target.x - x), ay = Math.abs(target.y - y);
    const dx = Math.sign(target.x - x), dy = Math.sign(target.y - y);
    if (!dx && !dy) return false;
    const attempt = (sx: number, sy: number) => (sx !== 0 || sy !== 0)
        && !same({ x: x + sx, y: y + sy }, g.player.loc)
        && !monsterBlinkAvoids(g, m, { x: x + sx, y: y + sy }) && move({ x: x + sx, y: y + sy });
    // isAlly is CE's distinct ALLY state even when web.state is HUNTING.
    if (dx && dy) {
        if (ax > ay && rng.randRange(0, ax) > ay) { if (attempt(dx, 0)) return true; }
        else if (ax < ay && rng.randRange(0, ay) > ax && attempt(0, dy)) return true;
    }
    if (attempt(dx, dy)) return true;
    if (Math.max(ax, ay) <= 1 && (!dx || !dy)) return false;
    return ax < ay ? attempt(0, dy) || attempt(dx, 0) || attempt(-1, dy) || attempt(1, dy)
        : attempt(dx, 0) || attempt(0, dy) || attempt(dx, -1) || attempt(dx, 1);
}
