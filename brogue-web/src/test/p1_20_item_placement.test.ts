/**
 * src/test/p1_20_item_placement.test.ts — 全局地面物品落格可通行性扫描（P1-20）
 *
 * 缺陷背景：BlueprintEngine.applyBlueprint 在放置 feature（含 MF_GENERATE_ITEM 物品）
 * 时，usedCells 只预先排掉了 room.center（P1-19 的修复），但**没有排掉 room.door**。
 * 门地形（如 LOCKED_DOOR）在 features 循环之前就已经写进 doorPos 格
 * （applyBlueprint 步骤 3），但 doorPos 仍留在 availableCells 里参与 features 循环
 * （步骤 4）——findFeaturePosition 因此可能把 _random_good_ / KEY 等物品 feature
 * 的坐标选到 doorPos 上，物品就落在了刚刚铺好的 LOCKED_DOOR 格。
 * blueprints.json 里 doorTerrain=LOCKED_DOOR 的蓝图（vestibule_locked /
 * vestibule_guardian / key_fire_trap / key_flood_trap / key_poison_gas /
 * key_web_room / key_boss）无一例外都带 `_random_good_` 物品 feature，
 * 正是报告里 24 件高价值物品的落点。
 *
 * 本测试跑多 seed × D1..D26 的真实生成链路，普通物品落点必须可通行。
 * U19e 按 CE Architect.c:1531 区分闭笼领养物品：只有完整玩家操作实际
 * 取到同一实例并返回入口，才证明其暂时阻路不是不可领取。非机器物品、
 * 缺失领养来源、损坏电路与不可完成的机器仍以零违规门槛拒绝。
 *
 * 可通行判据与 Game.canMoveTo(Game.ts:4776) 同源（WALL/GRANITE/SECRET_DOOR/
 * LOCKED_DOOR/WATER_DEEP 不可通行）；LAVA 单独判：canMoveTo 认为可走入，但
 * Game.ts:4662-4672 的 lava 清理逻辑会烧毁落在 LAVA 格上的物品——物品若一生成
 * 就落在 LAVA 上，等同于永久拿不到，故一并计入违例。
 */
import { afterEach, describe, it, expect } from 'vitest';
import { TerrainType } from '../engine/Map/Grid';
import type { Game } from '../engine/Core/Game';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
import type { MachineResult } from '../engine/Generator/BlueprintEngine';
import { setMachineObservationHook } from '../engine/Generator/MachineObservation';
import { runAltarActions } from './fixtures/u19e-machine-actions';
import { runMachineActions } from './fixtures/u19d-machine-actions';

afterEach(() => setMachineObservationHook(null));

interface MinimalProcess {
    env?: Record<string, string | undefined>;
}
const proc = (globalThis as { process?: MinimalProcess }).process;

type GameWithPrivates = Omit<Game, 'generateDepth' | 'canMoveTo'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
    canMoveTo(x: number, y: number): boolean;
};

function descendOne(game: Game, targetDepth: number): void {
    game.depth = targetDepth;
    (game as unknown as GameWithPrivates).generateDepth(false, false);
}

function walkable(game: Game, x: number, y: number): boolean {
    return (game as unknown as GameWithPrivates).canMoveTo(x, y);
}

function itemId(item: unknown): string {
    const o = item as { consumableId?: string; identityId?: string; category?: number };
    return o.consumableId ?? o.identityId ?? `category#${o.category}`;
}

const terrainNames: Record<number, string> = {
    [TerrainType.GRANITE]: 'GRANITE',
    [TerrainType.WALL]: 'WALL',
    [TerrainType.SECRET_DOOR]: 'SECRET_DOOR',
    [TerrainType.LOCKED_DOOR]: 'LOCKED_DOOR',
    [TerrainType.WATER_DEEP]: 'WATER_DEEP',
    [TerrainType.LAVA]: 'LAVA',
};

// 默认 4 个 seed（含题设点名的 seed424242 / seed777），覆盖 D1..D26。
// 可用 ITEM_PLACEMENT_SCAN_SEEDS 环境变量追加更多 seed 做大样本统计。
const DEFAULT_SCAN_SEEDS = [424242, 777, 20260913, 1];
const SCAN_SEEDS: number[] = [
    ...DEFAULT_SCAN_SEEDS,
    ...(proc?.env?.ITEM_PLACEMENT_SCAN_SEEDS ?? '')
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0),
];

describe('地面物品落格可通行性（全局扫描，P1-20）', () => {
    it(`${SCAN_SEEDS.length} seeds × D1..D26：普通物品落格可通行，闭笼领养奖励必须完整操作取出`, () => {
        const violations: string[] = [];
        const histogram = new Map<number, number>();
        let totalItems = 0;
        let levelCount = 0;
        const deferred: Array<{ snapshot: ReturnType<Game['toSnapshot']>; machine: MachineResult; itemId: number; violation: string }> = [];
        setMachineObservationHook(() => {});

        for (const seed of SCAN_SEEDS) {
            const game = createHeadlessGame(seed);
            let machines: MachineResult[] = [];
            const runtime = game as any;
            const populate = runtime.populateLevel.bind(game);
            runtime.populateLevel = (...args: any[]) => {
                const result = populate(...args);
                machines = args[3];
                return result;
            };
            game.startNewGame({ seed, mode: 'normal' });
            for (let depth = 1; depth <= 26; depth++) {
                if (depth > 1) descendOne(game, depth);
                levelCount++;

                for (const item of game.items) {
                    totalItems++;
                    const { x, y } = item.loc;
                    const cell = game.grid.getCell(x, y);
                    const terrain = cell?.terrain ?? -1;
                    const passable = walkable(game, x, y);
                    const inLava = terrain === TerrainType.LAVA;
                    if (!passable || inLava) {
                        const violation = `seed=${seed} D${depth} ${itemId(item)} @ (${x},${y}) ` +
                            `terrain=${terrainNames[terrain] ?? `#${terrain}`} 可通行=${passable}`;
                        // U19e: CE Architect.c:1531 explicitly places rewards in
                        // closed cages. Permit only an actual adopted instance
                        // whose complete generated machine can yield that same
                        // item through player commands below. No terrain whitelist.
                        const machine = machines.find(m => m.itemSpawns.some(s => s.viaAdoption && s.entity === item));
                        if (machine?.observation) {
                            deferred.push({ snapshot: JSON.parse(JSON.stringify(game.toSnapshot())), machine, itemId: item.id, violation });
                            continue;
                        }
                        histogram.set(terrain, (histogram.get(terrain) ?? 0) + 1);
                        violations.push(violation);
                    }
                }
            }
            console.log(`[item-placement] seed=${seed} D1..D26 substantive RNG 抽取总数: ${rng.randomNumbersGenerated}`);
        }

        // Replay after scanning, so command RNG and setup never alter later
        // generated floors. Missing circuits/targets/items remain violations.
        for (const row of deferred) {
            try {
                const replay = createHeadlessGame(19, 'test');
                expect(replay.loadSnapshot(row.snapshot)).toBe(true);
                const trace = row.machine.observation!;
                const result = trace.ceBlueprintId === 28
                    ? runMachineActions(replay, trace)
                    : runAltarActions(replay, trace, row.machine.door ?? row.machine.center);
                expect(result.rewardId).toBe(row.itemId);
                expect(replay.player.inventory.items.filter(i => i.id === row.itemId)).toHaveLength(1);
                expect(result.after.player).toEqual(result.entry);
            } catch (error) {
                violations.push(`${row.violation}; complete machine replay failed: ${String(error)}`);
            }
        }

        const histText = [...histogram.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => `${terrainNames[t] ?? `#${t}`}×${n}`)
            .join(', ');
        console.log(
            `[item-placement] 扫描 ${SCAN_SEEDS.length} seeds × ${levelCount} 层，` +
            `共 ${totalItems} 件地面物品，违例 ${violations.length} 条；地形分布：${histText || '（无）'}`
        );
        for (const v of violations.slice(0, 60)) console.log('[item-placement] 违例:', v);

        // 非空转护栏：扫描必须真的覆盖到足够多的地面物品，否则断言无意义
        expect(totalItems).toBeGreaterThan(500);
        expect(violations).toEqual([]);
    }, 180_000);
});
