/**
 * src/test/v_1c_machine_structure.test.ts — V-1c：机器系统的结构还原
 * （资格过滤 blueprintQualifies / 奖励房配额 / 递归外包·领养·前厅 / 失败回滚）
 *
 * CE 依据（本轮逐字核对过，行号为本轮 Read/sed 原文输出）：
 *   - blueprintQualifies     Architect.c:455-468：深度覆盖 + 必须拥有全部
 *     required 旗标 + BP_ADOPT_ITEM / BP_VESTIBULE **只在被显式要求时**可选
 *     （两条 NOT-unless-required 守卫）→ 顶层抽签（只要求 BP_REWARD）永远
 *     抽不到前厅/守卫蓝图，它们只能由递归建立；
 *   - 配额                    Architect.c:1757-1775（addMachines）：保底
 *     while（"约每 4 层 1 间"，(rewardRoomsGenerated+machineCount)*4+2 <
 *     depth）+ 加成 while（前 2 层且一间未建 40%，此后 15%）；计数器是
 *     run 级全局（Rogue.h:2504，RogueMain.c:292 开局清零）→ 必须进存档；
 *   - 递归                    Architect.c:1543-1575：MF_OUTSOURCE_ITEM_TO_MACHINE
 *     / MF_BUILD_VESTIBULE 的 feature 触发子机器，10 次重试，成功把子机器
 *     并入父机器（父失败则一并释放）；
 *   - 回滚                    备份在 point of no return（:1222 copyMap）；
 *     两处触发：递归 10 次全败（:1576-1583）、feature 实例数不达
 *     minimumInstanceCount（:1676-1687）——恢复地图 + 释放本机与子机的
 *     全部产物（abortItemsAndMonsters :470-490）。
 *
 * 对抗面（每个用例钉一种合理的错误实现）：
 *   Q1  资格过滤退回"只按深度过滤"（V-1c 前的 selectBlueprint 语义）
 *       → vestibule/key_guard 被顶层抽中 → 红；
 *   Q2  两条 NOT-unless-required 守卫被删 → 无要求时前厅/守卫也合格 → 红；
 *   Q3  配额公式退回 web 旧制 min(2+⌊d/3⌋,6) → D10 应 2 台实得 5 → 红；
 *   Q4  计数器不抑制配额（每层独立计数）→ counter=1 时 D10 应 1 台实得 2 → 红；
 *   Q5  递归失败不回滚（删 abort）→ 父机器带残骸发布 / 地图不复原 → 红
 *       （R3，反向验证在交付报告 §5）；
 *   Q6  最小实例数检查被删 → 放不下 feature 的机器照样建成 → 红（R4）；
 *   Q7  快照丢计数器 → 读档后配额归零 → 红。
 *
 * 哨兵纪律（任务书 §7.1）：夹具走 ② 合成层（手工 Grid + 注入合成蓝图，
 * 不依赖生成期随机布局）与 ③ 性质断言；端到端走完整生成链
 * （createHeadlessGame 逐层下潜），无一处锚定 RNG 流绝对位置。
 */
import { describe, it, expect } from 'vitest';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import {
    BlueprintEngine,
    blueprintQualifies,
    getRewardRoomsGenerated,
    setRewardRoomsGenerated,
    resetRewardRoomsGenerated,
    BP_REWARD,
    BP_ADOPT_ITEM,
    BP_VESTIBULE,
} from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, FeatureDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import blueprintData from '../data/blueprints.json';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';

// ---------- 夹具：手工地图 ----------

function graniteAll(grid: Grid): void {
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
        }
    }
}
function floorCell(grid: Grid, x: number, y: number): void {
    grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
}

/**
 * 带 pocketCount（≤6）个死 pocket 的走廊图（p1_33 夹具 A 的扩展）：1 宽走廊
 * （y=10, x4-55）上方挂 pocketCount 个 3×3 pocket，各自独立门位（(px,9)，
 * 内侧 choke=9；走廊格的割点值 41/30000 大于 roomSize 上界，不构成候选）。
 * roomSize ⊇ [8,9] 的蓝图门位候选 = 恰好这些 pocket 门。
 */
function buildPocketCorridor(pocketCount: number): Grid {
    const grid = new Grid(DCOLS, DROWS);
    graniteAll(grid);
    for (let x = 4; x <= 55; x++) floorCell(grid, x, 10);
    const centers = [8, 17, 26, 35, 44, 53];
    for (let i = 0; i < pocketCount; i++) {
        const px = centers[i]!;
        for (let x = px - 1; x <= px + 1; x++) {
            for (let y = 6; y <= 8; y++) floorCell(grid, x, y);
        }
        floorCell(grid, px, 9); // 门位
    }
    return grid;
}

/** 与 p1_33 夹具 A 同源的"大厅—走廊—单 pocket"图（递归全败用例的载体：
 *  父机器占住唯一 pocket 后，子机器必然无处可建）。 */
function buildSinglePocketMap(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    graniteAll(grid);
    for (let x = 2; x <= 15; x++) for (let y = 4; y <= 14; y++) floorCell(grid, x, y);
    for (let x = 16; x <= 22; x++) floorCell(grid, x, 9);
    floorCell(grid, 23, 9);
    for (let x = 24; x <= 26; x++) for (let y = 8; y <= 10; y++) floorCell(grid, x, y);
    return grid;
}

// ---------- 夹具：合成蓝图 ----------

function feat(f: Partial<FeatureDef>): FeatureDef {
    return {
        instanceCount: [1, 1],
        flags: ['MF_GENERATE_ITEM'],
        itemCategory: 'SCROLL',
        ...f,
    } as FeatureDef;
}
function bp(f: Partial<BlueprintDef>): BlueprintDef {
    return {
        id: 'v1c_bp',
        name: 'v1c_bp',
        depthRange: [1, 26],
        roomSize: [8, 10],
        frequency: 1,
        category: 'reward',
        flags: [],
        features: [],
        ...f,
    } as BlueprintDef;
}

/** Q3/Q4 配额钉点用的最简 reward 蓝图：零 feature（只占格、零内容指令）。 */
function PLAIN_REWARD(): BlueprintDef {
    return bp({ id: 'v1c_plain', category: 'reward', features: [] });
}

const ADOPT_CHILD = bp({
    id: 'v1c_adopt', category: 'key_guard',
    features: [feat({ itemId: 'v1c_adopted', flags: ['MF_GENERATE_ITEM', 'MF_ADOPT_ITEM'] })],
});
const OUTSOURCE_PARENT = bp({
    id: 'v1c_parent', category: 'reward',
    features: [feat({ itemId: 'v1c_out', flags: ['MF_GENERATE_ITEM', 'MF_OUTSOURCE_ITEM_TO_MACHINE'] })],
});
const VESTIBULE_PARENT = bp({
    id: 'v1c_vest_parent', category: 'reward',
    features: [feat({ itemCategory: undefined, itemId: undefined, flags: ['MF_BUILD_VESTIBULE'] })],
});
const VESTIBULE_CHILD = bp({ id: 'v1c_vest', category: 'vestibule', roomSize: [1, 3], features: [] });

// ---------- 夹具：工具 ----------

/** 整层可变格状态指纹（回滚等价性的观测面：layers/char/machineNumber/
 *  trapType/isPassable/isOpaque——backupLevel 的快照面。
 *  V-2b-4：Cell.altarGroupId 随自创祭坛组子系统一并拆除（CE 无祭坛分组
 *  概念），指纹相应去掉该字段。 */
function levelFingerprint(grid: Grid): string {
    const rows: string[] = [];
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            const c = grid.getCell(x, y)!;
            rows.push(`${c.layers.join('/')}|${c.char}|${c.machineNumber}|${c.trapType ?? ''}|` +
                `${c.isPassable ? 1 : 0}|${c.isOpaque ? 1 : 0}`);
        }
    }
    return rows.join(';');
}

function allMachineNumbersZero(grid: Grid): boolean {
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (grid.getCell(x, y)!.machineNumber !== 0) return false;
        }
    }
    return true;
}

type GameWithPrivates = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

// ---------- 用例 ----------

describe('V-1c 资格过滤（CE blueprintQualifies，Architect.c:455-468）', () => {
    it('Q1 顶层抽签（required=[BP_REWARD]）只允许 CE reward；自创 reward 与其他类别均不可选', () => {
        const blueprints = blueprintData as BlueprintDef[];
        let rewardQualified = 0;
        let rewardTotal = 0;
        for (const b of blueprints) {
            for (let d = b.depthRange[0]; d <= b.depthRange[1]; d++) {
                const q = blueprintQualifies(b, d, [BP_REWARD]);
                // B1: null CE reward identities remain in data but are retired.
                // Check them on the negative side; do not silently skip them or
                // derive the positive set from the engine's exclusion predicate.
                if (b.category === 'reward' && b.ceBlueprintId !== null) {
                    if (q) rewardQualified++;
                    rewardTotal++;
                } else {
                    expect(q,
                        `${b.id}（category=${b.category}）在 required=BP_REWARD 下不合格才对` +
                        `——非 CE reward 或已退池自创项不应参加顶层抽签`).toBe(false);
                }
            }
        }
        // 反空转：CE reward 必须真的有合格样本，且自身深度带内全部合格。
        expect(rewardTotal, 'CE reward 类蓝图缺失——映射坏死').toBeGreaterThan(0);
        expect(rewardQualified, 'CE reward 类在自身深度带内应全部合格').toBe(rewardTotal);
    });

    it('Q2 两条 NOT-unless-required 守卫：ADOPT/VESTIBULE 位只在被要求时可选；required=∅ 时 reward 也合格（CE 缺口6 的字面行为）', () => {
        const adopt = ADOPT_CHILD, vest = VESTIBULE_CHILD, rew = OUTSOURCE_PARENT;
        // 被显式要求 → 合格（递归调用正是这样请求它们的）。
        expect(blueprintQualifies(adopt, 5, [BP_ADOPT_ITEM])).toBe(true);
        expect(blueprintQualifies(vest, 5, [BP_VESTIBULE])).toBe(true);
        // 未被要求 → 不合格（删守卫的实现在此翻红）。
        expect(blueprintQualifies(adopt, 5, [])).toBe(false);
        expect(blueprintQualifies(vest, 5, [])).toBe(false);
        expect(blueprintQualifies(adopt, 5, [BP_REWARD])).toBe(false);
        expect(blueprintQualifies(vest, 5, [BP_REWARD])).toBe(false);
        // CE 字面行为（V-0 §7 缺口6：blueprintQualifies 对 BP_REWARD 无对称
        // 守卫，照抄勿加固）：required 为空时 reward 蓝图也合格。
        expect(blueprintQualifies(rew, 5, [])).toBe(true);
        // 深度带外一律不合格。
        expect(blueprintQualifies(rew, 99, [BP_REWARD])).toBe(false);
    });

    it('Q1b（V-2a 反转）端到端：3 seeds × D1-D26 的机器类别 = reward ∪ 递归两类（vestibule/key_guard），thematic 绝迹', () => {
        const SEEDS = [424242, 777, 20260913];
        const offenders: string[] = [];
        let machines = 0;
        let rewardMachines = 0;
        // V-2a 反转（本文件在 V-2a 任务书 §5 授权清单内）：原断言
        // 「offenders 收集一切 category!=='reward' 的机器且必须为空」写于
        // V-1c——当时 buildMachines 的返回值里只有顶层 reward 机器。V-2a
        // 接通前厅/钥匙外包数据后，返回值深含递归子机器（vestibule/
        // key_guard，CE Architect.c:1555-1567 并入父缓冲的 web 等价物），
        // 它们不是顶层抽签产物。新钉点：
        //   a) reward 机器必须存在（配额活着）；
        //   b) thematic 仍然绝迹（顶层抽不到、也无递归路径——D2 退池）；
        //   c) 递归两类之外出现任何类别即红。
        // 「顶层抽签只抽 reward」的资格过滤原意由上方 Q1/Q2（合成蓝图直调
        // blueprintQualifies）钉住。
        const LEGAL = new Set(['reward', 'vestibule', 'key_guard']);
        const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
        const original = proto.buildMachines as (this: unknown) => MachineResult[];
        proto.buildMachines = function (this: unknown) {
            const results = original.call(this);
            for (const r of results) {
                machines++;
                if (r.category === 'reward') rewardMachines++;
                if (!LEGAL.has(r.category)) {
                    offenders.push(`D${(this as { depth: number }).depth} ${r.blueprintId}(${r.category})`);
                }
            }
            return results;
        };
        try {
            for (const seed of SEEDS) {
                const game = createHeadlessGame(seed);
                for (let d = 1; d <= 26; d++) {
                    if (d > 1) {
                        game.depth = d;
                        (game as unknown as GameWithPrivates).generateDepth(false, false);
                    }
                }
            }
        } finally {
            proto.buildMachines = original;
        }
        expect(machines, '三整局竟无一台机器——生成或记录失效').toBeGreaterThan(0);
        expect(rewardMachines, '三整局竟无 reward 机器——配额或资格过滤失效').toBeGreaterThan(0);
        expect(offenders, `产生了非法类别机器：${offenders.join('、')}`).toEqual([]);
    }, 300_000);
});

describe('V-1c 奖励房配额（CE addMachines，Architect.c:1757-1775）', () => {
    it('Q3 保底公式钉点：D10、计数器 0 → 恰 2 台（旧制 min(2+⌊10/3⌋,6)=5 台的实现在此翻红）', () => {
        // CE while：(0*4+2)=2<10 → 1；(1*4+2)=6<10 → 2；(2*4+2)=10<10 假 → 停。
        // 6-pocket 图保证 2 次建造都成功；单一合格蓝图 + 门位候选数会变
        //（2→1→0），但 blueprint 抽签在单候选时早退零消耗、门位抽取
        // randRange(0, n-1) 是真实消耗——种子固定即整体确定。
        // 种子 11 实测：保底 2 台后 15% 加成掷骰不命中（种子 20260918 会
        // 命中加成 → 3 台，同样是合法输出——这里钉"无加成"的纯保底面）。
        rng.seedRandomGenerator(11);
        resetRewardRoomsGenerated();
        const engine = new BlueprintEngine(buildPocketCorridor(6), 10, [PLAIN_REWARD()]);
        const results = engine.buildMachines();
        expect(results.length, `D10 保底应恰 2 台（CE while 手算），实得 ${results.length}`).toBe(2);
        expect(getRewardRoomsGenerated(), '建成 2 台后计数器应 =2').toBe(2);
    });

    it('Q4 计数器抑制：D10、计数器 1 → 恰 1 台（每层独立计数的实现会得 2）', () => {
        // (1*4+2)=6<10 → 1；(2*4+2)=10<10 假 → 停。种子 11 的加成掷骰不命中。
        rng.seedRandomGenerator(11);
        setRewardRoomsGenerated(1);
        const engine = new BlueprintEngine(buildPocketCorridor(6), 10, [PLAIN_REWARD()]);
        const results = engine.buildMachines();
        expect(results.length, `D10、已建 1 台时应再建 1 台，实得 ${results.length}`).toBe(1);
        expect(getRewardRoomsGenerated(), '应核销为 2').toBe(2);
    });

    it('Q4b 开局清零（CE RogueMain.c:292）：startNewGame 后计数器归零', () => {
        setRewardRoomsGenerated(9);
        createHeadlessGame(42); // 构造即 startNewGame
        expect(getRewardRoomsGenerated(), '新局必须从 0 开始计量（否则读档/重开泛滥）').toBe(0);
    });

    it('Q7 计数器随存档往返：读档后配额不重置（"读档后继续下楼"场景）', () => {
        const game = createHeadlessGame(424242);
        for (let d = 2; d <= 6; d++) {
            game.depth = d;
            (game as unknown as GameWithPrivates).generateDepth(false, false);
        }
        const before = getRewardRoomsGenerated();
        expect(before, '424242 下潜 6 层后计数器应已增长（保底 D3-D6 各一次）').toBeGreaterThan(0);

        const snap = game.toSnapshot();
        expect(snap.rewardRoomsGenerated, '快照必须携带计数器').toBe(before);

        // 新实例读入后必须恢复为 before——快照丢字段的实现会把这里拉回 0
        //（读档后配额重新计数、奖励房泛滥）。
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snap)).toBe(true);
        expect(getRewardRoomsGenerated(), `读档后计数器应为 ${before}`).toBe(before);

        // 读档后继续下楼：配额在恢复值上继续计量（生成链可用、计数单调）。
        reloaded.depth = 7;
        (reloaded as unknown as GameWithPrivates).generateDepth(false, false);
        expect(getRewardRoomsGenerated()).toBeGreaterThanOrEqual(before);
    });
});

describe('V-1c 递归外包/领养（CE Architect.c:1543-1575）', () => {
    it('R1 外包成功：父机器的物品由守卫子机器领养，双机成立、格子互斥、无本地直投', () => {
        rng.seedRandomGenerator(314159);
        resetRewardRoomsGenerated();
        const grid = buildPocketCorridor(2);
        const engine = new BlueprintEngine(grid, 4, [OUTSOURCE_PARENT, ADOPT_CHILD]);
        const results = engine.buildMachines();

        // D4：保底 (0*4+2)=2<4 → 1 台。顶层抽签只发 BP_REWARD（父）；子机器
        // 由父的 MF_OUTSOURCE feature 递归请求 [BP_ADOPT_ITEM] 建立。15% 加成
        // 即便命中，追加建造也无处可建（两个 pocket 已占）→ 稳定父+子。
        const parent = results.find(r => r.blueprintId === 'v1c_parent');
        const child = results.find(r => r.blueprintId === 'v1c_adopt');
        expect(parent, '父机器（外包方）未建成').toBeDefined();
        expect(child, '守卫子机器（领养方）未建成').toBeDefined();
        // 递归真实发生（反空转）：父子经 subMachines 关联。
        expect(parent!.subMachines.map(s => s.blueprintId)).toContain('v1c_adopt');
        // 外包物品不在父机器本地直投（CE :1533-1539 非外包才 placeItemAt）。
        expect(parent!.itemSpawns.map(s => s.id), '外包物品被父机器本地直投了')
            .not.toContain('v1c_out');
        // 领养物品由子机器在其自身 feature 位放置（CE :1500-1503 theItem =
        // adoptiveItem，**同一件物品**随指令迁移——id 仍是父机器生成的
        // 'v1c_out'，子机器不重新生成）。物品指令从父机器的本地面消失、
        // 在子机器内部出现，这正是"外包"的观察面。
        expect(child!.itemSpawns.length, '子机器应恰放置 1 件领养物品').toBe(1);
        expect(child!.itemSpawns[0]!.id, '领养放置的必须是父机器外包的那件物品').toBe('v1c_out');
        const childCells = new Set(child!.cells.map(p => `${p.x},${p.y}`));
        expect(childCells.has(`${child!.itemSpawns[0]!.pos.x},${child!.itemSpawns[0]!.pos.y}`),
            '领养物品落点必须在子机器内部').toBe(true);
        // 父子格子互斥、机器号不同。
        const parentCells = new Set(parent!.cells.map(p => `${p.x},${p.y}`));
        for (const p of child!.cells) {
            expect(parentCells.has(`${p.x},${p.y}`), '子机器格与父机器格重叠').toBe(false);
        }
        expect(child!.machineNumber).not.toBe(parent!.machineNumber);
    });

    it('R2 前厅成功：MF_BUILD_VESTIBULE 在 feature 位建前厅子机器（dijkstra 填充，锚点=门位）', () => {
        rng.seedRandomGenerator(271828);
        resetRewardRoomsGenerated();
        const grid = buildPocketCorridor(2);
        const engine = new BlueprintEngine(grid, 4, [VESTIBULE_PARENT, VESTIBULE_CHILD]);
        const results = engine.buildMachines();

        const parent = results.find(r => r.blueprintId === 'v1c_vest_parent');
        const child = results.find(r => r.blueprintId === 'v1c_vest');
        expect(parent, '父机器未建成').toBeDefined();
        expect(child, '前厅子机器未建成——递归前厅支未接通').toBeDefined();
        expect(parent!.subMachines.map(s => s.blueprintId)).toContain('v1c_vest');
        // 前厅尺寸 ∈ 蓝图 roomSize（[1,3]，dijkstra 填充的目标格数）。
        expect(child!.cells.length,
            `前厅内部 ${child!.cells.length} 格应 ∈ [1,3]`).toBeGreaterThanOrEqual(1);
        expect(child!.cells.length).toBeLessThanOrEqual(3);
        // 锚点 = 父机器内部的特征位（CE vestibule 机器从门位长出来）。
        expect(child!.door, '前厅门位（锚点）缺失').not.toBeNull();
        const parentCells = new Set(parent!.cells.map(p => `${p.x},${p.y}`));
        expect(parentCells.has(`${child!.door!.x},${child!.door!.y}`),
            '前厅锚点必须落在父机器内部（feature 位）').toBe(true);
        // 前厅除锚点外的格子不得吞并父机器其他格（CE :680-684 机器格禁入）。
        for (const p of child!.cells) {
            if (p.x === child!.door!.x && p.y === child!.door!.y) continue;
            expect(parentCells.has(`${p.x},${p.y}`), '前厅内部吞并了父机器的格').toBe(false);
        }
    });

    it('R3 领养 10 次全败 → 整机回滚：无输出、地图逐位复原、无孤儿（CE :1576-1583）', () => {
        rng.seedRandomGenerator(1618033);
        resetRewardRoomsGenerated();
        const grid = buildSinglePocketMap();
        const before = levelFingerprint(grid);
        expect(allMachineNumbersZero(grid)).toBe(true);

        // 观察递归真的跑过（反空转）：包裹 applyBlueprint 计数。
        let applyCalls = 0;
        const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
        const origApply = proto.applyBlueprint as (this: unknown, ...a: unknown[]) => unknown;
        proto.applyBlueprint = function (this: unknown, ...a: unknown[]) {
            applyCalls++;
            return origApply.apply(this, a);
        };
        let results: MachineResult[] = [];
        try {
            const engine = new BlueprintEngine(grid, 4, [OUTSOURCE_PARENT, ADOPT_CHILD]);
            results = engine.buildMachines();
        } finally {
            proto.applyBlueprint = origApply;
        }
        expect(applyCalls, 'applyBlueprint 从未执行——父机器选址就失败了，用例空转').toBeGreaterThan(0);
        // ① 父机器整体回滚：配额循环 50 次 failsafe 全败 → 零输出。
        expect(results, '领养全败时不得有任何机器（含残骸）流出').toEqual([]);
        // ② 地图恢复原状（逐位，含 machineNumber——备份/恢复遗漏即红）。
        expect(levelFingerprint(grid), '回滚后地图与动手前不一致（备份/恢复缺失或残缺）').toBe(before);
        expect(allMachineNumbersZero(grid), '回滚后仍残留机器旗标格').toBe(true);
        // ③ 不留孤儿：results 为空 ⇒ populateLevel 拿不到任何 itemSpawns /
        //    monsterSpawns（web 的物品/怪物只在消费端落地——CE
        //    abortItemsAndMonsters 的 web 等价是"失败的结果整体不可达"）。
        const orphans = results.flatMap(r => [...r.itemSpawns, ...r.monsterSpawns]);
        expect(orphans).toEqual([]);
    });
});

describe('V-1c 失败回滚·触发点二（CE :1676-1687 minimumInstanceCount）', () => {
    it('R4 feature 放不满最小实例数 → 整机回滚、地图复原', () => {
        rng.seedRandomGenerator(577215);
        resetRewardRoomsGenerated();
        // instanceCount [3,3] 的 feature 带 personalSpace 4：9 格 pocket 里
        // 第 1 件就把可用格清光 → 第 2 件无处落 → placed=1 < 3 → 整机失败
        //（删最小数检查的旧实现会放行 1 件 WEB 的机器——R4b 对照非空转）。
        const greedy = bp({
            id: 'v1c_greedy', category: 'reward',
            features: [feat({
                itemCategory: undefined, itemId: undefined,
                instanceCount: [3, 3], personalSpace: 4,
                flags: [], terrain: 'WEB',
            })],
        });
        const grid = buildPocketCorridor(2);
        const before = levelFingerprint(grid);
        const engine = new BlueprintEngine(grid, 4, [greedy]);
        const results = engine.buildMachines();
        expect(results, '放不满最小实例数的机器不得建成').toEqual([]);
        expect(levelFingerprint(grid), '最小实例数回滚后地图未复原').toBe(before);
        expect(allMachineNumbersZero(grid)).toBe(true);
    });

    it('R4b 对照：同一蓝图把 instanceCount 降到 [1,1] 后应能建成（证明 R4 红自最小数检查、非选址坏死）', () => {
        rng.seedRandomGenerator(577215);
        resetRewardRoomsGenerated();
        const ok = bp({
            id: 'v1c_ok', category: 'reward',
            features: [feat({
                itemCategory: undefined, itemId: undefined,
                instanceCount: [1, 1], personalSpace: 4, flags: [], terrain: 'WEB',
            })],
        });
        const engine = new BlueprintEngine(buildPocketCorridor(2), 4, [ok]);
        const results = engine.buildMachines();
        expect(results.length, '对照蓝图应至少建成 1 台（feature 恰放 1 件）').toBeGreaterThanOrEqual(1);
        expect(results[0]!.cells.length).toBeGreaterThan(0);
    });
});
