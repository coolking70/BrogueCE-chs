/**
 * src/test/c_2_lakes_determinism.test.ts — C-2：湖泊管线决定性
 *
 * 同种子两次生成（Architect.generateTerrain 口径），地形指纹与四类液体
 * 计数逐一一致——把 C-2 新增的液体/镶边/清理/桥四阶段锁进"纯种子随机源"
 * 的合同里（P1-29 的决定性用例只计深水，不覆盖岩浆/硫矿/黑曜石）。
 */
import { describe, it, expect } from 'vitest';
import { Architect } from '../engine/Generator/Architect';
import { Grid, TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import { terrainFingerprint } from './harness';

/** 重扫描用例的显式超时：整段套件并行满载时会越过全局 120s。 */
const HEAVY = 300_000;

function countTerrain(g: Grid, t: TerrainType): number {
    let n = 0;
    for (let x = 0; x < g.width; x++) {
        for (let y = 0; y < g.height; y++) {
            if (g.getCell(x, y)?.terrain === t) n++;
        }
    }
    return n;
}

describe('C-2 决定性', () => {
    it('同种子两次生成，地形指纹与四类液体计数逐一一致', () => {
        for (const seed of [424242, 999, 20260913]) {
            const pass = (): string[] => {
                rng.seedRandomGenerator(seed);
                const arch = new Architect();
                const rows: string[] = [];
                for (let depth = 1; depth <= 26; depth++) {
                    const g = arch.generateTerrain(depth);
                    rows.push(`D${depth}:${terrainFingerprint(g)}|岩浆${countTerrain(g, TerrainType.LAVA)}` +
                        `|硫矿${countTerrain(g, TerrainType.INERT_BRIMSTONE)}|黑曜石${countTerrain(g, TerrainType.OBSIDIAN)}` +
                        `|深水${countTerrain(g, TerrainType.WATER_DEEP)}|浅水${countTerrain(g, TerrainType.WATER_SHALLOW)}`);
                }
                return rows;
            };
            const a = pass();
            const b = pass();
            expect(b, `seed${seed} 两次生成不一致（生成混入非种子随机源）`).toEqual(a);
        }
    }, HEAVY);
});
