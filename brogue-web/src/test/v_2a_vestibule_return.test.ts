/**
 * src/test/v_2a_vestibule_return.test.ts — 前厅与守卫机器内容回归（V-2a）
 *
 * 背景：V-1c 还原了 CE 机器结构（资格过滤 + 配额 + 递归 + 回滚）但生产
 * 数据不带前厅/外包 feature，递归路径在生产数据下从未行使——vestibule/
 * key_guard 两类机器绝迹、锁门 35（15 局口径，V-1c 报告 §3）/本轮实测
 * 31（同口径自采）。V-2a 补上数据：
 *   1) 4 个 reward 蓝图按 CE 末尾统一前厅 feature
 *      （GlobalsBrogue.c:186/194/204/213/220/226 逐字核对：{0,0,0,{1,1},1,
 *      0,0,0,2,0,0, MF_BUILD_AT_ORIGIN|MF_PERMIT_BLOCKING|MF_BUILD_VESTIBULE}；
 *      reward_kennel 按 CE :243-251 原表**无**前厅 feature——任务书 2.1 的
 *      "5 个"与 CE 不符，见 v_2a_report §反驳）；
 *   2) vestibule_locked 按 CE :300 接 KEY + MF_OUTSOURCE_ITEM_TO_MACHINE
 *      钥匙外包（kind 维度 KEY_DOOR 归钥匙轮，本轮不扩）；
 *   3) reward_pedestals 落地 CE :218-219 两条 MF_ALTERNATIVE 基座大奖
 *      （V-1b 已实现机制，V-0 点名的双份发放陷阱由 T3 钉死）。
 *
 * 对抗面：
 *   T1「内容回归被回退」：递归 feature/旗标被拆、数据回滚到 V-1c →
 *      vestibule/key_guard/needsKey/pedestals 计数全部归零 → 下限断言红。
 *   T2「递归路径未行使」：V-1c 式"机制在、数据缺席"的中间态复活 →
 *      父子结构证据（reward→vestibule、vestibule_locked→key_guard）找不到 → 红；
 *      AT_ORIGIN 锚点被改成随机落位 → 门位同格性质断言红。
 *   T3「双份发放」：MF_ALTERNATIVE 机制被绕开（旗标漏读/循环前未抽）→
 *      每台 pedestal 同时发附魔卷轴与生命药水 → XOR 断言红。
 *
 * 哨兵纪律（任务书 §6.1）：全部经由 createHeadlessGame 完全隔离合成层
 * （形态②）+ 性质断言（形态③）；不锚定 RNG 流绝对位置。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import type { MachineResult } from '../engine/Generator/BlueprintEngine';
import type { Game } from '../engine/Core/Game';

type GameWithPrivates = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

const SEEDS = [424242, 777, 20260913, 31337];

/**
 * 跑 SEEDS 全部整局（D1-D26），收集 buildMachines 的深扁平化结果（每台
 * 机器一个 MachineResult，机器自身的 subMachines 字段保留父子结构）。
 */
function collectFullRun(): { all: MachineResult[]; tree: MachineResult[] } {
    const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
    const original = proto.buildMachines as (this: unknown) => MachineResult[];
    const all: MachineResult[] = [];
    const tree: MachineResult[] = [];
    proto.buildMachines = function (this: unknown) {
        const results = original.call(this);
        all.push(...results);
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
    // tree：从扁平列表恢复父子——扁平化（buildMachines 内 flatten）不清空
    // MachineResult.subMachines 字段，因此顶层机器仍挂着直接子机器。
    // 判定顶层：第一次出现（flatten 序 = 机器前序遍历，顶层先于其子）。
    for (const r of all) tree.push(r);
    return { all, tree };
}

const samePos = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
    a.x === b.x && a.y === b.y;

describe('V-2a 前厅与守卫机器内容回归', () => {

    it('T1 内容回归：4 整局中 vestibule/key_guard/锁门机器/基座大奖全部重现', () => {
        const { all } = collectFullRun();
        let vestibule = 0, keyGuard = 0, needsKey = 0, pedestals = 0;
        for (const r of all) {
            if (r.category === 'vestibule') vestibule++;
            if (r.category === 'key_guard') keyGuard++;
            if (r.needsKey) needsKey++;
            if (r.blueprintId === 'reward_pedestals') pedestals++;
        }
        // 4 局实测（V-2a 数据，seeds 见 SEEDS）：vestibule 18 / key_guard 6 /
        // needsKey 15 / pedestals 3。下限取实测的约 1/3，足以挡死一切
        // "递归失效→恒 0" 的合理错误实现，同时给 seed 波动留余量。
        // V-1c 后同类实测：vestibule=0、key_guard=0（绝迹）。
        expect(vestibule, '前厅机器未回归——MF_BUILD_VESTIBULE 数据或递归被回退？').toBeGreaterThanOrEqual(6);
        expect(keyGuard, '守卫机器未回归——KEY 外包数据或领养被回退？').toBeGreaterThanOrEqual(2);
        expect(needsKey, '锁门机器未回升（V-1c 后 4 局口径约 8 台）').toBeGreaterThanOrEqual(6);
        expect(pedestals, '基座大奖房未出现——reward_pedestals 被排除出抽签？').toBeGreaterThanOrEqual(1);
    });

    it('T2 递归路径在生产数据下真实行使：reward→vestibule、vestibule_locked→key_guard，且前厅锚在父门位', () => {
        const { all } = collectFullRun();
        // a) MF_BUILD_VESTIBULE 行使证据：存在 reward 机器，其 subMachines
        //    含 vestibule 子机器（CE :1543-1575 的 BUILD_VESTIBULE 分支）。
        const vestByReward = all.filter(r => r.category === 'reward'
            && r.subMachines.some(s => s.category === 'vestibule'));
        expect(vestByReward.length,
            '没有任何 reward 机器递归建出前厅——生产数据的 MF_BUILD_VESTIBULE feature 未被行使').toBeGreaterThanOrEqual(1);

        // b) MF_OUTSOURCE_ITEM_TO_MACHINE 行使证据：存在 vestibule_locked
        //    机器，其 subMachines 含 key_guard（CE :300 的 KEY 外包被领养）。
        const guardByLocked = all.filter(r => r.blueprintId === 'vestibule_locked'
            && r.subMachines.some(s => s.category === 'key_guard'));
        expect(guardByLocked.length,
            '没有任何 vestibule_locked 外包钥匙给守卫机器——MF_OUTSOURCE 未被生产数据行使').toBeGreaterThanOrEqual(1);

        // c) MF_BUILD_AT_ORIGIN 锚点性质（CE Architect.c:520-522/1404-1407）：
        //    前厅 feature 恒落在机器 origin（=父 reward 的门位格），不是
        //    随机内部格。所有（父 reward × 子 vestibule）对的门位必须同格。
        let pairs = 0;
        for (const parent of all) {
            if (parent.category !== 'reward') continue;
            for (const child of parent.subMachines) {
                if (child.category !== 'vestibule') continue;
                pairs++;
                expect(parent.door, '父 reward 机器缺门位记录').not.toBeNull();
                expect(child.door, '前厅子机器缺门位记录').not.toBeNull();
                expect(samePos(parent.door!, child.door!),
                    `前厅门位 (${child.door!.x},${child.door!.y}) ≠ 父机器门位 ` +
                    `(${parent.door!.x},${parent.door!.y})——AT_ORIGIN 锚点失守`).toBe(true);
            }
        }
        expect(pairs, '结构对缺失——a) 的证据链断裂').toBeGreaterThanOrEqual(1);
    });

    it('T3 基座二选一：每台 reward_pedestals 恰发（附魔卷轴 XOR 生命药水），绝无双份', () => {
        const { all } = collectFullRun();
        const peds = all.filter(r => r.blueprintId === 'reward_pedestals');
        expect(peds.length, '4 局竟无一台 reward_pedestals——T1 也会红，此处保证据链独立').toBeGreaterThanOrEqual(1);
        for (const r of peds) {
            const ench = r.itemSpawns.filter(s => s.id === 'scroll_of_enchantment').length;
            const life = r.itemSpawns.filter(s => s.id === 'potion_of_life').length;
            expect(ench + life, `seed 局的一台 pedestal 发出 ${ench + life} 件基座大奖` +
                `（ench=${ench}, life=${life}）——双份发放陷阱（V-0 点名）或替代集合失效`).toBe(1);
        }
    });
});
