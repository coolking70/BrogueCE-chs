/**
 * R-1（渲染纯重构轮）特征化测试 + 结构守卫。
 *
 * 本轮是"结构先行、行为逐位不变"的重构：把 GameCanvas.vue 内联的
 * 「格子/实体 → 外观」决策抽成 src/engine/UI/Appearance.ts 纯函数。
 * 本文件做两件事：
 *
 *  1. 特征化（characterization）：把现状输出**穷举钉死**——terrainAppearance
 *     对 TerrainType 全部 47 个成员 × 可见/不可见给出全等期望表；
 *     cellAppearance / entityAppearance 对三态（可见/记忆/未探索）与
 *     三类实体逐一钉死，包括幻觉掷骰的调用次数与顺序这类"怪癖"。
 *  2. 结构守卫：钉死 GameCanvas.vue 里**不得再出现外观决策**
 *     （颜色/字形字面量、决策 switch、决策 API 引用、直接幻觉掷骰），
 *     防止决策在未来的 UI 轮里又漏回 SFC。
 *
 * ⚠️ 漏授权形态①预警：下面 Record<TerrainType, …> 期望表是一张
 * **结构性穷举表**——将来任何一轮给 TerrainType 新增成员，
 * 本表会**当场编译报错（缺键）+ 运行时翻红（计数断言）**。
 * 这是有意的：新增地形时必须在此登记它的期望外观
 * （同时 Appearance.ts 的 terrainAppearance 需要新 case）。
 * 若新地形故意走 default（无专属外观），就在表里显式填
 * { char: ' ', color: '#000000', bgColor: null } 并注明"沿用 default"。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TerrainType, Cell } from '../engine/Map/Grid';
import { GasType, type GasCell } from '../engine/Environment/Gas';
import { ColorUtils } from '../engine/Map/Color';
import type { LightCell } from '../engine/Lighting/LightMap';
import {
    terrainAppearance,
    cellAppearance,
    itemAppearance,
    monsterAppearance,
    playerAppearance,
    entityAppearance,
    HALLUCINATION_COLORS,
    HALLUCINATION_CHARS,
    type CosmeticRng,
    type CellAppearanceContext,
    type EntityAppearanceContext,
} from '../engine/UI/Appearance';
import { Item, ItemCategory } from '../engine/Items/Item';
import { MonsterState, type Monster } from '../entities/Monster';
import { Player } from '../entities/Player';

// ════════════════════════ 工具 ════════════════════════

/** 从枚举取全部成员值（TS 数字枚举的 Object.values 含反向键名，滤掉字符串）。 */
const ALL_TERRAINS: TerrainType[] = Object.values(TerrainType).filter(
    (v): v is TerrainType => typeof v === 'number',
);

/** terrainAppearance 走 default 分支的成员（无专属外观——UI-1 欠账登记处）。 */
const DEFAULT_LOOK = { char: ' ', color: '#000000', bgColor: null };

/**
 * 可见态穷举期望表。逐字转录自重构前 GameCanvas.vue getTerrainVisual
 * （原 126-184 行）的可见分支。Record<TerrainType,…> 让"漏成员"成为
 * 编译错误（见文件头漏授权形态①预警）。
 */
const EXPECTED_VISIBLE: Record<TerrainType, { char: string; color: string; bgColor: number | null }> = {
    [TerrainType.NOTHING]: DEFAULT_LOOK,
    [TerrainType.GRANITE]: { char: '#', color: '#444455', bgColor: null },
    [TerrainType.FLOOR]: { char: '.', color: '#aaaaaa', bgColor: 0x222233 },
    [TerrainType.WALL]: DEFAULT_LOOK,
    [TerrainType.DOOR]: { char: '+', color: '#aa8844', bgColor: 0x332211 },
    [TerrainType.OPEN_DOOR]: { char: "'", color: '#aa8844', bgColor: 0x221800 },
    [TerrainType.WATER_SHALLOW]: { char: '~', color: '#3366cc', bgColor: 0x112244 },
    [TerrainType.WATER_DEEP]: { char: '~', color: '#1133aa', bgColor: 0x001133 },
    [TerrainType.CHASM]: DEFAULT_LOOK,
    [TerrainType.LAVA]: DEFAULT_LOOK,
    [TerrainType.GRASS]: { char: '"', color: '#33aa33', bgColor: 0x113311 },
    [TerrainType.FOLIAGE]: { char: '♠', color: '#228822', bgColor: 0x112211 },
    [TerrainType.BOG]: DEFAULT_LOOK,
    [TerrainType.STAIRS_UP]: { char: '<', color: '#ffaa00', bgColor: 0x222233 },
    [TerrainType.STAIRS_DOWN]: { char: '>', color: '#00aaff', bgColor: 0x222233 },
    [TerrainType.CHARRED_FLOOR]: DEFAULT_LOOK,
    [TerrainType.SIGN]: { char: '§', color: '#ffee88', bgColor: 0x332b11 },
    [TerrainType.RESET_PLATE]: { char: '⊙', color: '#66ccff', bgColor: 0x113344 },
    [TerrainType.TRAP]: { char: '^', color: '#cc4400', bgColor: 0x220800 },
    [TerrainType.SECRET_DOOR]: { char: '#', color: '#555566', bgColor: null },
    [TerrainType.PRESSURE_PLATE]: { char: '_', color: '#44cc44', bgColor: 0x112211 },
    [TerrainType.LOCKED_DOOR]: { char: '+', color: '#dd9933', bgColor: 0x331100 },
    [TerrainType.ALTAR]: { char: '_', color: '#ffffcc', bgColor: 0x443311 },
    [TerrainType.WEB]: { char: '\\', color: '#cccccc', bgColor: 0x222222 },
    [TerrainType.BLOOD]: { char: '%', color: '#aa2222', bgColor: 0x330000 },
    [TerrainType.MUD]: { char: '~', color: '#664422', bgColor: 0x221100 },
    // ── 以下成员全部落在 default（重构前如此，行为逐位保留）──
    [TerrainType.CHASM_EDGE]: DEFAULT_LOOK,       // C-2
    [TerrainType.OBSIDIAN]: DEFAULT_LOOK,         // C-2
    [TerrainType.BRIDGE]: DEFAULT_LOOK,           // C-2
    [TerrainType.BRIDGE_EDGE]: DEFAULT_LOOK,      // C-2
    [TerrainType.INERT_BRIMSTONE]: DEFAULT_LOOK,  // C-2
    [TerrainType.PLAIN_FIRE]: DEFAULT_LOOK,       // F-1（火寿命链无渲染——UI-1 欠账）
    [TerrainType.EMBERS]: DEFAULT_LOOK,           // F-2a（同上）
    [TerrainType.ASH]: DEFAULT_LOOK,              // F-2a（同上）
    [TerrainType.POISON_GAS]: DEFAULT_LOOK,       // G-1（气体视觉走 gasGrid 覆盖层）
    [TerrainType.CONFUSION_GAS]: DEFAULT_LOOK,
    [TerrainType.STEAM]: DEFAULT_LOOK,
    [TerrainType.GAS_FIRE]: DEFAULT_LOOK,         // G-2
    [TerrainType.METHANE_GAS]: DEFAULT_LOOK,      // G-2
    [TerrainType.PARALYSIS_GAS]: DEFAULT_LOOK,    // G-3
    [TerrainType.GAS_EXPLOSION]: DEFAULT_LOOK,    // F-2c
    [TerrainType.HOLE]: DEFAULT_LOOK,             // C-5
    [TerrainType.HOLE_EDGE]: DEFAULT_LOOK,        // C-5
    [TerrainType.FORCEFIELD]: DEFAULT_LOOK,       // B-3
    [TerrainType.FORCEFIELD_MELT]: DEFAULT_LOOK,  // B-3
    [TerrainType.CRYSTAL_WALL]: DEFAULT_LOOK,     // B-3
    [TerrainType.SACRED_GLYPH]: DEFAULT_LOOK,     // B-3
};

/** 造 Cell（terrain 走 setter 写回归属层）。只用于 DUNGEON/SURFACE 层地形。 */
function makeCell(
    terrain: TerrainType,
    opts: { visible?: boolean; explored?: boolean; memory?: boolean } = {},
): Cell {
    const c = new Cell(3, 4);
    c.terrain = terrain;
    c.isVisible = opts.visible ?? false;
    c.isExplored = opts.explored ?? (opts.visible ?? false);
    c.hasMemory = opts.memory ?? false;
    return c;
}

/** 记录型假幻觉随机：percent 依序弹 percents（弹尽返回 false），pick 恒取首项并记录来源序列。 */
interface ScriptedCosmetic extends CosmeticRng {
    percentCalls: number[];
    pickSources: string[];
}
function scriptedCosmetic(percents: boolean[]): ScriptedCosmetic {
    let i = 0;
    return {
        percentCalls: [],
        pickSources: [],
        percent(p: number) {
            this.percentCalls.push(p);
            return percents[i++] ?? false;
        },
        pick<T>(list: readonly T[]): T {
            this.pickSources.push(list === HALLUCINATION_COLORS ? 'colors' : list === HALLUCINATION_CHARS ? 'chars' : 'other');
            return list[0]!;
        },
    };
}

const WHITE_LIGHT: LightCell = { color: { r: 255, g: 255, b: 255 }, intensity: 50 };

function cellCtx(overrides: Partial<CellAppearanceContext> = {}): CellAppearanceContext {
    return { gas: undefined, light: null, hallucinating: false, cosmetic: scriptedCosmetic([]), ...overrides };
}

function entityCtx(overrides: Partial<EntityAppearanceContext> = {}): EntityAppearanceContext {
    return {
        cellVisible: true,
        cellHasMemory: false,
        telepathy: false,
        hallucinating: false,
        cosmetic: scriptedCosmetic([]),
        ...overrides,
    };
}

function gas(type: GasType, density = 100): GasCell {
    return { type, density };
}

/** 轻量 Monster 替身：monsterAppearance 只读 hp/isAlly/state/char/color 五个字段。 */
function makeMonster(overrides: Partial<Pick<Monster, 'hp' | 'isAlly' | 'state' | 'char' | 'color'>> = {}): Monster {
    const base = {
        loc: { x: 1, y: 2 },
        hp: 10,
        isAlly: false,
        state: MonsterState.HUNTING,
        char: 'r',
        color: 0xaa0044,
    };
    return { ...base, ...overrides } as unknown as Monster;
}

// ════════════════════════ terrainAppearance 特征化 ════════════════════════

describe('R-1 terrainAppearance 特征化（穷举钉死）', () => {
    it('穷举表覆盖 TerrainType 全部成员（当前 47 个）、成员值无重复', () => {
        // 成员数变化（新增地形）时此断言翻红——按文件头说明更新期望表。
        expect(ALL_TERRAINS.length).toBe(47);
        expect(new Set(ALL_TERRAINS).size).toBe(ALL_TERRAINS.length);
    });

    it('可见态：每个成员的 {char, color, bgColor} 全等钉死', () => {
        for (const t of ALL_TERRAINS) {
            expect(terrainAppearance(t, true), `TerrainType[${t}] 可见态`).toEqual(EXPECTED_VISIBLE[t]);
        }
    });

    it('不可见（记忆）态：统一变暗 #333333 / 0x111111，字形不变', () => {
        for (const t of ALL_TERRAINS) {
            const visible = EXPECTED_VISIBLE[t];
            expect(terrainAppearance(t, false), `TerrainType[${t}] 不可见态`).toEqual({
                char: visible.char,
                color: '#333333',
                bgColor: visible.bgColor === null ? null : 0x111111,
            });
        }
    });
});

// ════════════════════════ cellAppearance 三态 ════════════════════════

describe('R-1 cellAppearance：未探索 / 可见 / 记忆 三态', () => {
    it('未探索且不可见 → null（什么都不画）', () => {
        expect(cellAppearance(makeCell(TerrainType.FLOOR), cellCtx())).toBeNull();
        expect(cellAppearance(makeCell(TerrainType.STAIRS_DOWN), cellCtx())).toBeNull();
        expect(cellAppearance(makeCell(TerrainType.GRANITE), cellCtx({ hallucinating: true }))).toBeNull();
    });

    it('可见但无光 → 近黑（#222222 / 0x050505）——可见≠亮，这是原行为', () => {
        expect(cellAppearance(makeCell(TerrainType.FLOOR, { visible: true }), cellCtx())).toEqual({
            char: '.', color: '#222222', bgColor: 0x050505,
        });
        expect(cellAppearance(makeCell(TerrainType.DOOR, { visible: true }), cellCtx())).toEqual({
            char: '+', color: '#222222', bgColor: 0x050505,
        });
        // intensity = 0 同样走"无光"分支
        expect(
            cellAppearance(makeCell(TerrainType.DOOR, { visible: true }), cellCtx({ light: { color: { r: 255, g: 0, b: 0 }, intensity: 0 } })),
        ).toEqual({ char: '+', color: '#222222', bgColor: 0x050505 });
    });

    it('可见且有光 → 前景按 intensity×0.8、背景按 intensity×0.5 向光色混合', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ light: WHITE_LIGHT }),
        )!;
        // 期望值按原实现同款 ColorUtils 公式推导（前景 mix 50×0.8=40%，背景 50×0.5=25%）
        const fg = ColorUtils.rgbToHex(ColorUtils.mix(ColorUtils.hexToRGB('#aaaaaa'), WHITE_LIGHT.color, 40));
        const bg = parseInt(ColorUtils.rgbToHex(ColorUtils.mix(ColorUtils.hexToRGB(0x222233), WHITE_LIGHT.color, 25)).replace('#', ''), 16);
        expect(visual).toEqual({ char: '.', color: fg, bgColor: bg });
        // 具体值锚点（防 ColorUtils 一起改导致推导失真）：#aaaaaa+白光40% = #cccccc，bg = 0x595966
        expect(visual.color).toBe('#cccccc');
        expect(visual.bgColor).toBe(0x595966);
    });

    it('记忆态（已探索未可见）普通地形 → #333333 / 0x111111', () => {
        expect(cellAppearance(makeCell(TerrainType.FLOOR, { explored: true, memory: true }), cellCtx())).toEqual({
            char: '.', color: '#333333', bgColor: 0x111111,
        });
    });

    it('记忆态楼梯保持明亮（#ffffff / 0x222222）——原实现的楼梯特例', () => {
        expect(cellAppearance(makeCell(TerrainType.STAIRS_DOWN, { explored: true, memory: true }), cellCtx())).toEqual({
            char: '>', color: '#ffffff', bgColor: 0x222222,
        });
        expect(cellAppearance(makeCell(TerrainType.STAIRS_UP, { explored: true, memory: true }), cellCtx())).toEqual({
            char: '<', color: '#ffffff', bgColor: 0x222222,
        });
    });

    it('已探索但 hasMemory=false 且不可见 → 走 terrainAppearance 的变暗（同一视觉）', () => {
        // 钉死 else-if 结构：memory 分支不触发时仍有基础变暗
        expect(cellAppearance(makeCell(TerrainType.FLOOR, { explored: true, memory: false }), cellCtx())).toEqual({
            char: '.', color: '#333333', bgColor: 0x111111,
        });
    });
});

describe('R-1 cellAppearance：燃烧 / 气体 / 幻觉覆盖', () => {
    it('可见燃烧格（PLAIN_FIRE）无光 → "*" 字形 + 近黑（燃烧色被无光分支压暗，原行为）', () => {
        const visual = cellAppearance(makeCell(TerrainType.PLAIN_FIRE, { visible: true }), cellCtx())!;
        expect(visual.char).toBe('*');
        expect(visual.color).toBe('#222222');
        expect(visual.bgColor).toBe(0x050505);
    });

    it('可见燃烧格 + 光 → "*" + 燃烧色向光色混合', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.PLAIN_FIRE, { visible: true }),
            cellCtx({ light: { color: { r: 255, g: 255, b: 255 }, intensity: 100 } }),
        )!;
        expect(visual.char).toBe('*');
        expect(visual.color).toBe('#ffeecc'); // mix(#ffaa00, white, 80)
        expect(visual.bgColor).toBe(0xe5907f); // mix(0xcc2200, white, 50)
    });

    it('毒气覆盖可见格：bg 0x660066、"~"/#ff55ff（再经光照混合）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.POISON), light: WHITE_LIGHT }),
        )!;
        expect(visual.char).toBe('~');
        expect(visual.color).toBe('#ff99ff'); // mix(#ff55ff, white, 40)
        expect(visual.bgColor).toBe(0x8c3f8c); // mix(0x660066, white, 25)
    });

    it('燃烧 + 毒气并存：bg 仍被毒气覆盖，但字形保住 "*"（!isBurning 守卫）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.PLAIN_FIRE, { visible: true }),
            cellCtx({ gas: gas(GasType.POISON), light: { color: { r: 255, g: 255, b: 255 }, intensity: 100 } }),
        )!;
        expect(visual.char).toBe('*');
        expect(visual.color).toBe('#ffeecc'); // 燃烧色 #ffaa00（不被毒气字形覆盖）
        expect(visual.bgColor).toBe(0xb27fb2); // mix(0x660066, white, 50) —— 毒气 bg 后写生效
    });

    it('四种有渲染分支的气体各就各位（bg 覆盖 + 字形/颜色）', () => {
        const lit = { color: { r: 255, g: 255, b: 255 }, intensity: 100 };
        const combos: Array<[GasType, string, string]> = [
            [GasType.POISON, '~', '#ff55ff'],
            [GasType.STEAM, '*', '#ffffff'],
            [GasType.CONFUSION, '?', '#55ffff'],
            [GasType.CREEPING_DEATH, '~', '#ff4444'],
        ];
        for (const [type, char, color] of combos) {
            const visual = cellAppearance(
                makeCell(TerrainType.FLOOR, { visible: true }),
                cellCtx({ gas: gas(type), light: lit }),
            )!;
            expect(visual.char, `GasType[${type}] 字形`).toBe(char);
            expect(visual.color, `GasType[${type}] 颜色`).toBe(ColorUtils.rgbToHex(ColorUtils.mix(ColorUtils.hexToRGB(color), lit.color, 80)));
        }
        // 对应 bg：POISON 0x660066 / STEAM 0xaaaaaa / CONFUSION 0x006666 / CREEPING_DEATH 0x440000
        const bgs: Array<[GasType, number]> = [
            [GasType.POISON, 0x660066],
            [GasType.STEAM, 0xaaaaaa],
            [GasType.CONFUSION, 0x006666],
            [GasType.CREEPING_DEATH, 0x440000],
        ];
        for (const [type, bg] of bgs) {
            const visual = cellAppearance(
                makeCell(TerrainType.FLOOR, { visible: true }),
                cellCtx({ gas: gas(type), light: lit }),
            )!;
            expect(visual.bgColor, `GasType[${type}] bg`).toBe(parseInt(ColorUtils.rgbToHex(ColorUtils.mix(ColorUtils.hexToRGB(bg), lit.color, 50)).replace('#', ''), 16));
        }
    });

    it('气体 density=0 → 无覆盖（原 if (gas && gas.density > 0) 门）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.POISON, 0), light: WHITE_LIGHT }),
        )!;
        expect(visual.char).toBe('.');
        expect(visual.bgColor).toBe(0x595966); // 与"无气体+白光"完全一致
    });

    it('PARALYSIS/METHANE 气体没有渲染分支（现状钉死——UI-1 欠账，勿当回归修）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.PARALYSIS, 999), light: WHITE_LIGHT }),
        )!;
        expect(visual).toEqual({ char: '.', color: '#cccccc', bgColor: 0x595966 });
    });

    it('幻觉：percent(15) 中 → 取幻觉色/字形（发生在无光压暗之后）；不中 → 原样', () => {
        const hit = scriptedCosmetic([true]);
        const visual = cellAppearance(makeCell(TerrainType.FLOOR, { visible: true }), cellCtx({ hallucinating: true, cosmetic: hit }))!;
        expect(hit.percentCalls).toEqual([15]);
        expect(hit.pickSources).toEqual(['colors', 'chars']); // 先色后字
        expect(visual.char).toBe('*'); // HALLUCINATION_CHARS[0]
        expect(visual.color).toBe('#ff66ff'); // HALLUCINATION_COLORS[0]，盖过无光的 #222222

        const miss = scriptedCosmetic([false]);
        const plain = cellAppearance(makeCell(TerrainType.FLOOR, { visible: true }), cellCtx({ hallucinating: true, cosmetic: miss }))!;
        expect(miss.percentCalls).toEqual([15]);
        expect(miss.pickSources).toEqual([]);
        expect(plain).toEqual({ char: '.', color: '#222222', bgColor: 0x050505 });
    });

    it('不可见格不消耗幻觉掷骰（记忆分支零 cosmetic 调用）', () => {
        const cos = scriptedCosmetic([true, true, true]);
        cellAppearance(makeCell(TerrainType.FLOOR, { explored: true, memory: true }), cellCtx({ hallucinating: true, cosmetic: cos }));
        expect(cos.percentCalls).toEqual([]);
    });
});

// ════════════════════════ entityAppearance 三类实体 ════════════════════════

describe('R-1 entityAppearance：物品', () => {
    const item = new Item('测试物品', '!', 0xff00ff, ItemCategory.POTION);

    it('可见常态 → 原字形原色、interactive', () => {
        expect(itemAppearance(item, entityCtx())).toEqual({ char: '!', color: 0xff00ff, interactive: true });
    });

    it('幻觉双掷怪癖：两次独立 percent(30)——[中,不中] = "!" 配原色（逐位保留）', () => {
        const cos = scriptedCosmetic([true, false]);
        const visual = itemAppearance(item, entityCtx({ hallucinating: true, cosmetic: cos }))!;
        expect(cos.percentCalls).toEqual([30, 30]);
        expect(cos.pickSources).toEqual([]);
        expect(visual).toEqual({ char: '!', color: 0xff00ff, interactive: true });
    });

    it('幻觉双掷：[不中,中] = 原字形配幻觉色', () => {
        const cos = scriptedCosmetic([false, true]);
        const visual = itemAppearance(item, entityCtx({ hallucinating: true, cosmetic: cos }))!;
        expect(visual).toEqual({ char: '!', color: '#ff66ff', interactive: true });
        expect(cos.pickSources).toEqual(['colors']);
    });

    it('幻觉双掷：[中,中] = "!" 配幻觉色', () => {
        const cos = scriptedCosmetic([true, true]);
        expect(itemAppearance(item, entityCtx({ hallucinating: true, cosmetic: cos }))!).toEqual({
            char: '!', color: '#ff66ff', interactive: true,
        });
    });

    it('非幻觉不掷骰', () => {
        const cos = scriptedCosmetic([]);
        itemAppearance(item, entityCtx({ hallucinating: false, cosmetic: cos }));
        expect(cos.percentCalls).toEqual([]);
    });

    it('记忆态物品 → 原字形 #666666、不 interactive', () => {
        expect(itemAppearance(item, entityCtx({ cellVisible: false, cellHasMemory: true }))).toEqual({
            char: '!', color: '#666666', interactive: false,
        });
    });

    it('不可见且无记忆 → null', () => {
        expect(itemAppearance(item, entityCtx({ cellVisible: false, cellHasMemory: false }))).toBeNull();
    });
});

describe('R-1 entityAppearance：怪物', () => {
    it('hp ≤ 0 → null（死怪不画）', () => {
        expect(monsterAppearance(makeMonster({ hp: 0 }), entityCtx())).toBeNull();
        expect(monsterAppearance(makeMonster({ hp: -3 }), entityCtx({ cellVisible: true }))).toBeNull();
    });

    it('可见常态 → 原字形原色、interactive', () => {
        expect(monsterAppearance(makeMonster(), entityCtx())).toEqual({ char: 'r', color: 0xaa0044, interactive: true });
    });

    it('盟友 → #88ff88；睡眠 → 0x6688aa（数字字面量，逐位保留）', () => {
        expect(monsterAppearance(makeMonster({ isAlly: true }), entityCtx())!.color).toBe('#88ff88');
        const asleep = monsterAppearance(makeMonster({ state: MonsterState.ASLEEP }), entityCtx())!;
        expect(asleep.color).toBe(0x6688aa);
        expect(typeof asleep.color).toBe('number');
        // 盟友优先于睡眠（原 if / else if 结构）
        expect(monsterAppearance(makeMonster({ isAlly: true, state: MonsterState.ASLEEP }), entityCtx())!.color).toBe('#88ff88');
    });

    it('幻觉：单次 percent(35)，中 → 先取色再取字', () => {
        const cos = scriptedCosmetic([true]);
        const visual = monsterAppearance(makeMonster(), entityCtx({ hallucinating: true, cosmetic: cos }))!;
        expect(cos.percentCalls).toEqual([35]);
        expect(cos.pickSources).toEqual(['colors', 'chars']);
        expect(visual).toEqual({ char: '*', color: '#ff66ff', interactive: true });
    });

    it('幻觉不中 → 原样（但 percent 仍被消耗一次）', () => {
        const cos = scriptedCosmetic([false]);
        expect(monsterAppearance(makeMonster(), entityCtx({ hallucinating: true, cosmetic: cos }))!).toEqual({
            char: 'r', color: 0xaa0044, interactive: true,
        });
        expect(cos.percentCalls).toEqual([35]);
    });

    it('不可见 + 心灵感应 → #66ccff 剪影、不 interactive', () => {
        expect(monsterAppearance(makeMonster(), entityCtx({ cellVisible: false, telepathy: true }))).toEqual({
            char: 'r', color: '#66ccff', interactive: false,
        });
    });

    it('不可见 + 无心灵感应 → null', () => {
        expect(monsterAppearance(makeMonster(), entityCtx({ cellVisible: false, telepathy: false }))).toBeNull();
    });
});

describe('R-1 entityAppearance：玩家与统一入口', () => {
    it("玩家恒 '@' + #ffcc00、不 interactive", () => {
        expect(playerAppearance(new Player(5, 5))).toEqual({ char: '@', color: '#ffcc00', interactive: false });
    });

    it('entityAppearance 按实体类型正确分流', () => {
        const item = new Item('coin', '$', 0xffff00, ItemCategory.GOLD);
        const ctx = entityCtx();
        expect(entityAppearance(item, ctx)).toEqual(itemAppearance(item, ctx));
        expect(entityAppearance(makeMonster(), ctx)).toEqual(monsterAppearance(makeMonster(), ctx));
        expect(entityAppearance(new Player(1, 1), ctx)).toEqual(playerAppearance(new Player(1, 1)));
    });

    it('entityAppearance 对死怪同样返回 null', () => {
        expect(entityAppearance(makeMonster({ hp: 0 }), entityCtx())).toBeNull();
    });
});

// ════════════════════════ 结构守卫 ════════════════════════

describe('R-1 结构守卫：GameCanvas.vue 不得再出现外观决策', () => {
    const src = readFileSync(new URL('../components/GameCanvas.vue', import.meta.url), 'utf8');
    const templateIdx = src.indexOf('<template>');
    const scriptRegion = src.slice(0, templateIdx); // 两个 <script> 块（模板/样式在外）
    const setupIdx = src.indexOf('<script setup');
    const setupRegion = src.slice(setupIdx, templateIdx);

    it('颜色字面量多重集 == 豁免清单（逐条有理由，新增即红）', () => {
        const literals = (scriptRegion.match(/#[0-9a-fA-F]{6}\b|0x[0-9a-fA-F]{6}\b/g) ?? []).sort();
        // 豁免清单——全部是"绘制原语的静态底样式/画布清屏色"，不是格子/实体外观决策：
        //  0x111111 ×1  Pixi Application 画布清屏色（整幅画布的底，非任何一格的颜色）
        //  '#ffffff' ×2  Text sprite 与浮字的初始 fill（中性占位，每帧被 visual.color / ft.color 覆盖）
        //  '#ffff00' ×2  箭矢投射物 sprite 的初始 fill 与 dropShadow 色（每帧被 boltFrame 颜色覆盖）
        //  '#000000' ×1  浮字描边底色（每帧文字颜色来自 ft.color，描边本身是绘制原语）
        expect(literals).toEqual(['#000000', '#ffff00', '#ffff00', '#ffffff', '#ffffff', '0x111111']);
    });

    it('没有字形字面量的 switch/case 分支（terrain 决策 switch 已迁出）', () => {
        expect((scriptRegion.match(/case '/g) ?? []).length).toBe(0);
    });

    it('决策 API 不得回流：TerrainType/GasType/MonsterState/ColorUtils/getTerrainVisual 零引用', () => {
        for (const marker of ['getTerrainVisual', 'TerrainType', 'GasType', 'MonsterState', 'ColorUtils']) {
            expect(scriptRegion.includes(marker), `script 区出现 "${marker}"`).toBe(false);
        }
    });

    it('render 里不得直接掷幻觉骰（只能经 ctx 注入 cosmeticPercent/cosmeticPick）', () => {
        expect((setupRegion.match(/cosmeticPercent\s*\(/g) ?? []).length).toBe(0);
        expect((setupRegion.match(/cosmeticPick\s*\(/g) ?? []).length).toBe(0);
        // 注入点必须在：外观函数从 ctx 拿到它们
        expect(setupRegion.includes('percent: cosmeticPercent')).toBe(true);
        expect(setupRegion.includes('pick: cosmeticPick')).toBe(true);
    });

    it('渲染必须经 Appearance 纯函数（防拆掉缝后手写决策）', () => {
        expect(scriptRegion.includes('engine/UI/Appearance')).toBe(true);
        for (const fn of ['cellAppearance(', 'itemAppearance(', 'monsterAppearance(', 'playerAppearance(']) {
            expect(setupRegion.includes(fn), `setup 区缺少 ${fn} 调用`).toBe(true);
        }
    });

    it('setup 区不得出现字形字面量赋值（char = "♠" 这类回流形态）', () => {
        expect((setupRegion.match(/\bchar\s*=\s*['"]/g) ?? []).length).toBe(0);
        for (const glyph of ['♠', '§', '⊙']) {
            expect(setupRegion.includes(glyph), `setup 区出现字形 "${glyph}"`).toBe(false);
        }
    });

    it('Appearance.ts 自身保持纯净：不 import 全局游戏单例', () => {
        const appearanceSrc = readFileSync(new URL('../engine/UI/Appearance.ts', import.meta.url), 'utf8');
        expect(appearanceSrc.includes('activeGame')).toBe(false);
        expect(appearanceSrc.includes('Core/Game')).toBe(false);
    });
});
