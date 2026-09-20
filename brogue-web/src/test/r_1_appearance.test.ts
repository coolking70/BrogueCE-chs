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
import type { LightChannels } from '../engine/Lighting/LightMap';
import {
    terrainAppearance,
    cellAppearance,
    itemAppearance,
    monsterAppearance,
    playerAppearance,
    entityAppearance,
    HALLUCINATION_COLORS,
    HALLUCINATION_CHARS,
    G_FIRE_CHAR,
    G_ASHES_CHAR,
    FIRE_FORE_COLOR,
    ASH_FORE_COLOR,
    PARALYSIS_GAS_BG,
    METHANE_GAS_BG,
    PARALYSIS_GAS_FG,
    METHANE_GAS_FG,
    GAS_OVERLAY_CHAR,
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
    // ── UI-1 第 1 条（2026-09-18 反转：火寿命链已有 CE 外观，不再是 default）──
    [TerrainType.PLAIN_FIRE]: { char: G_FIRE_CHAR, color: FIRE_FORE_COLOR, bgColor: null },   // F-1 落地，UI-1 反转
    [TerrainType.EMBERS]: { char: G_ASHES_CHAR, color: FIRE_FORE_COLOR, bgColor: null },      // F-2a 落地，UI-1 反转
    [TerrainType.ASH]: { char: G_ASHES_CHAR, color: ASH_FORE_COLOR, bgColor: null },          // F-2a 落地，UI-1 反转
    // ── 以下成员仍走 default（R-1 时如此；GAS_FIRE/GAS_EXPLOSION 同属 UI-1
    // 反转——CE 里它们与 PLAIN_FIRE 同为 G_FIRE + fireForeColor）──
    [TerrainType.GAS_FIRE]: { char: G_FIRE_CHAR, color: FIRE_FORE_COLOR, bgColor: null },     // G-2，UI-1 反转
    [TerrainType.GAS_EXPLOSION]: { char: G_FIRE_CHAR, color: FIRE_FORE_COLOR, bgColor: null },// F-2c，UI-1 反转
    [TerrainType.POISON_GAS]: DEFAULT_LOOK,       // G-1（气体视觉走 gasGrid 覆盖层）
    [TerrainType.CONFUSION_GAS]: DEFAULT_LOOK,
    [TerrainType.STEAM]: DEFAULT_LOOK,
    [TerrainType.METHANE_GAS]: DEFAULT_LOOK,      // G-2（气体视觉走 gasGrid 覆盖层）
    [TerrainType.PARALYSIS_GAS]: DEFAULT_LOOK,    // G-3（同上）
    [TerrainType.CHASM_EDGE]: DEFAULT_LOOK,       // C-2
    [TerrainType.OBSIDIAN]: DEFAULT_LOOK,         // C-2
    [TerrainType.BRIDGE]: DEFAULT_LOOK,           // C-2
    [TerrainType.BRIDGE_EDGE]: DEFAULT_LOOK,      // C-2
    [TerrainType.INERT_BRIMSTONE]: DEFAULT_LOOK,  // C-2
    [TerrainType.HOLE]: DEFAULT_LOOK,             // C-5
    [TerrainType.HOLE_EDGE]: DEFAULT_LOOK,        // C-5
    [TerrainType.FORCEFIELD]: DEFAULT_LOOK,       // B-3
    [TerrainType.FORCEFIELD_MELT]: DEFAULT_LOOK,  // B-3
    [TerrainType.CRYSTAL_WALL]: DEFAULT_LOOK,     // B-3
    [TerrainType.SACRED_GLYPH]: DEFAULT_LOOK,     // B-3
    // V-2b-2b 六条：机器蓝图地形载体，terrainAppearance 尚无专属分支
    //（CE 外观接线归 UI 轮，与 C-2/B-3 的 DEFAULT_LOOK 欠账同登记）。
    // 本文件不在 V-2b-2b 任务书 §6 授权清单——Record<TerrainType> 结构性
    // 穷尽表不加成员连 npm run build 都无法通过，机械补齐，报告已申报。
    [TerrainType.CARPET]: DEFAULT_LOOK,             // V-2b-2b
    [TerrainType.STATUE_INERT]: DEFAULT_LOOK,       // V-2b-2b
    [TerrainType.PEDESTAL]: DEFAULT_LOOK,           // V-2b-2b
    [TerrainType.STATUE_INERT_DOORWAY]: DEFAULT_LOOK, // V-2b-2b
    [TerrainType.WOODEN_BARRICADE]: DEFAULT_LOOK,   // V-2b-2b
    [TerrainType.TRAP_DOOR_HIDDEN]: DEFAULT_LOOK,   // V-2b-2b
    // V-2b-3 九条：wired 触发网络载体，terrainAppearance 尚无专属分支
    //（CE 外观接线归 UI 轮，同上 DEFAULT_LOOK 欠账登记）。
    [TerrainType.MACHINE_GLYPH]: DEFAULT_LOOK,              // V-2b-3
    [TerrainType.PORTCULLIS_CLOSED]: DEFAULT_LOOK,          // V-2b-3
    [TerrainType.WORM_TUNNEL_OUTER_WALL]: DEFAULT_LOOK,     // V-2b-3
    [TerrainType.WALL_LEVER_HIDDEN]: DEFAULT_LOOK,          // V-2b-3
    [TerrainType.GAS_TRAP_PARALYSIS]: DEFAULT_LOOK,         // V-2b-3
    [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: DEFAULT_LOOK,  // V-2b-3
    [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: DEFAULT_LOOK, // V-2b-3
    [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: DEFAULT_LOOK,   // V-2b-3
    [TerrainType.PILOT_LIGHT_DORMANT]: DEFAULT_LOOK,        // V-2b-3
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

/** CE 量级的满强白光三通道（矿灯色 {180,180,180} 一类；乘数 1.0 的Identity 光）。 */
const IDENTITY_LIGHT: LightChannels = { r: 100, g: 100, b: 100 };

function cellCtx(overrides: Partial<CellAppearanceContext> = {}): CellAppearanceContext {
    return {
        gas: undefined,
        lightChannels: null,
        groundItem: null,
        carriedItem: null,
        hallucinating: false,
        cosmetic: scriptedCosmetic([]),
        ...overrides,
    };
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
    it('穷举表覆盖 TerrainType 全部成员（当前 62 个）、成员值无重复', () => {
        // 成员数变化（新增地形）时此断言翻红——按文件头说明更新期望表。
        // V-2b-2b：+6（CARPET/STATUE_INERT/PEDESTAL/STATUE_INERT_DOORWAY/
        // WOODEN_BARRICADE/TRAP_DOOR_HIDDEN），47 → 53。
        // V-2b-3：+9（MACHINE_GLYPH/PORTCULLIS_CLOSED/WORM_TUNNEL_OUTER_WALL/
        // WALL_LEVER_HIDDEN/GAS_TRAP_PARALYSIS/_HIDDEN/MACHINE_PARALYSIS_VENT_
        // HIDDEN/MACHINE_METHANE_VENT_HIDDEN/PILOT_LIGHT_DORMANT），53 → 62。
        expect(ALL_TERRAINS.length).toBe(62);
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
        // 全零通道同样走"无光"分支
        expect(
            cellAppearance(makeCell(TerrainType.DOOR, { visible: true }), cellCtx({ lightChannels: { r: 0, g: 0, b: 0 } })),
        ).toEqual({ char: '+', color: '#222222', bgColor: 0x050505 });
    });

    it('可见但有光 → CE 逐通道乘法：{100,100,100} 是恒等乘数，颜色原样', () => {
        // UI-1 第 7 条反转：旧实现是向光色按 intensity×0.8/0.5 混合；
        // 现在是 CE applyColorMultiplier（IO.c:1517-1530），乘数 =
        // adjustedLightValue(通道)/100——{100,100,100} 时乘数恰为 1。
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(visual).toEqual({ char: '.', color: '#aaaaaa', bgColor: 0x222233 });
    });

    it('可见但弱光 → 逐通道线性变暗（trunc(base*50/100)），不再被抬向光色', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ lightChannels: { r: 50, g: 50, b: 50 } }),
        )!;
        expect(visual.color).toBe('#555555');  // trunc(170*50/100)=85
        expect(visual.bgColor).toBe(0x111119); // (34,34,51)→(17,17,25)
    });

    it('过亮光（>100）先平方根压回再乘，颜色向饱和抬升——旧混合公式给不出的效果', () => {
        // adjusted(180) = trunc(sqrt(180/150)*150) = 164（IO.c:1732-1737）
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ lightChannels: { r: 180, g: 180, b: 180 } }),
        )!;
        expect(visual.color).toBe('#ffffff');  // trunc(170*164/100)=278 → 钳 255
        expect(visual.bgColor).toBe(0x373753); // 34*164/100=55, 51*164/100=83
    });

    it('有色光是逐通道的：红通道亮、绿蓝通道灭 → 基色只剩红（混向单色的旧公式必红）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ lightChannels: { r: 100, g: 20, b: 0 } }),
        )!;
        expect(visual.color).toBe('#aa2200'); // (170*1, 170*0.2, 170*0) → (170,34,0)
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
    it('可见燃烧格（PLAIN_FIRE）无光 → CE 火字形压暗、无底色（UI-1 反转：不再有 "*" 覆盖层）', () => {
        const visual = cellAppearance(makeCell(TerrainType.PLAIN_FIRE, { visible: true }), cellCtx())!;
        expect(visual.char).toBe(G_FIRE_CHAR);
        expect(visual.color).toBe('#222222');
        expect(visual.bgColor).toBeNull(); // CE PLAIN_FIRE backColor = 0，无光分支不改 null
    });

    it('可见燃烧格 + 恒等光 → "*" 覆盖层已移除，CE 火外观原样可见（UI-1 反转）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.PLAIN_FIRE, { visible: true }),
            cellCtx({ lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(visual.char).toBe(G_FIRE_CHAR);
        expect(visual.color).toBe(FIRE_FORE_COLOR);
        expect(visual.bgColor).toBeNull(); // CE PLAIN_FIRE backColor = 0
    });

    it('毒气覆盖可见格：bg 0x660066、"~"/#ff55ff（恒等光下原样）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.POISON), lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(visual.char).toBe('~');
        expect(visual.color).toBe('#ff55ff');
        expect(visual.bgColor).toBe(0x660066);
    });

    it('燃烧格 + 毒气并存：bg 仍被毒气覆盖，但字形保住火字形（!isBurning 守卫；UI-1 后字形 = CE 火字形）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.PLAIN_FIRE, { visible: true }),
            cellCtx({ gas: gas(GasType.POISON), lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(visual.char).toBe(G_FIRE_CHAR);
        expect(visual.color).toBe(FIRE_FORE_COLOR); // 火前景不被毒气字形覆盖
        expect(visual.bgColor).toBe(0x660066);      // 毒气 bg 后写生效
    });

    it('六种气体各就各位（bg 覆盖 + 字形/颜色；PARALYSIS/METHANE 为 UI-1 第 4 条反转）', () => {
        const combos: Array<[GasType, string, string, number]> = [
            [GasType.POISON, '~', '#ff55ff', 0x660066],
            [GasType.STEAM, '*', '#ffffff', 0xaaaaaa],
            [GasType.CONFUSION, '?', '#55ffff', 0x006666],
            [GasType.CREEPING_DEATH, '~', '#ff4444', 0x440000],
            [GasType.PARALYSIS, GAS_OVERLAY_CHAR, PARALYSIS_GAS_FG, PARALYSIS_GAS_BG],
            [GasType.METHANE, GAS_OVERLAY_CHAR, METHANE_GAS_FG, METHANE_GAS_BG],
        ];
        for (const [type, char, color, bg] of combos) {
            const visual = cellAppearance(
                makeCell(TerrainType.FLOOR, { visible: true }),
                cellCtx({ gas: gas(type), lightChannels: IDENTITY_LIGHT }),
            )!;
            expect(visual.char, `GasType[${type}] 字形`).toBe(char);
            expect(visual.color, `GasType[${type}] 颜色`).toBe(color);
            expect(visual.bgColor, `GasType[${type}] bg`).toBe(bg);
        }
    });

    it('气体 density=0 → 无覆盖（原 if (gas && gas.density > 0) 门）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.POISON, 0), lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(visual.char).toBe('.');
        expect(visual.color).toBe('#aaaaaa'); // 与"无气体+恒等光"完全一致
        expect(visual.bgColor).toBe(0x222233);
    });

    it('PARALYSIS/METHANE 气体现在有渲染分支（UI-1 第 4 条反转旧留痕：此前钉死"无分支"）', () => {
        // 旧留痕断言（R-1 时）："PARALYSIS/METHANE 气体没有渲染分支（现状钉死——UI-1 欠账）"
        // UI-1 偿还该欠账，按「留痕反转」改为断言新事实。
        for (const type of [GasType.PARALYSIS, GasType.METHANE]) {
            const visual = cellAppearance(
                makeCell(TerrainType.FLOOR, { visible: true }),
                cellCtx({ gas: gas(type, 999), lightChannels: IDENTITY_LIGHT }),
            )!;
            expect(visual.char, `GasType[${type}]`).not.toBe('.');
            expect(visual.bgColor, `GasType[${type}]`).not.toBe(0x222233);
        }
        // 燃烧格上气体字形让位（!isBurning 守卫在两个新分支同样生效）
        const onFire = cellAppearance(
            makeCell(TerrainType.GAS_FIRE, { visible: true }),
            cellCtx({ gas: gas(GasType.METHANE, 999), lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(onFire.char).toBe(G_FIRE_CHAR);
        expect(onFire.bgColor).toBe(METHANE_GAS_BG);
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
