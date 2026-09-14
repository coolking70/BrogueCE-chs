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

// ----- Monster-cast bolt metadata (P4-1b) -----
//
// monsters.json 的 `bolts` 字段（P4-1a 接入）存的是 CE boltType 去 BOLT_ 前缀的
// 原始名字（如 "SPARK"、"SLOW_2"），不是 web 的 BoltEffect。这张表把 CE bolt 名
// 映射到 BoltEffect + CE boltCatalog（GlobalsBrogue.c:58-87）里与"怪物该不该对
// 这个目标放这个 bolt"直接相关的字段：BF_TARGET_ALLIES/BF_TARGET_ENEMIES、
// BF_FIERY、以及 magnitude（仅供报告/调试参考，实际伤害走 CombatSystem.attack，
// 详见 Monster.ts 的施法实现与本轮报告）。
//
// effect: null 的两项（SPIDERWEB / ANCIENT_SPIRIT_VINES）是 P4-1a 报告登记的
// 已知缺口——CE 里是 BE_NONE + 铺地形（spawnDungeonFeature），web 的 BoltEffect
// 模型是"命中生物产生效果"，两者不是一回事。本轮不实现，登记在表里只是为了让
// monstUseBolt 的遍历逻辑能识别到"这是已知的、故意不做的 bolt"而不是漏看的
// 未知名字（见 Monster.tryUseBolt 的过滤逻辑与测试里的显式断言）。
export interface MonsterBoltMeta {
    /** null = 已知缺口，不实现（见上）。 */
    effect: BoltEffect | null;
    targetAllies: boolean;
    targetEnemies: boolean;
    /** BF_FIERY：不对免疫火焰的目标发射。 */
    fiery: boolean;
    /** CE boltCatalog 的 magnitude 列，供参考/报告用。 */
    magnitude: number;
}

export const MONSTER_BOLT_TABLE: Record<string, MonsterBoltMeta> = {
    // GlobalsBrogue.c:80 protection magic — BE_SHIELDING, BF_TARGET_ALLIES
    SHIELDING: { effect: BoltEffect.SHIELDING, targetAllies: true, targetEnemies: false, fiery: false, magnitude: 5 },
    // GlobalsBrogue.c:78 haste spell — BE_HASTE, BF_TARGET_ALLIES
    HASTE: { effect: BoltEffect.HASTE, targetAllies: true, targetEnemies: false, fiery: false, magnitude: 2 },
    // GlobalsBrogue.c:82 spark — BE_DAMAGE, BF_TARGET_ENEMIES | BF_ELECTRIC
    SPARK: { effect: BoltEffect.SPARK, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 1 },
    // GlobalsBrogue.c:85 arrow — BE_ATTACK, BF_TARGET_ENEMIES（炮塔/半人马普通远程攻击）
    DISTANCE_ATTACK: { effect: BoltEffect.DISTANCE_ATTACK, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 1 },
    // GlobalsBrogue.c:77 healing magic — BE_HEALING, BF_TARGET_ALLIES
    HEALING: { effect: BoltEffect.HEALING, targetAllies: true, targetEnemies: false, fiery: false, magnitude: 5 },
    // GlobalsBrogue.c:70 blink trajectory — CE 在 monstUseBolt 里显式 continue 跳过
    // （BLINKING 在别处处理，本轮不实现），这里登记仅供过滤表查得到。
    BLINKING: { effect: BoltEffect.BLINKING, targetAllies: false, targetEnemies: false, fiery: false, magnitude: 5 },
    // GlobalsBrogue.c:64 negation magic — BE_NEGATION, BF_TARGET_ENEMIES
    NEGATION: { effect: BoltEffect.NEGATION, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 10 },
    // GlobalsBrogue.c:74 spell of discord — BE_DISCORD, BF_TARGET_ENEMIES
    DISCORD: { effect: BoltEffect.DISCORD, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 10 },
    // GlobalsBrogue.c:86 poisoned dart — BE_ATTACK, BF_TARGET_ENEMIES
    POISON_DART: { effect: BoltEffect.POISON_DART, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 1 },
    // GlobalsBrogue.c:69 flame — BE_DAMAGE, BF_TARGET_ENEMIES | BF_FIERY
    FIRE: { effect: BoltEffect.FIRE, targetAllies: false, targetEnemies: true, fiery: true, magnitude: 4 },
    // GlobalsBrogue.c:84 dragonfire — BE_DAMAGE, BF_TARGET_ENEMIES | BF_FIERY
    DRAGONFIRE: { effect: BoltEffect.DRAGONFIRE, targetAllies: false, targetEnemies: true, fiery: true, magnitude: 18 },
    // GlobalsBrogue.c:65 beckoning spell — BE_BECKONING, BF_TARGET_ENEMIES
    BECKONING: { effect: BoltEffect.BECKONING, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 10 },
    // GlobalsBrogue.c:79 slowing spell（弱化变体，magnitude=2）— BE_SLOW 与
    // BOLT_SLOW 共用同一个 boltEffect（P4-1a 报告已核实），映射到同一个
    // web BoltEffect.SLOW。
    SLOW_2: { effect: BoltEffect.SLOW, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 2 },
    // 已知缺口，见上方说明。
    SPIDERWEB: { effect: null, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 10 },
    ANCIENT_SPIRIT_VINES: { effect: null, targetAllies: false, targetEnemies: true, fiery: false, magnitude: 5 },
};

/** 已知但本轮故意不实现的 CE bolt 名（供测试显式断言，防止悄悄新增未登记名字）。 */
export const KNOWN_GAP_MONSTER_BOLT_NAMES: readonly string[] = ['SPIDERWEB', 'ANCIENT_SPIRIT_VINES'];

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
