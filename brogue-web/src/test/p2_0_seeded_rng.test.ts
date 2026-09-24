/// <reference types="node" />
/**
 * src/test/p2_0_seeded_rng.test.ts — P2-0：把未播种 Math.random 收编进项目 RNG
 *
 * 三类收编点的验收：
 * A. Monster.ts 游走/混乱移动 → SUBSTANTIVE 流：
 *    同 seed 同操作序列连跑两次，怪物最终位置/HP/场上数量必须完全一致。
 *    并对抗"游走误用 COSMETIC 流"的错误实现：两次运行插入不同量的
 *    COSMETIC 消耗（模拟帧率差异），玩法结果仍必须一致。
 * B. GameCanvas.vue 幻觉渲染 → COSMETIC 流：
 *    大量渲染取数前后 SUBSTANTIVE 计数不变，且后续玩法抽取与干净流一致
 *    （对抗"忘了切回/误用 SUBSTANTIVE"两种错误实现）。
 * C. 实体 id → 模块级单调计数器：
 *    大量创建无重复；读档（id 可能来自更早进程、高于当前计数器）后
 *    新建实体不得与存档 id 撞号。
 * 另加源码守卫：生产代码（非测试）不得再出现 Math.random( 。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHeadlessGame, runTurns, type TurnPolicy } from './harness';
import { rng, RNGType } from '../engine/Random';
import { allocateEntityId } from '../entities/Creature';
import { Monster, type MonsterData } from '../entities/Monster';
import { Item, ItemCategory } from '../engine/Items/Item';
import type { Game, GameSnapshot } from '../engine/Core/Game';

// GameCanvas.vue 的模块依赖（Input.ts 单例）在模块加载期访问 window；
// headless 下先 stub 再动态导入，只为拿到幻觉渲染的 COSMETIC 辅助函数。
let cosmeticPercent: (percent: number) => boolean;
let cosmeticPick: <T>(list: readonly T[]) => T;

beforeAll(async () => {
    vi.stubGlobal('window', {
        addEventListener: () => {},
        removeEventListener: () => {},
    });
    const mod = await import('../components/GameCanvas.vue');
    cosmeticPercent = mod.cosmeticPercent;
    cosmeticPick = mod.cosmeticPick;
});

const SEED = 20260914;

/**
 * 怪物终局快照：位置、HP、状态；外附场上数量与玩家 HP（战斗相关，增强信号）。
 * 刻意不含 m.id：id 来自进程级单调计数器，同进程内两次建局必然不同，
 * 它是标识不是玩法状态；比对它会把"计数器前进"误判为"玩法分歧"。
 */
function rosterOf(game: Game): string {
    return JSON.stringify({
        playerHp: game.player.hp,
        count: game.monsters.length,
        monsters: game.monsters.map((m) => ({
            x: m.loc.x, y: m.loc.y, hp: m.hp, state: m.state,
        })),
    });
}

type Privates = { canMoveTo(x: number, y: number): boolean };

/** 确定性玩家策略：不消耗任何 rng，操作序列只由局面决定。 */
const fixedPolicy: TurnPolicy = (game) => {
    const DIRS8: ReadonlyArray<readonly [number, number]> = [
        [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];
    const px = game.player.loc.x;
    const py = game.player.loc.y;
    const privates = game as unknown as Privates;

    for (const [dx, dy] of DIRS8) {
        const m = game.getMonsterAt(px + dx, py + dy);
        if (m && m.hp > 0 && !m.isAlly) {
            return { action: 'move', data: { x: dx, y: dy } };
        }
    }
    const movable = DIRS8.filter(([dx, dy]) =>
        privates.canMoveTo(px + dx, py + dy) && !game.getMonsterAt(px + dx, py + dy)
    );
    if (movable.length === 0) return { action: 'wait' };
    return { action: 'move', data: { x: movable[0]![0], y: movable[0]![1] } };
};

/**
 * 在每回合玩家行动前消耗 n 个 COSMETIC 随机数（模拟幻觉渲染随帧率的
 * 不定取数），玩法行动本身不变。
 */
function makeNoisyPolicy(cosmeticPerTurn: number): TurnPolicy {
    return (game, turn) => {
        if (cosmeticPerTurn > 0) {
            rng.setRNG(RNGType.RNG_COSMETIC);
            for (let i = 0; i < cosmeticPerTurn; i++) rng.randRange(0, 99);
            rng.setRNG(RNGType.RNG_SUBSTANTIVE);
        }
        return fixedPolicy(game, turn);
    };
}

/**
 * 在每回合玩家行动前录制整场局面（瞬态轨迹），比单比终局更敏感：
 * 游走怪的临时位移即使终局收敛，轨迹也会暴露分歧。
 */
function makeRecordingPolicy(policy: TurnPolicy, frames: string[]): TurnPolicy {
    return (game, turn) => {
        frames.push(rosterOf(game));
        return policy(game, turn);
    };
}

function runAndRecord(seed: number, policy: TurnPolicy): { frames: string[]; turnsRun: number } {
    const game = createHeadlessGame(seed);
    const frames: string[] = [];
    const result = runTurns(game, 60, makeRecordingPolicy(policy, frames));
    return { frames, turnsRun: result.turnsRun };
}

describe('P2-0 A: 怪物游走进 SUBSTANTIVE 流后玩法确定', () => {
    it('同 seed 同操作序列连跑两次，逐回合怪物位置/HP/数量完全一致', () => {
        const a = runAndRecord(SEED, fixedPolicy);
        const b = runAndRecord(SEED, fixedPolicy);

        expect(b.frames).toEqual(a.frames);
        expect(b.turnsRun).toBe(a.turnsRun);
    });

    it('两次运行插入不同量的 COSMETIC 消耗，玩法结果仍一致（游走不得用 COSMETIC 流）', () => {
        const a = runAndRecord(SEED, makeNoisyPolicy(7));
        const b = runAndRecord(SEED, makeNoisyPolicy(23));

        expect(b.frames).toEqual(a.frames);
        expect(b.turnsRun).toBe(a.turnsRun);
    });
});

describe('P2-0 B: 幻觉渲染走 COSMETIC 流，不污染玩法流', () => {
    const COLORS = ['#ff66ff', '#66ffff', '#ffff66', '#ff9966', '#99ff66'];
    const CHARS = ['*', '?', '!', '~', '&'];

    it('大量渲染取数后 SUBSTANTIVE 计数不变、后续玩法抽取与干净流一致', () => {
        expect(typeof cosmeticPercent).toBe('function');
        expect(typeof cosmeticPick).toBe('function');

        rng.seedRandomGenerator(12345);
        const before = rng.randomNumbersGenerated;
        let hits = 0;
        for (let i = 0; i < 1000; i++) {
            // 与 GameCanvas render 相同的三组取数形态：35% 判定 + 两次挑选
            if (cosmeticPercent(35)) hits++;
            cosmeticPick(COLORS);
            cosmeticPick(CHARS);
        }
        expect(hits).toBeGreaterThan(0);        // COSMETIC 流确实在出数
        expect(hits).toBeLessThan(1000);
        expect(rng.randomNumbersGenerated).toBe(before); // SUBSTANTIVE 计数不变

        // 若忘了切回或误用 SUBSTANTIVE：之后的玩法抽取将偏离干净流
        rng.seedRandomGenerator(12345);
        const clean = [rng.randRange(1, 100), rng.randRange(1, 100), rng.randRange(1, 100)];
        rng.seedRandomGenerator(12345);
        for (let i = 0; i < 500; i++) {
            cosmeticPercent(15);
            cosmeticPick(COLORS);
        }
        const after = [rng.randRange(1, 100), rng.randRange(1, 100), rng.randRange(1, 100)];
        expect(after).toEqual(clean);
    });
});

describe('P2-0 C: 实体 id 用单调计数器', () => {
    const RAT_DATA: MonsterData = {
        id: 'rat',
        name: 'Rat',
        char: 'r',
        color: 0x888888,
        hp: 6,
        damage: '1d3',
        minDepth: 1,
        maxDepth: 3,
        goldDropChance: 0,
        itemDropChance: 0,
    };

    it('大量创建实体，id 无重复', () => {
        const seen = new Set<number>();
        for (let i = 0; i < 2000; i++) {
            const item = new Item('test', '?', 0xffffff, ItemCategory.POTION);
            expect(seen.has(item.id)).toBe(false);
            seen.add(item.id);

            const m = new Monster(1, 1, RAT_DATA);
            expect(seen.has(m.id)).toBe(false);
            seen.add(m.id);
        }
    });

    it('读档后新建实体的 id 不与存档中已有 id 冲突', () => {
        // 用干跑测量一次 loadSnapshot 内部会烧掉多少个计数器 id
        // （Player/怪物/物品构造各分配一次；不预测内部实现，实测）。
        const probe = createHeadlessGame(777);
        const c0 = allocateEntityId();
        expect(probe.loadSnapshot(probe.toSnapshot())).toBe(true);
        const c1 = allocateEntityId();
        const burn = c1 - c0 - 1; // 干跑期间 loadSnapshot 内部消耗的 id 数

        // 构造敌意存档：把存档实体 id 改成"恰好覆盖计数器读档后即将发出的
        // 号段"。若读档没有把计数器推到存档最大 id 之上，读档后第一个新建
        // 实体必然拿到 c1 + burn + 1，与存档第一个实体撞号。
        const snap: GameSnapshot = probe.toSnapshot();
        const savedEntities: Array<{ id: number }> = [
            snap.player, ...snap.monsters, ...snap.dormantMonsters, ...snap.entityGraph.monsters,
            ...snap.items, ...snap.player.inventory, ...snap.entityGraph.items,
        ];
        expect(savedEntities.length).toBeGreaterThan(0);
        const idMap = new Map<number, number>();
        savedEntities.forEach((e, i) => idMap.set(e.id, c1 + burn + 1 + i));
        const reid = (id: number): number => {
            const mapped = idMap.get(id);
            expect(mapped).toBeDefined();
            return mapped!;
        };
        for (const entity of savedEntities) entity.id = reid(entity.id);
        for (const m of [...snap.monsters, ...snap.dormantMonsters, ...snap.entityGraph.monsters]) {
            if (m.leaderId != null) m.leaderId = reid(m.leaderId);
            if (m.carriedMonsterId != null) m.carriedMonsterId = reid(m.carriedMonsterId);
            if (m.carriedItemId != null) m.carriedItemId = reid(m.carriedItemId);
        }
        for (const slot of ['equippedWeaponId', 'equippedArmorId', 'ringLeftId', 'ringRightId'] as const) {
            if (snap.player[slot] != null) snap.player[slot] = reid(snap.player[slot]);
        }

        const used = new Set<number>(savedEntities.map((e) => e.id));
        expect(used.size).toBe(savedEntities.length);

        const target = createHeadlessGame(777);
        expect(target.loadSnapshot(snap)).toBe(true);

        // 存档实体重建后 id 保持原值（序列化往返不丢 id）
        for (const m of target.monsters) expect(used.has(m.id)).toBe(true);
        for (const it of [...target.items, ...target.player.inventory.items]) {
            expect(used.has(it.id)).toBe(true);
        }

        // 读档之后新建实体：id 必须全新
        for (let i = 0; i < 100; i++) {
            const m = new Monster(1, 1, RAT_DATA);
            expect(used.has(m.id)).toBe(false);
            const item = new Item('test', '?', 0xffffff, ItemCategory.POTION);
            expect(used.has(item.id)).toBe(false);
        }
    });
});

describe('P2-0 守卫: 生产代码不得再出现未播种随机源', () => {
    it('src/ 下（测试除外）没有任何 Math.random( 调用', () => {
        const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'test') continue; // 测试代码允许 stub Math.random
                const p = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(p);
                    continue;
                }
                if (!/\.(ts|vue)$/.test(entry.name)) continue;
                if (readFileSync(p, 'utf8').includes('Math.random(')) {
                    offenders.push(p);
                }
            }
        };
        walk(srcRoot);
        expect(offenders).toEqual([]);
    });
});
