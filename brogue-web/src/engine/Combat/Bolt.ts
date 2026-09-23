/**
 * src/engine/Combat/Bolt.ts
 * Projectile / bolt system — see BrogueCE Items.c
 *
 * A bolt travels from origin through its aim toward the map edge (or until blocked).
 * On each cell it may leave a trail (pathDF), and on impact it applies an effect.
 */

import type { Pos } from '../../types';
import type { Grid } from '../Map/Grid';
import { promoteLayersWithMechFlag } from '../Map/Promotion';
import { TM_PROMOTES_ON_ELECTRICITY } from '../Map/TerrainCatalog';
import { ItemLoader } from '../Items/ItemLoader';
import type { Creature } from '../../entities/Creature';
import { CEBoltType, CEBoltEffect, CEBoltFlags, CE_BOLT_CATALOG, CE_ITEM_BOLT_TYPES } from './BoltCatalog';

/** CE Items.c:5455-5465 -> Time.c:1289-1303. Also applies to SPARK
 * (GlobalsBrogue.c:84 BF_ELECTRIC), even when no creature is hit. */
export function exposeBoltPathToElectricity(grid: Grid, path: readonly Pos[], effect: BoltEffect): boolean {
    if (effect !== BoltEffect.LIGHTNING && effect !== BoltEffect.SPARK) return false;
    let changed = false;
    for (const p of path) {
        for (const result of promoteLayersWithMechFlag(grid, p.x, p.y, TM_PROMOTES_ON_ELECTRICITY)) {
            changed = result.mutated || changed;
        }
    }
    return changed;
}

// ----- Legacy web dispatch effects (NOT the CE boltType or boltEffects enum) -----

export enum BoltEffect {
    NONE = 0,
    FIRE,
    LIGHTNING,
    POISON,
    TELEPORT,
    SLOW,
    HEALING,
    HASTE,
    TUNNELING,
    BECKONING,
    DISCORD,
    CONJURATION,
    SHIELDING,
    NEGATION,
    DOMINATION,
    ENTRANCEMENT,
    BLINKING,
    OBSTRUCTION,
    EMPOWERMENT,
    INVISIBILITY,
    SPARK,           // electrical bolt used by spark turrets and other monsters
    DRAGONFIRE,       // CE BE_DAMAGE + BF_FIERY, not intrinsically area damage
    DISTANCE_ATTACK,  // CE BE_ATTACK, not BE_DAMAGE
    POISON_DART,
    POLYMORPH,       // W-1: type only; effect implementation belongs to W-19
    PLENTY,          // W-1: type only; effect implementation belongs to W-20
}

/** Semantic aliases only. Presence here does not enable a dispatch branch. */
export const BOLT_EFFECT_CE_EFFECT: Readonly<Record<BoltEffect, CEBoltEffect>> = {
    [BoltEffect.NONE]: CEBoltEffect.NONE,
    [BoltEffect.FIRE]: CEBoltEffect.DAMAGE,
    [BoltEffect.LIGHTNING]: CEBoltEffect.DAMAGE,
    [BoltEffect.POISON]: CEBoltEffect.POISON,
    [BoltEffect.TELEPORT]: CEBoltEffect.TELEPORT,
    [BoltEffect.SLOW]: CEBoltEffect.SLOW,
    [BoltEffect.HEALING]: CEBoltEffect.HEALING,
    [BoltEffect.HASTE]: CEBoltEffect.HASTE,
    [BoltEffect.TUNNELING]: CEBoltEffect.TUNNELING,
    [BoltEffect.BECKONING]: CEBoltEffect.BECKONING,
    [BoltEffect.DISCORD]: CEBoltEffect.DISCORD,
    [BoltEffect.CONJURATION]: CEBoltEffect.CONJURATION,
    [BoltEffect.SHIELDING]: CEBoltEffect.SHIELDING,
    [BoltEffect.NEGATION]: CEBoltEffect.NEGATION,
    [BoltEffect.DOMINATION]: CEBoltEffect.DOMINATION,
    [BoltEffect.ENTRANCEMENT]: CEBoltEffect.ENTRANCEMENT,
    [BoltEffect.BLINKING]: CEBoltEffect.BLINKING,
    [BoltEffect.OBSTRUCTION]: CEBoltEffect.OBSTRUCTION,
    [BoltEffect.EMPOWERMENT]: CEBoltEffect.EMPOWERMENT,
    [BoltEffect.INVISIBILITY]: CEBoltEffect.INVISIBILITY,
    [BoltEffect.SPARK]: CEBoltEffect.DAMAGE,
    [BoltEffect.DRAGONFIRE]: CEBoltEffect.DAMAGE,
    [BoltEffect.DISTANCE_ATTACK]: CEBoltEffect.ATTACK,
    [BoltEffect.POISON_DART]: CEBoltEffect.ATTACK,
    [BoltEffect.POLYMORPH]: CEBoltEffect.POLYMORPH,
    [BoltEffect.PLENTY]: CEBoltEffect.PLENTY,
};

// ----- Bolt configuration -----

export interface BoltConfig {
    /** Internal id used for lookup (matches wand/staff id). */
    id: string;
    /** CE catalog identity, separate from legacy dispatch. null = web invention.
     * W-3 consumes trajectory flags; magnitude/effect migration stays separate. */
    ceType: CEBoltType | null;
    /** Display name (already translated via tn()). */
    name: string;
    /** What happens on impact. */
    effect: BoltEffect;
    /** Legacy runtime value, NOT CE enchantment/charges. W-8 CE fire/lightning
     * STAFF damage ignores it and resolves instance E at the effect consumer.
     * W-9 directed statuses also resolve CE magnitude at contact.
     * Remaining effects and retired web inventions retain this legacy value. */
    magnitude: number;
    /** Display character while in flight. */
    char: string;
    /** Hex colour of the bolt glyph. */
    color: number;
    /** Maximum range in tiles (0 = unlimited up to map edge). */
    maxRange: number;
    /** Piercing fallback for web inventions; CE identities use their catalog flag. */
    piercing: boolean;
    /** Legacy aim-at-origin switch. This is NOT CE blinking (which moves caster). */
    selfTargeting: boolean;
}

// ----- Static catalogue of all bolts -----
// `name` is set at runtime via tn() so we store the English key here;
// call `getBoltConfigs()` to get the translated versions.

const RAW_BOLT_DATA: Omit<BoltConfig, 'name' | 'ceType'>[] = [
    // --- Wands ---
    { id: 'wand_of_fire', effect: BoltEffect.FIRE, magnitude: 5, char: '*', color: 0xff6600, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'wand_of_lightning', effect: BoltEffect.LIGHTNING, magnitude: 8, char: '~', color: 0x33ccff, maxRange: 0, piercing: true, selfTargeting: false },
    { id: 'wand_of_teleportation', effect: BoltEffect.TELEPORT, magnitude: 0, char: '/', color: 0xcc88ff, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'wand_of_slowness', effect: BoltEffect.SLOW, magnitude: 0, char: '-', color: 0x888888, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'wand_of_invisibility', effect: BoltEffect.INVISIBILITY, magnitude: 0, char: '.', color: 0xaaaaff, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'wand_of_empowerment', effect: BoltEffect.EMPOWERMENT, magnitude: 0, char: '+', color: 0xffff44, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'wand_of_beckoning', effect: BoltEffect.BECKONING, magnitude: 0, char: '?', color: 0x88ccff, maxRange: 0, piercing: false, selfTargeting: false },

    // --- Staffs ---
    { id: 'staff_of_fire', effect: BoltEffect.FIRE, magnitude: 6, char: '*', color: 0xff4400, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'staff_of_lightning', effect: BoltEffect.LIGHTNING, magnitude: 10, char: '~', color: 0x00ccff, maxRange: 0, piercing: true, selfTargeting: false },
    { id: 'staff_of_poison', effect: BoltEffect.POISON, magnitude: 4, char: '·', color: 0x55cc55, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'staff_of_healing', effect: BoltEffect.HEALING, magnitude: 8, char: '+', color: 0x44ff88, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'staff_of_haste', effect: BoltEffect.HASTE, magnitude: 0, char: '>', color: 0xffff88, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'staff_of_conjuration', effect: BoltEffect.CONJURATION, magnitude: 3, char: '!', color: 0xaaddff, maxRange: 0, piercing: false, selfTargeting: false },
    { id: 'staff_of_light', effect: BoltEffect.SHIELDING, magnitude: 0, char: '°', color: 0xffffcc, maxRange: 0, piercing: false, selfTargeting: false },
];

/** Return the full bolt config list with translated names. */
export function getBoltConfigs(): BoltConfig[] {
    return RAW_BOLT_DATA.map((raw) => ({
        ...raw,
        ceType: CE_ITEM_BOLT_TYPES[raw.id] ?? null,
        name: ItemLoader.translateName(raw.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
    }));
}

/** Look up a bolt config by its item identity id. */
export function getBoltForItem(identityId: string): BoltConfig | undefined {
    const configs = getBoltConfigs();
    return configs.find(c => c.id === identityId);
}

// ----- Monster-cast bolt metadata (P4-1b) -----
//
// Execution subset of the CE catalog, preserving the P4-1b routes. Full CE
// metadata in BoltCatalog is not permission to cast every catalog entry.
// SPIDERWEB / ANCIENT_SPIRIT_VINES remain effect:null (DF execution missing);
// BLINKING remains filtered by Monster.tryUseBolt. WHIP keeps its weapon route.
export interface MonsterBoltMeta {
    ceType: CEBoltType;
    /** null = known missing execution, even though CE identity is now mapped. */
    effect: BoltEffect | null;
    targetAllies: boolean;
    targetEnemies: boolean;
    fiery: boolean;
    /** CE catalog value; monster damage still uses the legacy CombatSystem.attack. */
    magnitude: number;
}

function monsterBoltMeta(ceType: CEBoltType, effect: BoltEffect | null): MonsterBoltMeta {
    const definition = CE_BOLT_CATALOG[ceType];
    return {
        ceType,
        effect,
        targetAllies: !!(definition.flags & CEBoltFlags.TARGET_ALLIES),
        targetEnemies: !!(definition.flags & CEBoltFlags.TARGET_ENEMIES),
        fiery: !!(definition.flags & CEBoltFlags.FIERY),
        magnitude: definition.magnitude,
    };
}

export const MONSTER_BOLT_TABLE: Record<string, MonsterBoltMeta> = {
    SHIELDING: monsterBoltMeta(CEBoltType.SHIELDING, BoltEffect.SHIELDING),
    HASTE: monsterBoltMeta(CEBoltType.HASTE, BoltEffect.HASTE),
    SPARK: monsterBoltMeta(CEBoltType.SPARK, BoltEffect.SPARK),
    DISTANCE_ATTACK: monsterBoltMeta(CEBoltType.DISTANCE_ATTACK, BoltEffect.DISTANCE_ATTACK),
    HEALING: monsterBoltMeta(CEBoltType.HEALING, BoltEffect.HEALING),
    BLINKING: monsterBoltMeta(CEBoltType.BLINKING, BoltEffect.BLINKING),
    NEGATION: monsterBoltMeta(CEBoltType.NEGATION, BoltEffect.NEGATION),
    DISCORD: monsterBoltMeta(CEBoltType.DISCORD, BoltEffect.DISCORD),
    POISON_DART: monsterBoltMeta(CEBoltType.POISON_DART, BoltEffect.POISON_DART),
    FIRE: monsterBoltMeta(CEBoltType.FIRE, BoltEffect.FIRE),
    DRAGONFIRE: monsterBoltMeta(CEBoltType.DRAGONFIRE, BoltEffect.DRAGONFIRE),
    BECKONING: monsterBoltMeta(CEBoltType.BECKONING, BoltEffect.BECKONING),
    SLOW_2: monsterBoltMeta(CEBoltType.SLOW_2, BoltEffect.SLOW),
    SPIDERWEB: monsterBoltMeta(CEBoltType.SPIDERWEB, null),
    ANCIENT_SPIRIT_VINES: monsterBoltMeta(CEBoltType.ANCIENT_SPIRIT_VINES, null),
};

/** 已知但本轮故意不实现的 CE bolt 名（供测试显式断言，防止悄悄新增未登记名字）。 */
export const KNOWN_GAP_MONSTER_BOLT_NAMES: readonly string[] = ['SPIDERWEB', 'ANCIENT_SPIRIT_VINES'];

// ----- Legacy segment for thrown items (ordinary bolts use BoltTrajectory) -----

/**
 * Compute a straight-line path from `from` to `to` using Bresenham's algorithm.
 * Returns all cells along the line (excluding the origin cell).
 */
export function boltPath(from: Pos, to: Pos, maxLen: number = 80): Pos[] {
    const path: Pos[] = [];
    let x0 = from.x, y0 = from.y;
    const x1 = to.x, y1 = to.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    // Skip origin
    while (true) {
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }

        if (x0 === x1 && y0 === y1) {
            path.push({ x: x0, y: y0 });
            break;
        }
        path.push({ x: x0, y: y0 });
        if (path.length >= maxLen) break;
    }
    return path;
}

// ----- Bolt animation frame data -----

export interface BoltFrame {
    x: number;
    y: number;
    char: string;
    color: number;
    /** How many ms this frame should last. */
    durationMs: number;
}

/**
 * Build the visual animation frames for a bolt travelling along `path`.
 * Each frame represents the bolt at one tile position.
 */
export function buildBoltFrames(path: Pos[], bolt: BoltConfig): BoltFrame[] {
    return path.map((p) => ({
        x: p.x,
        y: p.y,
        char: bolt.char,
        color: bolt.color,
        durationMs: 35,
    }));
}

// ----- Bolt effect result (returned to Game.ts for application) -----

/** A living, active recipient reached AFTER reflection, including the caster or
 * player. An effect attempt, not proof of HP loss (immunity/miss still count).
 * Reflectors are not hits. Repeat visits are separate hits. Snapshot the position:
 * teleport/beckoning can move the recipient.
 * CE updateBolt (Items.c:5115-5132) separates caster from creature being hit. */
export interface BoltHit {
    readonly creature: Creature;
    readonly pos: Pos;
}

export interface BoltReflection {
    readonly pos: Pos;
    readonly pathIndex: number;
    /** null for reflective terrain; pos is the kink, before the blocking tile. */
    readonly creature: Creature | null;
    readonly towardCaster: boolean;
}

/** Effect-commit contract. CE Items.c:5112-5119,
 * 5470-5474,5516-5555,5567: autoID is an effect observation, not "a bolt fired".
 * Movement records a committed caster move, not an intended aim/destination. */
export interface BoltOutcome {
    readonly autoID: boolean;
    readonly casterMovement: { readonly from: Pos; readonly to: Pos } | null;
}

export interface BoltResult {
    /** Can be player, monster or null (CE allows an absent caster). */
    caster: Creature | null;
    origin: Pos;
    /** Aimed position, independent of caster identity and final landing. */
    aimPos: Pos;
    /** Ordered effect contacts after reflection. Origin can be revisited/hit.
     * Pure previews (outcome=null) predict contacts without rolling reflection.
     * W-9 directed effects require actual hits; legacy shielding awaits W-15. */
    hits: BoltHit[];
    /** Deflections in travel order, separate from hits and effect observation. */
    reflections: BoltReflection[];
    /** Last reached cell after ordinary collision/halts-before rules; null for no travel. */
    landingPos: Pos | null;
    /** null = effect outcome NOT evaluated. Never treat it as autoID=false.
     * Tracing leaves null; W-2 execution exits always evaluate this value. */
    outcome: BoltOutcome | null;
    /** Cells the bolt passed through. */
    path: Pos[];
    /** Legacy effect position: falls back to origin on an empty path.
     * Kept for existing switches; use landingPos to distinguish no landing. */
    impactPos: Pos;
    /** Which effect to apply. */
    effect: BoltEffect;
    /** Unchanged legacy runtime magnitude/damage, not CE enchantment. */
    magnitude: number;
    /** The bolt config used. */
    bolt: BoltConfig;
    /** Animation frame data the renderer can consume. */
    frames: BoltFrame[];
}

/** Package an already computed route. No targeting, collisions, effect execution,
 * autoID decision, RNG or world mutation. Both legacy exits can carry a caster. */
export function createBoltResult(bolt: BoltConfig, caster: Creature | null,
    origin: Pos, aimPos: Pos, path: readonly Pos[], hits: readonly BoltHit[]): BoltResult {
    const cells = path.map(p => ({ ...p }));
    const landingPos = cells.length ? { ...cells[cells.length - 1]! } : null;
    return {
        caster,
        origin: { ...origin },
        aimPos: { ...aimPos },
        hits: hits.map(hit => ({ creature: hit.creature, pos: { ...hit.pos } })),
        reflections: [],
        landingPos,
        outcome: null,
        path: cells,
        impactPos: { ...(landingPos ?? origin) },
        effect: bolt.effect,
        magnitude: bolt.magnitude,
        bolt,
        frames: buildBoltFrames(cells, bolt),
    };
}
