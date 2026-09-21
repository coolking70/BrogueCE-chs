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
 *  AD3（用例 3）machineNumber 不穿存档往返（快照序列化被删）→ 翻红；
 *  AD4（用例 4）焦土长草作用在机器格 / 宝库被改回 CHARRED → 翻红；
 *  AD5（用例 5-7）任一原硬编码英文仍以英文渲染 / 扫描器裸字符串门失效 → 翻红。
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
import type { MachineResult } from '../engine/Generator/BlueprintEngine';
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

/** 复用 P1-33 的记录器手法：包裹 buildMachines 记下每层 MachineResult。 */
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

    it('AD3: 机器旗标穿存档往返；旧存档（无字段）读入为无机器', () => {
        const record: LevelMachines[] = [];
        const restore = installRecorder(record);
        let snapshot: ReturnType<Game['toSnapshot']> | null = null;
        let allMachineCells: Pos[] = [];
        // V-2b-3：machineCells 的**权威参照系是网格**，不是 mr.cells 的并集。
        // loadSnapshot 就是「扫网格 machineNumber≠0 重建 machineCells」
        //（Game.ts:7973-7979），所以往返的判据只能是同口径的网格派生集。
        // 见下方"口径校正"注。
        let gridDerived = new Set<number>();
        let gridMachineNumberAtPick: Map<number, number> = new Map();
        let levelResults: MachineResult[] = [];
        let pickedLevel = 0;
        try {
            const game = createHeadlessGame(424242);
            for (let d = 1; d <= MAX_DEPTH; d++) {
                if (d > 1) {
                    (game as unknown as { depth: number }).depth = d;
                    (game as unknown as GameWithPrivates).generateDepth(false, false);
                }
                const entry = record[record.length - 1];
                if (entry?.results.length) {
                    // 该层全部机器的内部格（一层可能有多台机器）
                    allMachineCells = entry.results.flatMap(mr => mr.cells);
                    levelResults = entry.results;
                    gridDerived = new Set<number>();
                    gridMachineNumberAtPick = new Map<number, number>();
                    for (let x = 0; x < game.grid.width; x++) {
                        for (let y = 0; y < game.grid.height; y++) {
                            const mn = game.grid.getCell(x, y)?.machineNumber ?? 0;
                            if (mn !== 0) gridDerived.add(y * DCOLS + x);
                            gridMachineNumberAtPick.set(y * DCOLS + x, mn);
                        }
                    }
                    snapshot = game.toSnapshot();
                    pickedLevel = d;
                    break;
                }
            }
        } finally {
            restore();
        }
        expect(snapshot, '424242 前 26 层竟无一台机器（无法验证往返）').not.toBeNull();
        expect(allMachineCells.length, '选中机器没有内部格').toBeGreaterThan(0);
        const unionKeys = new Set(allMachineCells.map(key));

        // 序列化点：机器格的 machineNumber 必须出现在快照里。
        // V-2b-6 口径校正（与下方 machineCells 断言同律）：参照系用 gridDerived
        //（网格 machineNumber≠0），不用 ∪ mr.cells——本轮 V-2b-6 的流位移让
        // seed424242/D3 建成了 15 号 vestibule_pit_trap_field（BP_NO_INTERIOR_
        // FLAG，CE :1691-1702 建成后把非 wired 格的 machineNumber 清 0），
        // mr.cells 参照的逐格断言第二次露馅（V-2b-3 已预言："把这颗走运的
        // 骰子挪开了"）。B = ∪ mr.cells 里的 NO_INTERIOR_FLAG 格按 CE 字面
        // **必须**为 0——反向钉死（守卫变强：清标记漏做即红）。
        const cellByKey = new Map(snapshot!.grid.map(c => [c.y * DCOLS + c.x, c]));
        for (const k of gridDerived) {
            const sc = cellByKey.get(k);
            expect(sc, `快照缺 (${k % DCOLS},${Math.floor(k / DCOLS)})`).toBeDefined();
            expect(sc!.machineNumber ?? 0, `快照里 (${k % DCOLS},${Math.floor(k / DCOLS)}) 的机器旗标丢失（序列化被删？）`).not.toBe(0);
        }
        {
            const noInteriorMachines = levelResults.filter(mr =>
                (mr.blueprintId === 'vestibule_pit_trap_field'));
            for (const mr of noInteriorMachines) {
                for (const p of mr.cells) {
                    const sc = cellByKey.get(key(p));
                    expect(sc, `快照缺 (${p.x},${p.y})`).toBeDefined();
                    // wired 载体格不受 NO_INTERIOR_FLAG 清除（CE :1695 的豁免位），
                    // 其余格字面为 0。快照里的 machineNumber 与网格同源，直接查。
                    expect(sc!.machineNumber ?? 0,
                        `NO_INTERIOR_FLAG 机器 ${mr.blueprintId} 的 (${p.x},${p.y}) 快照态与网格不符（非 wired 格应为 0）`)
                        .toBe(gridMachineNumberAtPick.get(key(p)) ?? 0);
                }
            }
        }

        // ★★ V-2b-3 口径校正：原断言 `machineCells.size === |∪ mr.cells|` ★★
        //
        // 原口径把两个**不同**的集合当成了同一个：
        //   A = 网格上 machineNumber≠0 的格（= loadSnapshot 重建 machineCells 的源）
        //   B = ∪ mr.cells（= 各机器的 interior，MachineResult 自己的口径）
        // A ≠ B 是 CE 的常态、有两个独立机制：
        //   ① CE Architect.c:1484-1486「Mark the feature location as part of the
        //      machine, in case it is not already inside of it」——feature 落在
        //      interior 之外（MF_BUILD_ANYWHERE_ON_LEVEL / MF_BUILD_IN_WALLS）时，
        //      pmap 上打 IS_IN_AREA_MACHINE + machineNumber，但**不进 p->interior**；
        //   ② BP_NO_INTERIOR_FLAG（CE :1685-1697）事后把非 wired 格的 machineNumber
        //      清回 0——于是 B 里的格反而不再在 A 里。
        // 本轮实测（5 seed × D1-D26 全扫，130 层中 31 层有机器）：**25/31 层 A≠B**，
        // 差值双向出现（示例：424242/D3 A−B=1；777/D26 A−B=1 而 B−A=114，后者是
        // 23/67/68 号 BP_NO_INTERIOR_FLAG 清标记所致）。也就是说这条断言原本
        // 只在"该层首台机器既无 interior 外 feature 落位、也无 NO_INTERIOR_FLAG"
        // 这种偶然层上成立——**它给出的信心一直是假的**（与 B-4a「挑 seed 的测试」
        // 同族）。V-2b-3 的六条新蓝图移动了 RNG 流，把这颗走运的骰子挪开了，
        // 于是它在 seed424242/D3 上露出原形。
        // **实现无缺陷**（A 与 B 都各自忠实于 CE）；错的是断言的参照系。
        // 校正后的判据改成与 loadSnapshot 同口径：逐元素等于 A，仍不许放宽成
        // 不等式/长度比较。
        expect(gridDerived.size, '选中层竟没有网格机器格（记录器或旗标失效）').toBeGreaterThan(0);

        // 反序列化点：读入新实例后旗标与 machineCells 都恢复
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snapshot!)).toBe(true);
        for (const k of gridDerived) {
            const x = k % DCOLS, y = Math.floor(k / DCOLS);
            expect(reloaded.grid.getCell(x, y)!.machineNumber,
                `读档后 (${x},${y}) 机器旗标丢失`).not.toBe(0);
        }
        const machineCells = (reloaded as unknown as { machineCells: Set<number> }).machineCells;
        expect(machineCells.size,
            '读档后 machineCells 未从网格重建（落位检查退化为不查机器）').toBe(gridDerived.size);
        for (const k of gridDerived) {
            expect(machineCells.has(k), `读档后 machineCells 缺网格机器格 (${k % DCOLS},${Math.floor(k / DCOLS)})`).toBe(true);
        }
        for (const k of machineCells) {
            expect(gridDerived.has(k), `读档后 machineCells 多出非网格机器格 (${k % DCOLS},${Math.floor(k / DCOLS)})`).toBe(true);
        }

        // A−B 的越界守卫：网格多出来的格必须**恰是机器自己的布点**
        //（CE :1486 的 feature 并入机器）：本层的 feature/怪物布点 ∪ center。
        // 数量与坐标一并钉死——机器构成变动（新蓝图入池 / feature 落点规则改动）
        // 时本行会红，届时请按 CE GlobalsBrogue.c 重核该层的机器与落位再更新。
        // ★ V-2b-7：本组断言的力量在这里恢复。★
        //
        // V-2b-3 的注已经写明：CE Architect.c:1484-1486「Mark the feature
        // location as part of the machine」对**一切** feature 生效，而
        // MachineResult 此前只暴露 itemSpawns / monsterSpawns，地形类与纯 DF
        // 类 feature 的落点没有载体——于是"每个 A−B 格都是机器的布点"这个
        // 判据**结构上无法成立**，V-2b-3/4/5/6 四轮里它要么空转（A−B 为空）、
        // 要么必然假红。V-2b-7 把 featureSpawns（每个成功实例的落点，
        // 记录点与 BlueprintEngine 里写 machineNumber 的那一行同址）暴露出来，
        // 这条逐格断言从此**真的在跑**：feature 落点没被记进机器 → 翻红。
        const spawnKeys = new Set<number>();
        for (const mr of levelResults) {
            spawnKeys.add(key(mr.center));
            for (const s of mr.itemSpawns) spawnKeys.add(key(s.pos));
            for (const s of mr.monsterSpawns) spawnKeys.add(key(s.pos));
            for (const s of mr.featureSpawns) spawnKeys.add(key(s.pos));
        }
        // 非空性哨兵：所选层的机器必须真的记录了 feature 落点。字段被删/
        // 记录点被挪到别处（与本判定脱钩）时，这里先红，不会等到 A−B 恰好
        // 为空的那一层才暴露。
        expect(levelResults.reduce((n, mr) => n + mr.featureSpawns.length, 0),
            '机器没有记录任何 feature 落点——A−B 逐格断言会退化为空转（记录点脱钩？）')
            .toBeGreaterThan(0);
        const outsideInterior = [...gridDerived].filter(k => !unionKeys.has(k))
            .map(k => `${k % DCOLS},${Math.floor(k / DCOLS)}`).sort();
        for (const k of gridDerived) {
            if (unionKeys.has(k)) continue;
            expect(spawnKeys.has(k),
                `网格机器格 (${k % DCOLS},${Math.floor(k / DCOLS)}) 既不在任何机器 interior、也不是任何机器的 feature/怪物布点——CE :1486 之外的来源`)
                .toBe(true);
        }
        // ★ V-2b-4 顺延（本文件在 V-2b-4 任务书 §4 授权清单内）★
        // 原 pin 是「本层 A−B = ['25,23']」（5 号 vestibule_flammable_barricade
        // 的焚化药水经 MF_BUILD_ANYWHERE_ON_LEVEL 落在 interior 之外）。
        // V-2b-4 的蓝图池变动把"首个有机器的层"从 424242/D3 挪到了别的层，
        // 新层的 A−B = ∅——按"顺延不放宽"把 pin 更新为新事实（仍**全等**钉死，
        // 不改成长度/包含比较）。
        //
        // 同时如实登记一处**守卫力量下降**：本层 A−B 为空 ⇒ 上面那条逐格
        // 循环在本层是空转。它不能简单地改为"挑一个 A−B≠∅ 的层"——实测那样
        // 会翻红，但**不是实现缺陷**：CE Architect.c:1484-1486「Mark the
        // feature location as part of the machine」对**一切** feature 生效，
        // 而 locale 只暴露 item/monster 布点，地形类 feature（本例的
        // MF_BUILD_IN_WALLS 墙火把在 (1,8)）合法地没有布点指令。
        // 也就是说"每个 A−B 格都是 item/monster 布点"这个前提**从来就过强**，
        // 只是上一轮恰好选中了一层没暴露它。要做到非空转需要 MachineResult
        // 暴露 feature 落点（归 V-2b-7 的 df/feature 列），本轮登记不动手。
        // ★ V-2b-5 顺延（本文件在 V-2b-5 任务书 §5 授权清单内）★
        // 原 pin（V-2b-4 顺延后）是「本层 A−B = []」。V-2b-5 的八条蓝图入池
        // 再次移动 RNG 流，选中层回到 424242/D3，新事实 A−B = ['13,10']。
        // 已按消息自带流程重核：该格 machineNumber=17 =
        // vestibule_flammable_barricade（18 号）——其木栅/门位 feature 落在
        // 单格 interior（cells=1，即 origin 本身）之外，CE Architect.c:1484-1486
        // 「Mark the feature location as part of the machine, in case it is not
        // already inside of it」的字面行为，实现无缺陷。仍**全等**钉死。
        // ★ V-2b-6 顺延（本文件在 V-2b-6 任务书 §5 授权清单内）★
        // 原 pin（V-2b-5 顺延后）是「424242/D3 A−B = ['13,10']」（18 号
        // vestibule_flammable_barricade 的 feature 落在单格 interior 之外）。
        // V-2b-6 的钥匙轮流位移再次改变 D3 机器构成（现为 6/15 号
        // reward_consumables ×2 + 11 号 vestibule_pit_trap_field +
        // 17 号 vestibule_throwing_tutorial，18 号不在本层），新事实
        // A−B = ∅。仍**全等**钉死。守卫力量下降的登记与上方注同（本轮
        // AD3 逐格断言的参照系已改为 gridDerived，空转问题随参照系校正消解）。
        // ★ V-2b-7 顺延（本文件在 V-2b-7 任务书 §4 授权清单内）★
        // 原 pin（V-2b-6 顺延后）是「424242/D3 A−B = ∅」。V-2b-7 的 13 条新
        // 蓝图 + LoopMap.CE_CHOKE_COUNT_CAP 41→176 一起移动了 RNG 流，选中层
        // 仍是 424242/D3，新事实 A−B = 六格（机器构成为
        // reward_single_category_library#1 / vestibule_locked#2 /
        // key_burning_grass#3 / reward_single_category_library#4 /
        // vestibule_locked#5 / key_secret_room#8）。
        // 已按消息自带流程重核：六格的 machineNumber 分别属 #1/#1/#3/#4/#4/#4，
        // 且**每一格都出现在对应机器的 featureSpawns 里**（feature 落在
        // interior 之外，CE :1484-1486 的字面行为，实现无缺陷）。
        // 仍**全等**钉死（不是长度/包含比较）。
        // 净效果：这个 pin 从"空转"变成"有牙齿"——V-2b-3/4/5/6 四轮一直
        // 想钉的就是它，本轮终于能把 feature 落点纳入参照系。
        expect(outsideInterior,
            `A−B（网格派生 − ∪mr.cells）变动（选中层 D${pickedLevel}）：按 CE GlobalsBrogue.c ` +
            '重核该层的机器与落位；本层的 A−B 非空时，逐格循环会真的执行（见上方注）')
            // V-2b-8 的强制 thematic 机器再次移动生成流；按上方
            // featureSpawns 反查流程复核，新事实为单格。
            .toEqual(['5,14']);

        // 旧存档兼容：字段整体缺失 = 无机器（读入不抛、旗标为 0）
        const legacy = JSON.parse(JSON.stringify(snapshot!)) as ReturnType<Game['toSnapshot']>;
        for (const c of legacy.grid) delete c.machineNumber;
        const legacyGame = createHeadlessGame(1);
        expect(legacyGame.loadSnapshot(legacy)).toBe(true);
        expect(legacyGame.grid.getCell(allMachineCells[0]!.x, allMachineCells[0]!.y)!.machineNumber).toBe(0);
        expect((legacyGame as unknown as { machineCells: Set<number> }).machineCells.size).toBe(0);
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
