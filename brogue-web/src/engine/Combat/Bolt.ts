/**
 * src/engine/Combat/Bolt.ts
 * Projectile / bolt system — ported from BrogueCE Combat.c
 *
 * A bolt travels in a straight line from origin to a target (or until blocked).
 * On each cell it may leave a trail (pathDF), and on impact it applies an effect.
 */

import type { Pos } from '../../types';
import { ItemLoader } from '../Items/ItemLoader';

// ----- Bolt effect enum (mirrors CE boltType) -----

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
    SPARK,           // weaker fire used by some monsters
    DRAGONFIRE,       // strong area fire
    DISTANCE_ATTACK,  // generic ranged damage
    POISON_DART,
}

// ----- Bolt configuration -----

export interface BoltConfig {
    /** Internal id used for lookup (matches wand/staff id). */
    id: string;
    /** Display name (already translated via tn()). */
    name: string;
    /** What happens on impact. */
    effect: BoltEffect;
    /** Base damage or magnitude (0 for pure-utility bolts). */
    magnitude: number;
    /** Display character while in flight. */
    char: string;
    /** Hex colour of the bolt glyph. */
    color: number;
    /** Maximum range in tiles (0 = unlimited up to map edge). */
    maxRange: number;
    /** Does it pierce through the first creature? */
    piercing: boolean;
    /** Does it affect the caster (e.g. blinking)? */
    selfTargeting: boolean;
}

// ----- Static catalogue of all bolts -----
// `name` is set at runtime via tn() so we store the English key here;
// call `getBoltConfigs()` to get the translated versions.

const RAW_BOLT_DATA: Omit<BoltConfig, 'name'>[] = [
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
        name: ItemLoader.translateName(raw.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
    }));
}

/** Look up a bolt config by its item identity id. */
export function getBoltForItem(identityId: string): BoltConfig | undefined {
    const configs = getBoltConfigs();
    return configs.find(c => c.id === identityId);
}

// ----- Line-of-sight path (Bresenham) -----

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

export interface BoltResult {
    /** Cells the bolt passed through. */
    path: Pos[];
    /** The cell where the bolt stopped (hit wall/creature or end of range). */
    impactPos: Pos;
    /** Which effect to apply. */
    effect: BoltEffect;
    /** Magnitude/damage. */
    magnitude: number;
    /** The bolt config used. */
    bolt: BoltConfig;
    /** Animation frame data the renderer can consume. */
    frames: BoltFrame[];
}
