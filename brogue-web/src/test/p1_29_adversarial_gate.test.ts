/**
 * src/test/p1_29_adversarial_gate.test.ts — P1-29 对抗性测试 AD1
 *
 * 错误实现：「连通性验证闸门被短路——总是接受候选位置」。这正是
 * P1-29 修复前的行为（以及任何把验证结果接反/忘接的经典事故）。
 * 预期：短接 lakeDisruptsPassability 后，湖泊阶段必须重新出现大量
 * "深水切断关卡"的不连通层（修复前实测约 8%，21/260）——证明闸门
 * 是承重墙，不是摆设。
 *
 * 用 vi.mock 只替换 lakeDisruptsPassability 一个函数，其余判据工具
 * 保持真实实现。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../engine/Map/Connectivity', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../engine/Map/Connectivity')>();
    return {
        ...actual,
        // 错误实现：验证恒通过（短路闸门）
        lakeDisruptsPassability: () => false,
    };
});

import { Architect } from '../engine/Generator/Architect';
import { terrainAllowsMove, DIRS8 } from '../engine/Map/Connectivity';
import { rng } from '../engine/Random';

const SEEDS = [424242, 777, 20260913, 31337, 20260916];
const MAX_DEPTH = 26;

describe('P1-29 对抗 AD1：闸门短路（总是接受候选位置）时不可达必须回升', () => {
    it('短接 lakeDisruptsPassability 后，湖泊阶段出现大量不连通层', () => {
        let total = 0;
        let broken = 0;
        const details: string[] = [];
        for (const seed of SEEDS) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (let depth = 1; depth <= MAX_DEPTH; depth++) {
                total++;
                const grid = arch.generateTerrain(depth);
                // 找第一个干地格并 8 向泛洪
                let first: { x: number; y: number } | null = null;
                let dryCount = 0;
                for (let x = 0; x < grid.width; x++) {
                    for (let y = 0; y < grid.height; y++) {
                        const cell = grid.getCell(x, y);
                        if (cell && terrainAllowsMove(cell.terrain)) {
                            dryCount++;
                            if (!first) first = { x, y };
                        }
                    }
                }
                if (!first) continue;
                const seen = new Set<number>([first.y * grid.width + first.x]);
                const queue = [first];
                while (queue.length > 0) {
                    const p = queue.pop()!;
                    for (const [dx, dy] of DIRS8) {
                        const nx = p.x + dx;
                        const ny = p.y + dy;
                        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
                        const key = ny * grid.width + nx;
                        if (seen.has(key)) continue;
                        const cell = grid.getCell(nx, ny);
                        if (!cell || !terrainAllowsMove(cell.terrain)) continue;
                        seen.add(key);
                        queue.push({ x: nx, y: ny });
                    }
                }
                if (seen.size !== dryCount) {
                    broken++;
                    details.push(`seed${seed}/D${depth}: 干地 ${dryCount} 中仅 ${seen.size} 格连通`);
                }
            }
        }

        console.log(`[p1_29 AD1] 闸门短路后：${broken}/${total} 层湖泊阶段不连通（闸门正常时应为 0）`);

        expect(
            broken,
            `闸门被短路后 ${broken}/${total} 层不连通——预期应大幅回升（修复前实测约 8%）。` +
            `若为 0，说明生产路径没有真正经过 lakeDisruptsPassability（闸门没接上）。` +
            `明细:\n${details.join('\n')}`
        ).toBeGreaterThan(0);
    });
});
