/**
 * UI-1（渲染欠账偿还轮）七条逐条验收测试。
 *
 * 每条都设计为能被一个**具体的、合理的错误实现**打红（对抗性），
 * 错误实现写在各 it 的注释里。反向验证记录见 ai_docs/UI-1_report.md。
 *
 * CE 事实锚点（2026-09-18 逐条回源核对，行号 = BrogueCE-master/src/brogue/）：
 *  - 火焰三态字形/颜色：Globals.c:461/469/492 + Globals.c:136/157（颜色 0-100 标度）
 *    + platform/platformdependent.c:123/173（字形）+ web-platform.c:170-175（×255/100 截断）。
 *  - 燃烧怪物 = 光不是字形：Light.c:250（BURNING_CREATURE_LIGHT，仅非 MONST_FIERY），
 *    位于 updateLighting()（玩法光，Time.c:894）——引擎侧已由 C-7 接上
 *    （Game.updateVision 的 paintBurning，commit 6c3a34a）；行为面钉死在
 *    i_1_interaction.test.ts（I-1）。本文件保留的只是**形式守卫**：
 *    外观层永不读燃烧态（发光 ≠ 染色，UI-1 §3.5 用户裁决）。
 *  - 探测魔法符号：IO.c:1215-1245（分支顺序 HAS_PLAYER → 探测物 → HAS_MONSTER）、
 *    IO.c:1120-1121（monsterWithDetectedItem 定义，含 !canSeeMonster）、
 *    platform/platformdependent.c:125/131/132（G_AMULET/G_GOOD_MAGIC/G_BAD_MAGIC）、
 *    Globals.c:278/279（good/badMessageColor）、Rogue.h:1278（playerCanSeeOrSense）。
 *  - 气体颜色：Globals.c:506/507（PARALYSIS_GAS backColor=&pink、METHANE_GAS backColor=
 *    &methaneColor）+ GlobalsBase.c:100 + Globals.c:254。
 *  - 状态空名：Globals.c:1794-1821（statusEffectCatalog）+ IO.c:4823（name[0] 门）。
 *  - 确认框：IO.c:2946-2975（Enter=Yes / Esc+ACKNOWLEDGE_KEY=No / 回放直接放行）。
 *  - 光照乘法：IO.c:1434-1437（applyColorMultiplier 前景/背景各一次）、
 *    IO.c:1517-1530（乘法定义）、IO.c:1732-1737 + Rogue.h:180（adjustedLightValue，
 *    LIGHT_SMOOTHING_THRESHOLD=150）。
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { TerrainType, Cell } from '../engine/Map/Grid';
import { GasType, type GasCell } from '../engine/Environment/Gas';
import type { LightChannels } from '../engine/Lighting/LightMap';
import {
    cellAppearance,
    monsterAppearance,
    G_FIRE_CHAR,
    G_ASHES_CHAR,
    FIRE_FORE_COLOR,
    ASH_FORE_COLOR,
    G_GOOD_MAGIC_CHAR,
    G_BAD_MAGIC_CHAR,
    G_AMULET_CHAR,
    GOOD_MAGIC_COLOR,
    BAD_MAGIC_COLOR,
    AMULET_MAGIC_COLOR,
    PARALYSIS_GAS_BG,
    METHANE_GAS_BG,
    PARALYSIS_GAS_FG,
    METHANE_GAS_FG,
    GAS_OVERLAY_CHAR,
    type CellAppearanceContext,
    type CosmeticRng,
} from '../engine/UI/Appearance';
import { isSidebarVisibleStatus, CE_EMPTY_NAME_STATUSES } from '../engine/Status/statusConfig';
import { Item, ItemCategory } from '../engine/Items/Item';
import { MonsterState, type Monster } from '../entities/Monster';
import type { Game } from '../engine/Core/Game';
import ceTerrainGoldens from './fixtures/u21c-ce-terrain.json';

// App.vue 的模块依赖链（GameCanvas → Input 单例）在模块加载期访问 window——
// headless 下先 stub 再动态导入（p2_0 同款做法）。wireConfirmRequest 是纯逻辑，
// 不依赖 window 存在；各用例按需重 stub 带 confirm 的 window。
let wireConfirmRequest: (game: Game) => void;
beforeAll(async () => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    const mod = await import('../App.vue');
    wireConfirmRequest = mod.wireConfirmRequest;
});

// ════════════════════════ 工具 ════════════════════════

const noopCosmetic: CosmeticRng = { percent: () => false, pick: (l) => l[0]! };

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

function gas(type: GasType, density = 100): GasCell {
    return { type, density };
}

function cellCtx(overrides: Partial<CellAppearanceContext> = {}): CellAppearanceContext {
    return {
        gas: undefined,
        lightChannels: null,
        groundItem: null,
        carriedItem: null,
        hallucinating: false,
        cosmetic: noopCosmetic,
        ...overrides,
    };
}

const IDENTITY_LIGHT: LightChannels = { r: 100, g: 100, b: 100 };
const floor = ceTerrainGoldens.FLOOR;
const lightColor = (hex: string, channels: readonly number[]) => '#' + [0, 1, 2].map((i) => {
    const base = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    const level = Math.max(0, channels[i]!);
    const adjusted = level > 150 ? Math.trunc(Math.sqrt(level / 150) * 150) : level;
    return Math.min(255, Math.trunc(base * adjusted / 100)).toString(16).padStart(2, '0');
}).join('');
const lightBg = (value: number, channels: readonly number[]) => parseInt(lightColor('#' + value.toString(16).padStart(6, '0'), channels).slice(1), 16);

/**
 * 造探测态物品。极性按 CE Items.c:8267-8299 的实例分支取值：
 * WEAPON enchantment>0 → +1；<0（或诅咒）→ -1；0 → 0；AMULET 恒 +1（但走护符特例符号）。
 * 表查类（药水/卷轴）依赖 ItemLoader.MAGIC_POLARITY 静态表，单测避开它们。
 */
function detectedWeapon(enchantment: number, category: ItemCategory = ItemCategory.WEAPON): Item {
    const it = new Item('测试武器', '/', 0xffffff, category);
    it.enchantment = enchantment;
    it.magicDetected = true;
    return it;
}

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

// ════════════════════════ 第 1 条：火焰三态 ════════════════════════

describe('UI-1 第 1 条：EMBERS / ASH / PLAIN_FIRE 的 CE 渲染', () => {
    it('三态字形：PLAIN_FIRE（与 GAS_FIRE/GAS_EXPLOSION）= G_FIRE，ASH/EMBERS 同为 G_ASHES', () => {
        // 错误实现 A：给 ASH 单独发明字形（CE 两态同字形，Globals.c:461/469 第 1 列）
        expect(terrainOf(TerrainType.PLAIN_FIRE).char).toBe(G_FIRE_CHAR);
        expect(terrainOf(TerrainType.GAS_FIRE).char).toBe(G_FIRE_CHAR);
        expect(terrainOf(TerrainType.GAS_EXPLOSION).char).toBe(G_FIRE_CHAR);
        expect(terrainOf(TerrainType.ASH).char).toBe(G_ASHES_CHAR);
        expect(terrainOf(TerrainType.EMBERS).char).toBe(G_ASHES_CHAR);
    });

    it('对抗：ASH 与 EMBERS 同字形但**颜色不同**——ashForeColor ≠ fireForeColor（抄错/抄同即红）', () => {
        // CE：EMBERS 用 fireForeColor {70,20,0}，ASH 用 ashForeColor {20,20,20}（Globals.c:469/461 第 2 列）
        const embers = terrainOf(TerrainType.EMBERS);
        const ash = terrainOf(TerrainType.ASH);
        expect(embers.char).toBe(ash.char);
        expect(embers.color).toBe(FIRE_FORE_COLOR);
        expect(ash.color).toBe(ASH_FORE_COLOR);
        expect(embers.color).not.toBe(ash.color);
        // 均不画底色（CE 三态 backColor 均为 0）
        expect(embers.bgColor).toBeNull();
        expect(ash.bgColor).toBeNull();
        expect(terrainOf(TerrainType.PLAIN_FIRE).bgColor).toBeNull();
    });

    it('对抗：字形/颜色值逐字符等于 CE 原值（⧲ U+29F2 一族抄成 ASCII 替代品即红）', () => {
        expect(G_FIRE_CHAR).toBe('\u22CF');       // U_FLIPPED_V（platform.h:6）
        expect(G_ASHES_CHAR).toBe("'");           // glyphToUnicode 直返 '\''（platformdependent.c:173）
        expect(FIRE_FORE_COLOR).toBe('#b23300');  // (70,20,0)*255/100 截断（web-platform.c:170-175）
        expect(ASH_FORE_COLOR).toBe('#333333');   // (20,20,20)*255/100
    });

    function terrainOf(t: TerrainType) {
        return cellAppearance(makeCell(t, { visible: true }), cellCtx({ lightChannels: IDENTITY_LIGHT }))!;
    }
});

// ════════════════ 第 2 条：燃烧怪物（留痕已反转：C-7 接上光，I-1 钉行为）════════════════

describe('UI-1 第 2 条：燃烧怪物——CE 是发光不是改字形（光已在 C-7 接线；I-1 补行为钉死）', () => {
    it('燃烧状态不改变怪物外观（谁在这里加"燃烧染色"谁红——CE 没有这种机制）', () => {
        // CE Light.c:250：燃烧怪的视觉是 paintLight(BURNING_CREATURE_LIGHT)，
        // getCellAppearance 不读 STATUS_BURNING——字形/颜色零变化。
        // 【留痕反转记录，I-1】原断言名"引擎侧 deferral"已过期：引擎侧的
        // paintBurning 已由 C-7（commit 6c3a34a）接进 Game.updateVision，
        // 行为面（光网格含火光、FIERY 不叠加）由 i_1_interaction.test.ts 钉死。
        // 本断言是**形式守卫**，激活后必须保持绿：外观函数依旧不读燃烧态，
        // 光只在 lightGrid 里生效——染色是 CE 没有的东西，UI-1 明令禁止。
        const ctx = {
            cellVisible: true, cellHasMemory: false, telepathy: false,
            hallucinating: false, cosmetic: noopCosmetic,
        };
        const plain = makeMonster();
        const burning = {
            ...plain,
            statusDurations: { burning: 7 },
        } as unknown as Monster;
        expect(monsterAppearance(burning, ctx)).toEqual(monsterAppearance(plain, ctx));
    });

    it('对抗（结构面）：monsterAppearance 的代码里没有燃烧分支（cellAppearance 的 !isBurning 气体守卫不算）', () => {
        const src = readFileSync(new URL('../engine/UI/Appearance.ts', import.meta.url), 'utf8');
        const start = src.indexOf('export function monsterAppearance');
        const end = src.indexOf('export function', start + 1);
        expect(start).toBeGreaterThan(0);
        const codeOnly = src.slice(start, end)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
        expect(codeOnly).not.toMatch(/burning|BURNING/);
    });
});

// ════════════════════════ 第 3 条：探测魔法符号 ════════════════════════

describe('UI-1 第 3 条：探魔符号——两支守卫析取、符号按极性、分支顺序', () => {
    it('左支：看不见的格上有已探测的善意物品 → G_GOOD_MAGIC + goodMessageColor', () => {
        // 错误实现：符号抄成字形对颜色错（bad/good 互换）或抄成 AMULET 符号
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: false, explored: true, memory: true }),
            cellCtx({ groundItem: detectedWeapon(+2) }),
        )!;
        expect(visual.char).toBe(G_GOOD_MAGIC_CHAR);
        expect(visual.color).toBe(GOOD_MAGIC_COLOR);
    });

    it('左支：恶意物品 → G_BAD_MAGIC + badMessageColor；不做记忆变暗（CE IO.c:1349-1359 "do nothing"）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: false, explored: true, memory: true }),
            cellCtx({ groundItem: detectedWeapon(-2) }),
        )!;
        expect(visual.char).toBe(G_BAD_MAGIC_CHAR);
        expect(visual.color).toBe(BAD_MAGIC_COLOR);
        // 有记忆的不可见格本应 #333333——符号格保持全亮
        expect(visual.color).not.toBe('#333333');
    });

    it('护符特例：已探测护符 → G_AMULET + white（优先于极性分支，CE IO.c:1229-1231）', () => {
        const amulet = new Item('护符', ',', 0xffffff, ItemCategory.AMULET);
        amulet.magicDetected = true;
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: false, explored: true }),
            cellCtx({ groundItem: amulet }),
        )!;
        expect(visual.char).toBe(G_AMULET_CHAR);
        expect(visual.color).toBe(AMULET_MAGIC_COLOR);
    });

    it('对抗：左支守卫在【格子】——可见格上已探测物品不显示符号（守卫合并/漏写即红）', () => {
        // CE 左支要求 !playerCanSeeOrSense（Rogue.h:1278）；能看到格子时
        // 物品本身照常显示，符号不出现。
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ groundItem: detectedWeapon(+2) }),
        )!;
        expect(visual.char).toBe(floor.char); // 地板原样，不是魔法符号
        expect(visual.color).not.toBe(GOOD_MAGIC_COLOR);
    });

    it('无极性的已探测物品（enchantment 0）不显示符号（polarity 0 过不了 CE 的守卫）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: false, explored: true }),
            cellCtx({ groundItem: detectedWeapon(0) }),
        )!;
        expect(visual.char).not.toBe(G_GOOD_MAGIC_CHAR);
        expect(visual.char).not.toBe(G_BAD_MAGIC_CHAR);
    });

    it('未探测的物品不显示符号（magicDetected 假时即使极性非零也不画）', () => {
        const it = detectedWeapon(+2);
        it.magicDetected = false;
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: false, explored: true }),
            cellCtx({ groundItem: it }),
        )!;
        expect(visual.char).not.toBe(G_GOOD_MAGIC_CHAR);
    });

    it('未探索格上的已探测物品照样亮符号——「未探索且不可见即不画」的门为探测让位', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: false, explored: false, memory: false }),
            cellCtx({ groundItem: detectedWeapon(+2) }),
        )!;
        expect(visual).not.toBeNull();
        expect(visual!.char).toBe(G_GOOD_MAGIC_CHAR);
    });

    it('右支：携带已探测物品的（不可见）怪物——生产者把 !canSeeMonster 折入 ctx；符号照画', () => {
        // web Monster 无 carriedItem 字段，本支为留形（ctx.carriedItem 恒 null）；
        // 测试直接注入载体对象。可见格上也画（守卫对象是怪物不是格子）。
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ carriedItem: detectedWeapon(-2) }),
        )!;
        expect(visual.char).toBe(G_BAD_MAGIC_CHAR);
    });

    it('对抗：分支顺序——右支（携带物）压过左支（地面物），CE IO.c:1123-1125', () => {
        // 地上放善意护符、怪物携带恶意武器：符号按**携带物**算（恶意），
        // 顺序写反的实现会画成护符/善意符号。
        const amulet = new Item('护符', ',', 0xffffff, ItemCategory.AMULET);
        amulet.magicDetected = true;
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: false, explored: true }),
            cellCtx({ groundItem: amulet, carriedItem: detectedWeapon(-2) }),
        )!;
        expect(visual.char).toBe(G_BAD_MAGIC_CHAR);
        expect(visual.color).toBe(BAD_MAGIC_COLOR);
    });

    it('携带物未探测出魔法 → 右支不成立，退回左支判定（地面无物 → 无符号）', () => {
        const carried = detectedWeapon(+2);
        carried.magicDetected = false;
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ carriedItem: carried }),
        )!;
        expect(visual.char).toBe(floor.char);
    });
});

// ════════════════════════ 第 4 条：PARALYSIS / METHANE 气体 ════════════════════════

describe('UI-1 第 4 条：PARALYSIS / METHANE 气体渲染', () => {
    it('PARALYSIS：bg = CE pink 减半、字形 ~ + 淡粉前景；METHANE：bg = CE methaneColor 减半、~ + 草绿前景', () => {
        // 错误实现：两种气体其中一种留在 default 分支（渲染成地板）即红
        const par = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.PARALYSIS), lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(par.char).toBe(GAS_OVERLAY_CHAR);
        expect(par.color).toBe(PARALYSIS_GAS_FG);
        expect(par.bgColor).toBe(PARALYSIS_GAS_BG);

        const met = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.METHANE), lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(met.char).toBe(GAS_OVERLAY_CHAR);
        expect(met.color).toBe(METHANE_GAS_FG);
        expect(met.bgColor).toBe(METHANE_GAS_BG);
    });

    it('对抗：bg 值锚定 CE 原色（pink {100,60,66} / methaneColor {45,60,15} 各减半，Globals.c:506-507）', () => {
        expect(PARALYSIS_GAS_BG).toBe(0x7f4c54); // (255,153,168)/2
        expect(METHANE_GAS_BG).toBe(0x394c13);   // (114,153,38)/2
        // 两气体的视觉必须可区分（同字形、异色——CE 以色辨气体）
        expect(PARALYSIS_GAS_BG).not.toBe(METHANE_GAS_BG);
        expect(PARALYSIS_GAS_FG).not.toBe(METHANE_GAS_FG);
    });

    it('新气体的 bg 同样参与光照乘法（恒等光下为原值；弱光下线性变暗）', () => {
        const dim = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.METHANE), lightChannels: { r: 50, g: 50, b: 50 } }),
        )!;
        expect(dim.bgColor).toBe(0x1c2609); // (57,76,19)*0.5 截断
    });

    it('density=0 的气体不渲染（既有门对两种新气体同样生效）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ gas: gas(GasType.PARALYSIS, 0), lightChannels: IDENTITY_LIGHT }),
        )!;
        expect(visual.char).toBe(floor.char);
        expect(visual.bgColor).toBe(floor.bgColor);
    });
});

// ════════════════════════ 第 5 条：explosion_immunity 不显示 ════════════════════════

describe('UI-1 第 5 条：CE 空名状态不在侧栏显示（负向断言）', () => {
    it('负向：explosion_immunity 不得出现在侧栏可见集合', () => {
        // 错误实现：按路线图 P1-47 的原（错误）登记"补中文标签"→ 会显示 → 红
        expect(isSidebarVisibleStatus('explosion_immunity')).toBe(false);
    });

    it('CE 空名集恰为 web 现有载体（explosion_immunity/enraged）；新增载体须同步扩入', () => {
        expect([...CE_EMPTY_NAME_STATUSES].sort()).toEqual(['enraged', 'explosion_immunity']);
    });

    it('有名状态与未知键照常显示（CE name[0] 门只挡空名；未知键裸显是 web 既有调试可见性）', () => {
        expect(isSidebarVisibleStatus('burning')).toBe(true);
        expect(isSidebarVisibleStatus('paralyzed')).toBe(true);
        expect(isSidebarVisibleStatus('some_future_escape_hatch_key')).toBe(true);
    });

    it('结构守卫：Sidebar 的过滤必须走 isSidebarVisibleStatus（不许在组件里手写键名黑名单）', () => {
        const src = readFileSync(
            new URL('../components/Sidebar.vue', import.meta.url), 'utf8',
        );
        expect(src).toMatch(/isSidebarVisibleStatus/);
    });
});

// ════════════════════════ 第 6 条：onConfirmRequest 接线 ════════════════════════

describe('UI-1 第 6 条：Game.onConfirmRequest 生产侧接线', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function stubGame(overrides: Partial<Pick<Game, 'replayStatus'>> & { autoTraveling?: boolean } = {}): Game {
        return {
            onConfirmRequest: null,
            replayStatus: overrides.replayStatus ?? 'idle',
            isAutoTraveling: () => overrides.autoTraveling ?? false,
        } as unknown as Game;
    }

    it('常规对局：问题原样转给模态框，答案映射为返回值（Enter=Yes/Esc=No 由原生 confirm 承载，≙ CE RETURN/ESCAPE_KEY）', () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('window', { confirm: confirmSpy });
        const game = stubGame();
        wireConfirmRequest(game);
        expect(game.onConfirmRequest).not.toBeNull();
        expect(game.onConfirmRequest!('潜入深渊？')).toBe(true);
        expect(confirmSpy).toHaveBeenCalledWith('潜入深渊？');

        confirmSpy.mockReturnValue(false);
        expect(game.onConfirmRequest!('潜入深渊？')).toBe(false);
    });

    it('回放期间直接放行且**不弹框**（CE IO.c:2941-2943 "oh yes he did"；弹框会卡死回放）', () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('window', { confirm: confirmSpy });
        const game = stubGame({ replayStatus: 'playing' });
        wireConfirmRequest(game);
        expect(game.onConfirmRequest!('潜入深渊？')).toBe(true);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('自动寻路期间直接放行（CE rogue.autoPlayingLevel 的 web 等价 = isAutoTraveling）', () => {
        const confirmSpy = vi.fn(() => false);
        vi.stubGlobal('window', { confirm: confirmSpy });
        const game = stubGame({ autoTraveling: true });
        wireConfirmRequest(game);
        expect(game.onConfirmRequest!('潜入深渊？')).toBe(true);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('结构守卫：App.vue 挂载时真的接线（谁把 wireConfirmRequest(activeGame) 删了谁红）', () => {
        const src = readFileSync(new URL('../App.vue', import.meta.url), 'utf8');
        expect(src).toMatch(/wireConfirmRequest\(activeGame\)/);
    });
});

// ════════════════════════ 第 7 条：光照 CE 乘法 ════════════════════════

describe('UI-1 第 7 条：光照按 CE 逐通道乘法（adjustedLightValue + applyColorMultiplier）', () => {
    it('对抗：过亮通道平方根压回（adjustedLightValue，IO.c:1732-1737）——漏写压回/用旧混合即红', () => {
        // adjusted(180) = trunc(sqrt(180/150)*150) = 164；基色由 CE 黄金表给出。
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ lightChannels: { r: 180, g: 180, b: 180 } }),
        )!;
        expect(visual.color).toBe(lightColor(floor.color, [180, 180, 180]));
        expect(visual.bgColor).toBe(lightBg(floor.bgColor, [180, 180, 180]));
    });

    it('对抗：有色光是**逐通道**的——单色混合实现（旧 light: {color,intensity} 形态）给不出这个值', () => {
        // r=100/g=20/b=0 逐通道作用在 CE 地板前景；混向单色的实现无法满足。
        // 三通道独立比例。
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ lightChannels: { r: 100, g: 20, b: 0 } }),
        )!;
        expect(visual.color).toBe(lightColor(floor.color, [100, 20, 0]));
    });

    it('负通道按 max(0,·) 钳位（黑暗类光是负分量，CE colorMultiplierFromDungeonLight）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.FLOOR, { visible: true }),
            cellCtx({ lightChannels: { r: -50, g: 100, b: 100 } }),
        )!;
        expect(visual.color).toBe(lightColor(floor.color, [-50, 100, 100])); // 红通道 ×0，绿蓝 ×1
    });

    it('背景与前景用同一乘数（CE 对两者各做一次 applyColorMultiplier）', () => {
        const visual = cellAppearance(
            makeCell(TerrainType.WATER_SHALLOW, { visible: true }),
            cellCtx({ lightChannels: { r: 50, g: 50, b: 50 } }),
        )!;
        const water = ceTerrainGoldens.WATER_SHALLOW;
        expect(visual.bgColor).toBe(lightBg(water.bgColor, [50, 50, 50]));
        expect(visual.color).toBe(lightColor(water.color, [50, 50, 50]));
    });

    it('全零通道与 null 光同走"可见但无光"近黑分支（不受乘法影响）', () => {
        for (const light of [null, { r: 0, g: 0, b: 0 } as LightChannels]) {
            const visual = cellAppearance(
                makeCell(TerrainType.FLOOR, { visible: true }),
                cellCtx({ lightChannels: light }),
            )!;
            expect(visual).toEqual({ char: floor.char, color: '#222222', bgColor: 0x050505 });
        }
    });
});
