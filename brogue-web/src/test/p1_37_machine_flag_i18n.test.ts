/**
 * src/test/p1_37_machine_flag_i18n.test.ts — P1-37：机器旗标取代 CHARRED_FLOOR
 * 冒充 + 硬编码英文接入 i18n 的对抗性测试。
 *
 * 病灶与修复（详见 ai_docs/p1_37_machine_flag_and_i18n_report.md）：
 *  P1-33 因 Game.ts 禁改，把机器（宝库）内部裸 FLOOR 整体改判 CHARRED_FLOOR，
 *  让它们退出 populateLevel 的 `terrain === FLOOR` 内容牌堆——玩家看见宝库
 *  一片"烧焦的地面"，且 Gas.updateFires 的焦土长草作用在宝库地板上、
 *  每格每回合消耗 RNG。P1-37 起以 cell.machineNumber≠0 作为 IS_IN_MACHINE
 *  等价旗标（CE Rogue.h:1113），楼梯（Architect.c:3712/3738）、物品（3597）、
 *  怪群（3543）落点回避它，宝库地板恢复普通 FLOOR。
 *
 * 对抗性用例与对应的错误实现：
 *  AD1（用例 1）牌堆不排机器格 / 楼梯钥匙物品怪群落进宝库 → 翻红（多种子实测）；
 *  AD2（用例 2）宝库地板仍是 CHARRED_FLOOR（改判转换被回退）→ 全层焦土计数翻红；
 *  AD3a/b machineNumber 不穿存档往返 / interior 外 feature 标记与记录脱钩 → 翻红；
 *  AD4焦土长草作用在机器格 / 宝库被改回 CHARRED → 翻红；
 *  AD5 系列任一原硬编码英文仍以英文渲染 / 扫描器裸字符串门失效 → 翻红。
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';

import zhCN from '../locales/zh_CN.json';
import monsterData from '../data/monsters.json';
import { createHeadlessGame } from './harness';
import { findHardcodedLogStrings } from './i18n_scan';
import { TerrainType, Grid, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import { ItemCategory, type Item } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import type { Game } from '../engine/Core/Game';

const REPO_SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP_SEEDS = [424242, 31337, 20260916, 42, 999];
const MAX_DEPTH = 26;

// 真实 zh_CN 资源初始化（与 p1_30 同款、与 harness 的空资源约定相反）。
// 必须在模块顶层做：harness 的 initI18nOnce 是"已初始化则跳过"的幂等函数，
// 若让 AD1-AD4 的 createHeadlessGame 先跑，i18next 就会被空资源占住，
// AD5 系列的 t() 全部回落英文 defaultValue。vitest 按文件隔离模块，
// 本文件的真实资源初始化与 p1_30 / harness 互不可见。
if (!i18next.isInitialized) {
    i18next.init({
        lng: 'zh_CN',
        fallbackLng: 'zh_CN',
        resources: { zh_CN: { translation: zhCN as Record<string, string> } },
        initImmediate: false,
    });
}

type Pos = { x: number; y: number };
type GameWithPrivates = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

interface LevelMachines { depth: number; results: MachineResult[] }

/** 复用 P1-33 的记录器手法：包裹 buildMachines 记下每层 MachineResult。
 * 保留结果数组引用，Architect 后续 push 的强制 thematic / 子机器也包含在内。 */
function installRecorder(record: LevelMachines[]): () => void {
    const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
    const original = proto.buildMachines as (this: unknown) => MachineResult[];
    proto.buildMachines = function (this: unknown) {
        const results = original.call(this);
        record.push({ depth: (this as { depth: number }).depth, results });
        return results;
    };
    return () => { proto.buildMachines = original; };
}

const key = (p: Pos): number => p.y * DCOLS + p.x;

describe('P1-37 机器旗标：宝库恢复地板、内容落点回避机器格', () => {
    it('AD1: 5 种子 × D1-D26 —— 楼梯/钥匙/护符绝不落机器格；机器格上的物品与怪物必须是机器自身的布点', () => {
        const violations: string[] = [];
        let machinesSeen = 0;
        let charredSeen = 0;

        for (const seed of SWEEP_SEEDS) {
            const record: LevelMachines[] = [];
            const restore = installRecorder(record);
            const game = createHeadlessGame(seed);
            try {
                for (let d = 1; d <= MAX_DEPTH; d++) {
                    if (d > 1) {
                        (game as unknown as { depth: number }).depth = d;
                        (game as unknown as GameWithPrivates).generateDepth(false, false);
                    }
                    const entry = record[record.length - 1];
                    const results = entry?.results ?? [];
                    machinesSeen += results.length;

                    const machineCells = new Set<number>();
                    const monsterSpawnCells = new Set<number>();
                    const legitItemCells = new Set<number>();
                    for (const mr of results) {
                        monsterSpawnCells.add(key(mr.center));
                        legitItemCells.add(key(mr.center));
                        for (const s of mr.itemSpawns) legitItemCells.add(key(s.pos));
                        for (const s of mr.monsterSpawns) monsterSpawnCells.add(key(s.pos));
                        // 祭坛格上也会放高价值物品（Game.populateLevel 的 altar 段）
                        for (const p of mr.cells) {
                            if (game.grid.getCell(p.x, p.y)?.terrain === TerrainType.ALTAR) {
                                legitItemCells.add(key(p));
                            }
                        }
                    }

                    // ★ V-2b-5 口径校正（与 AD3 的 V-2b-3 校正同机理）★
                    // machineCells 原取 ∪ mr.cells；但 BP_NO_INTERIOR_FLAG
                    //（CE :1685-1697）事后把非 wired 格的 machineNumber 清回 0
                    // ——23 号（V-2b-2b）与本轮新入池的 43/56 号都带它。对这类
                    // 机器，mr.cells 里的格在网格上**不是**机器格，楼梯/钥匙/
                    // 牌堆怪落进去是 CE 字面允许的（IS_IN_MACHINE 的消费点——
                    // 楼梯 3712/3738、物品牌堆、怪群回避——全按网格旗标工作）。
                    // 因此判据改为网格派生（= loadSnapshot 重建 machineCells 的
                    // 权威口径）；mr.cells 只继续供给 legit* 白名单。
                    for (let x = 0; x < game.grid.width; x++) {
                        for (let y = 0; y < game.grid.height; y++) {
                            if ((game.grid.getCell(x, y)?.machineNumber ?? 0) !== 0) {
                                machineCells.add(y * DCOLS + x);
                            }
                        }
                    }

                    for (let x = 0; x < game.grid.width; x++) {
                        for (let y = 0; y < game.grid.height; y++) {
                            const cell = game.grid.getCell(x, y);
                            if (!cell) continue;
                            if (cell.terrain === TerrainType.CHARRED_FLOOR) charredSeen++;
                            const k = y * DCOLS + x;
                            if (!machineCells.has(k)) continue;
                            // CE Architect.c:3712/3738：楼梯回避 IS_IN_MACHINE
                            if (cell.terrain === TerrainType.STAIRS_UP || cell.terrain === TerrainType.STAIRS_DOWN) {
                                violations.push(`seed${seed}/D${d} 楼梯落在 (${x},${y}) 机器格内（牌堆不排机器格？）`);
                            }
                        }
                    }

                    for (const item of game.items) {
                        const k = key(item.loc);
                        if (!machineCells.has(k)) continue;
                        // key_guard 类蓝图自身会把一把可丢弃钥匙布在机器内部
                        //（feature 位置，blueprints.json 的数据设计，非牌堆泄漏），
                        // 因此钥匙/物品的判据都是"非机器布点不得落机器格"。
                        if (item.category === ItemCategory.KEY) {
                            if (!legitItemCells.has(k)) {
                                violations.push(`seed${seed}/D${d} 牌堆钥匙落在 (${item.loc.x},${item.loc.y}) 机器格内（会掉进锁死的密库）`);
                            }
                        } else if (item.category === ItemCategory.AMULET) {
                            violations.push(`seed${seed}/D${d} 护符落在 (${item.loc.x},${item.loc.y}) 机器格内`);
                        } else if (!legitItemCells.has(k)) {
                            violations.push(`seed${seed}/D${d} 随机物品落在 (${item.loc.x},${item.loc.y}) 机器格内且不是机器布点`);
                        }
                    }

                    for (const mon of game.monsters) {
                        const k = key(mon.loc);
                        if (machineCells.has(k) && !monsterSpawnCells.has(k)) {
                            violations.push(`seed${seed}/D${d} 怪物 ${mon.name} 落在 (${mon.loc.x},${mon.loc.y}) 机器格内且不是机器布点（怪群回避被删？）`);
                        }
                    }
                }
            } finally {
                restore();
            }
        }

        // V-1c 重校准（原 >300 是全类别同池抽时代的口径）：顶层抽签只剩
        // CE 配额的奖励机器（约每 4 层 1 间 + 15% 加成），5 种子 × D1-26
        // 实测约 29 台。本断言只防"生成器或记录器整体失效"，不钉数量。
        expect(machinesSeen, '扫到的机器数异常（生成器或记录器失效）').toBeGreaterThanOrEqual(12);
        expect(violations, `内容落点闯入机器格 ${violations.length} 处：\n${violations.slice(0, 20).join('\n')}`).toEqual([]);
    });

    it('AD2: 生成层不含任何 CHARRED_FLOOR——宝库地板已恢复普通 FLOOR（改判转换回退即红）', () => {
        // 真焦土只在玩法期出现（火焰燃尽/祭坛碎裂/火陷阱触发），生成期应为 0。
        // P1-33 冒充方案下本断言必红：机器内部 ~54 格/层被改判 CHARRED_FLOOR。
        const offenders: string[] = [];
        for (const seed of SWEEP_SEEDS) {
            const game = createHeadlessGame(seed);
            for (let d = 1; d <= MAX_DEPTH; d++) {
                if (d > 1) {
                    (game as unknown as { depth: number }).depth = d;
                    (game as unknown as GameWithPrivates).generateDepth(false, false);
                }
                let n = 0;
                for (let x = 0; x < game.grid.width; x++) {
                    for (let y = 0; y < game.grid.height; y++) {
                        if (game.grid.getCell(x, y)?.terrain === TerrainType.CHARRED_FLOOR) n++;
                    }
                }
                if (n > 0) offenders.push(`seed${seed}/D${d}: ${n} 格`);
            }
        }
        expect(offenders, `生成层仍出现 CHARRED_FLOOR（宝库地板改判被回退？）\n${offenders.join('\n')}`).toEqual([]);
    });

    it('AD3a: 5 种子 × D1-D26 每台机器的旗标穿存档往返；旧存档（无字段）读入为无机器', () => {
        let levelsSeen = 0;
        let machinesSeen = 0;
        let flaggedCellsSeen = 0;
        let clearedInteriorCellsSeen = 0;

        for (const seed of SWEEP_SEEDS) {
            const record: LevelMachines[] = [];
            const samples: Array<{
                depth: number;
                results: MachineResult[];
                numbers: Map<number, number>;
                snapshot: ReturnType<Game['toSnapshot']>;
            }> = [];
            const restore = installRecorder(record);
            try {
                const game = createHeadlessGame(seed);
                // 先采完本 seed 的所有层，再创建读档实例。loadSnapshot 会重播种
                // 全局 rng；不能把它插进 generateDepth 的连续生成流里。
                for (let d = 1; d <= MAX_DEPTH; d++) {
                    if (d > 1) {
                        (game as unknown as { depth: number }).depth = d;
                        (game as unknown as GameWithPrivates).generateDepth(false, false);
                    }
                    const entry = record[record.length - 1];
                    expect(entry?.depth, `seed${seed}/D${d}: 记录器未覆盖当前层`).toBe(d);
                    const results = entry!.results;
                    const numbers = new Map<number, number>();
                    for (let x = 0; x < game.grid.width; x++) {
                        for (let y = 0; y < game.grid.height; y++) {
                            numbers.set(y * DCOLS + x, game.grid.getCell(x, y)!.machineNumber);
                        }
                    }
                    // V-2b-7 非空性哨兵保留，并扩到每个有机器层。它防的是
                    // feature 记录点脱钩；A−B 是否非空由 AD3b 独立覆盖。
                    if (results.length > 0) {
                        expect(results.reduce((n, mr) => n + mr.featureSpawns.length, 0),
                            `seed${seed}/D${d}: 机器没有记录任何 feature 落点（记录点脱钩？）`)
                            .toBeGreaterThan(0);
                    }
                    samples.push({ depth: d, results, numbers, snapshot: game.toSnapshot() });
                }
            } finally {
                restore();
            }
            expect(samples).toHaveLength(MAX_DEPTH);
            const reloaded = createHeadlessGame(1);
            for (const { depth, results, numbers, snapshot } of samples) {
                const label = `seed${seed}/D${depth}`;
                levelsSeen++;
                machinesSeen += results.length;
                // A = 网格 machineNumber≠0；B = ∪mr.cells。CE 允许 A−B（外部
                // feature）及 B−A（NO_INTERIOR_FLAG 清标记），不能把两者等同。
                const gridDerived = new Set([...numbers].filter(([, n]) => n !== 0).map(([k]) => k));
                flaggedCellsSeen += gridDerived.size;
                const serialized = new Map(snapshot.grid.map(c => [key(c), c.machineNumber ?? 0]));
                expect(serialized, `${label}: 序列化必须逐格保留原 machineNumber（含 0）`).toEqual(numbers);
                expect(reloaded.loadSnapshot(snapshot), `${label}: 读档失败`).toBe(true);

                // 每台机器分别验证 interior、feature 落点及网格归属格，精确到
                // machineNumber，不只检查非零。NO_INTERIOR_FLAG 已清零的格也
                // 必须保持为 0；wired 豁免格保留网格上的原编号，不按蓝图 id 特判。
                for (const mr of results) {
                    const machineLabel = `${label}/${mr.blueprintId}#${mr.machineNumber}`;
                    expect(mr.cells.length, `${machineLabel}: 机器没有内部格`).toBeGreaterThan(0);
                    const keys = new Set([
                        ...mr.cells.map(key),
                        ...mr.featureSpawns.map(s => key(s.pos)),
                        ...[...numbers].filter(([, n]) => n === mr.machineNumber).map(([k]) => k),
                    ]);
                    clearedInteriorCellsSeen += mr.cells.filter(p => numbers.get(key(p)) === 0).length;
                    for (const k of keys) {
                        const x = k % DCOLS, y = Math.floor(k / DCOLS);
                        expect(numbers.has(k), `${machineLabel}: 落点 (${x},${y}) 越界`).toBe(true);
                        expect(serialized.get(k), `${machineLabel}: (${x},${y}) 序列化旗标改变`).toBe(numbers.get(k));
                        expect(reloaded.grid.getCell(x, y)!.machineNumber,
                            `${machineLabel}: (${x},${y}) 反序列化旗标改变`).toBe(numbers.get(k));
                    }
                }
                // 全图再验非机器格，防止反序列化无中生有；machineCells 用同口径
                // 的集合全等，缺格、多格均红，不以长度或包含关系代替。
                for (const [k, n] of numbers) {
                    expect(reloaded.grid.getCell(k % DCOLS, Math.floor(k / DCOLS))!.machineNumber,
                        `${label}: 读档后格 ${k} 旗标改变`).toBe(n);
                }
                expect((reloaded as unknown as { machineCells: Set<number> }).machineCells,
                    `${label}: 读档后 machineCells 未按网格精确重建`).toEqual(gridDerived);

                // 每层都做旧存档兼容，且在同一实例刚恢复真实旗标后加载，防陈值残留。
                const legacy = JSON.parse(JSON.stringify(snapshot)) as ReturnType<Game['toSnapshot']>;
                for (const c of legacy.grid) delete c.machineNumber;
                expect(reloaded.loadSnapshot(legacy), `${label}: 旧存档读档失败`).toBe(true);
                for (const k of numbers.keys()) {
                    expect(reloaded.grid.getCell(k % DCOLS, Math.floor(k / DCOLS))!.machineNumber,
                        `${label}: 旧存档格 ${k} 残留机器旗标`).toBe(0);
                }
                expect((reloaded as unknown as { machineCells: Set<number> }).machineCells.size,
                    `${label}: 旧存档残留 machineCells`).toBe(0);
            }
        }
        expect(levelsSeen, '必须覆盖全部 seed × 层，不能遇到首台机器就 break').toBe(SWEEP_SEEDS.length * MAX_DEPTH);
        expect(machinesSeen, '没有机器，往返合同空转').toBeGreaterThan(0);
        expect(flaggedCellsSeen, '没有非零旗标，序列化丢字段也会假绿').toBeGreaterThan(0);
        expect(clearedInteriorCellsSeen, '未覆盖 interior 中旗标为 0 的格').toBeGreaterThan(0);
    });

    it('AD3b: 人工墙上 feature 必在 interior 外；命中数 > 0 且逐格对应本机 feature 记录', () => {
        rng.seedRandomGenerator(20260922);
        const grid = new Grid(DCOLS, DROWS);
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
            }
        }
        const cells: Pos[] = [];
        for (let x = 5; x <= 8; x++) {
            for (let y = 5; y <= 6; y++) {
                cells.push({ x, y });
                grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            }
        }
        // 专门用纯地形 feature：它不产出 item/monster，不能再拿两种旧布点
        // 指令冒充全部 feature。所有合格候选均是 interior 外的相邻墙格，
        // 任一 RNG 落点都满足合同；无需挑自然生成层或钉坐标快照。
        const bp: BlueprintDef = {
            id: 'ad3_wall_feature_fixture', name: 'AD3 墙上地形 feature',
            depthRange: [1, 26], roomSize: [8, 8], frequency: 1,
            category: 'test', flags: ['BP_ROOM'],
            features: [{
                terrain: 'TORCH_WALL', instanceCount: [1, 1], minimumInstanceCount: 1,
                flags: ['MF_BUILD_IN_WALLS'],
            }],
        };
        const room = { cells, center: { x: 6, y: 5 }, door: null };
        const engine = new BlueprintEngine(grid, 5, [bp]);
        const result = (engine as unknown as {
            applyBlueprint(bp: BlueprintDef, room: { cells: Pos[]; center: Pos; door: Pos | null }): MachineResult | null;
        }).applyBlueprint(bp, room);
        expect(result, '人工房间必须建成机器').not.toBeNull();
        const mr = result!;
        // V-2b-7 的记录非空门与 A−B 命中门相互独立，缺任意一个都不能过。
        expect(mr.featureSpawns.length, '机器没有记录任何 feature 落点（记录点脱钩？）').toBeGreaterThan(0);
        expect(mr.itemSpawns).toEqual([]);
        expect(mr.monsterSpawns).toEqual([]);
        const interior = new Set(mr.cells.map(key));
        const featureKeys = new Set(mr.featureSpawns.map(s => key(s.pos)));
        let outsideHits = 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = grid.getCell(x, y)!;
                const k = y * DCOLS + x;
                if (cell.machineNumber === 0 || interior.has(k)) continue;
                outsideHits++;
                expect(cell.machineNumber, `外部格 (${x},${y}) 归属了错误机器`).toBe(mr.machineNumber);
                expect(featureKeys.has(k), `外部机器格 (${x},${y}) 缺本机 feature 记录`).toBe(true);
                expect(cell.terrain).toBe(TerrainType.TORCH_WALL);
            }
        }
        expect(outsideHits, 'A−B 必须命中，逐格守卫不能空转').toBeGreaterThan(0);
        for (const { pos } of mr.featureSpawns) {
            expect(interior.has(key(pos)), '墙上 feature 不得退回 interior').toBe(false);
            expect(grid.getCell(pos.x, pos.y)!.machineNumber,
                '已记录的外部 feature 必须在网格上标为本机').toBe(mr.machineNumber);
        }
    });

    it('AD4: 焦土长草不作用于机器格；真 CHARRED 格仍会复绿（机制活着，非空转）', () => {
        rng.seedRandomGenerator(20260916);
        const grid = new Grid(DCOLS, DROWS);
        // 机器区：FLOOR + machineNumber（P1-37 后的宝库形态）。若宝库被改回
        // CHARRED，或长草机制被改成无视机器，这片格必然出现复绿 → 红。
        for (let x = 2; x <= 40; x++) {
            for (let y = 2; y <= 12; y++) {
                grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
                grid.getCell(x, y)!.machineNumber = 1;
            }
        }
        // 焦土区：真被烧过的地面。26×76=1976 格 × 150 回合 × 0.05%/格回合
        // ≈ 期望 148 次复绿，P(零复绿) ≈ e^-148——"至少一格复绿"是确定性的。
        for (let x = 2; x <= 77; x++) {
            for (let y = 15; y <= 27; y++) {
                grid.setTerrain(x, y, TerrainType.CHARRED_FLOOR, '.', 0x554433);
            }
        }
        const env = new EnvironmentManager(grid);
        for (let t = 0; t < 150; t++) env.updateFires();

        let regrown = 0;
        const badMachine: string[] = [];
        for (let x = 2; x <= 40; x++) {
            for (let y = 2; y <= 12; y++) {
                const cell = grid.getCell(x, y)!;
                if (cell.terrain !== TerrainType.FLOOR) {
                    badMachine.push(`(${x},${y})->${cell.terrain}`);
                }
            }
        }
        for (let x = 2; x <= 77; x++) {
            for (let y = 15; y <= 27; y++) {
                const t2 = grid.getCell(x, y)!.terrain;
                if (t2 === TerrainType.GRASS || t2 === TerrainType.FOLIAGE) regrown++;
            }
        }
        expect(badMachine, `机器格被长草机制改写 ${badMachine.length} 格（长草未排除机器格，或宝库被改回 CHARRED）：\n${badMachine.slice(0, 10).join('\n')}`).toEqual([]);
        expect(regrown, '焦土区 150 回合零复绿——长草机制根本没跑，本用例在空转').toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// P1-37 第二件：硬编码英文接入 i18n + 扫描器增强
// ---------------------------------------------------------------------------

describe('P1-37 硬编码文案：真实 zh_CN 资源下渲染为中文', () => {
    // i18next 已在模块顶层用真实资源初始化（见文件头部说明）。
    const messages: string[] = [];

    function captureLog(): () => void {
        messages.length = 0;
        const prev = logger.log.bind(logger);
        logger.log = (text: string, color?: string) => { messages.push(text); prev(text, color); };
        return () => { delete (logger as { log?: unknown }).log; };
    }

    /** 新造一杖：满充/半充由调用方设定。 */
    function makeWand(): Item {
        const wand = ItemLoader.spawnWand('wand_of_teleportation', 0, 0);
        expect(wand, '传送魔杖生成失败').not.toBeNull();
        wand!.maxCharges = 2;
        wand!.charges = 2;
        return wand!;
    }

    it('AD5a: 充能/诅咒/解咒文案无英文字母（六条登记项 + 两条漏网项的渲染面）', () => {
        const game = createHeadlessGame(20260916);

        // ★ B-1b 后由验收方摘除三条到期断言 ★
        //
        // 原先这里用 `rechargeArcanaItem` / `uncurseItem` 当**载体**，断言
        // "充能已经满了" / "充能完全恢复了" / "没有被诅咒" 三条文案渲染成中文。
        // B-1b 按 D2 把这两个 web 自创的**免费按钮**整体删除（连同其 i18n 键），
        // 于是这三条断言**随功能一起到期**——被测的代码路径与文案都不存在了。
        //
        // 本用例的目的（"这些文案不以裸英文渲染"）对**存活下来的**文案完全保留：
        // 下面四条（背包解咒 / 慢充自然回复 / 充能卷轴 / 焦土）一字未动，
        // 守卫性质未放宽。
        //
        // 教训（已写进 project_conventions）：**删除类改动的 grep 关键词
        // 必须是"被删的公开名"**（`rechargeArcanaItem` / `uncurseItem`），
        // 而不是功能主题词——验收方的两段 grep 正是因此漏掉了这个引用者。

        // 背包解咒 → "不再受诅咒"
        const cursed = ItemLoader.spawnWeapon('sword', 0, 0)!;
        cursed.isCursed = true;
        cursed.enchantment = -1;
        game.player.inventory.items.push(cursed);
        let restore = captureLog();
        (game as unknown as { removeCurseFromInventory(): boolean }).removeCurseFromInventory();
        restore();
        const uncursedMsg = messages.find(m => m.includes('不再受诅咒'));
        expect(uncursedMsg, `应渲染中文"不再受诅咒"，实际日志：${messages.join(' | ')}`).toBeDefined();
        expect(uncursedMsg).not.toMatch(/[A-Za-z]/);

        // 慢充自然回复 → "恢复了一点充能"
        const trickle = makeWand();
        trickle.charges = 1;
        trickle.rechargeTurns = 200;
        trickle.rechargeCounter = 199;
        game.player.inventory.items.push(trickle);
        restore = captureLog();
        (game as unknown as { tickArcanaResources(): void }).tickArcanaResources();
        restore();
        const trickleMsg = messages.find(m => m.includes('恢复了一点充能'));
        expect(trickleMsg, `应渲染中文"恢复了一点充能"，实际日志：${messages.join(' | ')}`).toBeDefined();
        expect(trickleMsg).not.toMatch(/[A-Za-z]/);

        // 充能卷轴随机充能 → "力量重新涌入"
        const target = makeWand();
        target.charges = 1;
        game.player.inventory.items.push(target);
        restore = captureLog();
        (game as unknown as { rechargeRandomArcana(): boolean }).rechargeRandomArcana();
        restore();
        const restoredMsg = messages.find(m => m.includes('力量重新涌入'));
        expect(restoredMsg, `应渲染中文"力量重新涌入"，实际日志：${messages.join(' | ')}`).toBeDefined();
        expect(restoredMsg).not.toMatch(/[A-Za-z]/);
    });

    it('AD5b: 刺剑突进命中追加"猛烈突刺"，普通近战不带（B-1 登记项补齐）', () => {
        const game = createHeadlessGame(20260916);
        const ratData = (monsterData as MonsterData[]).find(m => m.id === 'rat');
        expect(ratData, 'monsters.json 缺 rat').toBeTruthy();

        // 目标必须清醒且非游荡：睡着/游荡会触发背刺分支（combat.backstab），
        // 抢在突进分支之前——CE 的突进对象本就是清醒怪（移动撞见）。
        const lungeTarget = new Monster(game.player.loc.x + 1, game.player.loc.y, ratData!);
        lungeTarget.state = MonsterState.HUNTING;
        game.monsters.push(lungeTarget);
        let restore = captureLog();
        (game as unknown as { resolvePlayerMeleeAttackOn(m: Monster, lunge?: boolean): boolean })
            .resolvePlayerMeleeAttackOn(lungeTarget, true);
        restore();
        const lungeMsg = messages.find(m => m.includes('猛烈突刺'));
        expect(lungeMsg, `突进命中应追加"猛烈突刺"措辞（CE Combat.c:1298），实际日志：${messages.join(' | ')}`).toBeDefined();

        const plainTarget = new Monster(game.player.loc.x + 1, game.player.loc.y, ratData!);
        plainTarget.state = MonsterState.HUNTING;
        game.monsters.push(plainTarget);
        restore = captureLog();
        (game as unknown as { resolvePlayerMeleeAttackOn(m: Monster, lunge?: boolean): boolean })
            .resolvePlayerMeleeAttackOn(plainTarget, false);
        restore();
        const plainMsg = messages.find(m => m.includes('击中'));
        expect(plainMsg, `普通近战应有普通命中文案，实际日志：${messages.join(' | ')}`).toBeDefined();
        expect(plainMsg, '普通近战不得带"猛烈突刺"').not.toContain('猛烈突刺');
    });

    it('AD5c: 附魔觉醒符文的文案走 i18n（runic 插值为内部 id，既有缺口照旧登记）', () => {
        const game = createHeadlessGame(20260916);
        const sword = ItemLoader.spawnWeapon('sword', 0, 0)!;
        delete (sword as { runicType?: string }).runicType;
        sword.runicKnown = false;
        game.player.inventory.items.push(sword);
        game.player.equippedWeapon = sword;

        // 强制 20% 觉醒掷骰命中（其余抽取走真实种子流）
        const rngAny = rng as unknown as { randPercent: (p: number) => boolean };
        const origRandPercent = rngAny.randPercent.bind(rng);
        rngAny.randPercent = () => true;
        const restore = captureLog();
        try {
            (game as unknown as { enchantEquippedItem(): boolean }).enchantEquippedItem();
        } finally {
            rngAny.randPercent = origRandPercent;
            restore();
        }
        const awakenMsg = messages.find(m => m.includes('觉醒了'));
        expect(awakenMsg, `附魔觉醒应渲染"觉醒了一枚…符文"，实际日志：${messages.join(' | ')}`).toBeDefined();
        expect(awakenMsg, '觉醒文案应包含符文 id（既有缺口：符文 id 暂无中文映射）').toMatch(/符文/);
    });

    it('扫描器门：全仓 logger.log 裸字符串零英文；中文硬编码钉死在既有清单', () => {
        const hits = findHardcodedLogStrings(REPO_SRC);
        const english = hits.filter(h => h.hasAsciiLetters);
        expect(english, `logger.log 首参出现英文硬编码 ${english.length} 处（玩家会看到英文）：\n` +
            english.map(h => `  ${h.file}:${h.line}  "${h.text}"`).join('\n')).toEqual([]);

        // 中文硬编码留痕（P1-30 红灯与 P1-37 扫描器都管不到渲染正确性，
        // 但中文对当前语种玩家可见，暂不强制改造）。新增任何一条都会红；
        // 若要把清单清零，请把这些调用点改为 i18next.t 并在 zh_CN.json 补键，
        // 然后同步收缩本清单。
        const KNOWN_CJK = ['测试模式：', '重置踏板触发：', '告示牌：'];
        const cjk = hits.filter(h => !h.hasAsciiLetters);
        const unknown = cjk.filter(h => !KNOWN_CJK.some(k => h.text.includes(k)));
        expect(unknown, `出现清单外的中文硬编码日志（请接 i18n 或登记）：\n` +
            unknown.map(h => `  ${h.file}:${h.line}  "${h.text}"`).join('\n')).toEqual([]);
        expect(cjk.length, `中文硬编码日志应只剩 ${KNOWN_CJK.length} 处（转化后请收缩 KNOWN_CJK）`)
            .toBeLessThanOrEqual(KNOWN_CJK.length);
    });
});
