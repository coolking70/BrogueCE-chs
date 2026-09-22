import { describe, expect, it } from 'vitest';
import { Architect } from '../engine/Generator/Architect';
import { AUTO_GENERATOR_CATALOG } from '../engine/Map/AutoGenerator';
import { rng } from '../engine/Random';

describe('V-2b-8 autoGenerator forced CE blueprints', () => {
    // V-2b-9e-2 顺延（7 → 13）：本轮把剩余六条 MT_* 从 'no-machine' 接线。
    // 按目录顺序新增 idx16 MT_PARALYSIS_TRAP_AREA(67)、idx23
    // MT_PARALYSIS_TRAP_HIDDEN_AREA(68)、idx44 MT_BRIDGE_TURRET_AREA(65)、
    // idx45 MT_LAKE_PATH_TURRET_AREA(66)、idx46 MT_TRICK_STATUE_AREA(69)、
    // idx48 MT_WORM_AREA(70)。至此 13 条 MT_* 全部接线，CE 目录无遗留
    // 'no-machine' 机器条目。
    // ⚠️ 66 虽已接线，但因实测湖心楼梯死局（seed26/D7、seed42/D6）由
    // RETIRED_AUTOGENERATOR_MACHINES 在掷骰前过滤 —— **接线状态与是否
    // 参与建造是两件事**，本断言钉的是前者。66 的恢复条件见该常量旁注释。
    it('wires all thirteen MT_* rows (V-2b-8 七条 + V-2b-9e-2 六条)', () => {
        const wired = AUTO_GENERATOR_CATALOG.filter(e => e.machine > 0 && e.carrier === 'wired');
        expect(wired.map(e => e.machine)).toEqual([67, 68, 61, 58, 59, 60, 63, 64, 65, 66, 69, 71, 70]);
        // MT_CAMP_AREA=62 is a horde association, not an autoGenerator row in CE.
        expect(AUTO_GENERATOR_CATALOG.some(e => e.machine === 62)).toBe(false);
    });

    it('production generation builds forced thematic machines, not merely catalog data', () => {
        const counts = new Map<string, number>();
        for (const seed of [3, 777, 424242]) {
            for (let depth = 1; depth <= 26; depth++) {
                rng.seedRandomGenerator(seed + depth * 1000003);
                const arch = new Architect();
                arch.generateLevel(depth);
                for (const r of arch.machineResults) {
                    if (r.blueprintId.startsWith('ce_')) counts.set(r.blueprintId, (counts.get(r.blueprintId) ?? 0) + 1);
                }
            }
        }
        expect([...counts.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        expect([...counts.keys()].some(k => /^ce_(58|59|60|61|63|64|71)_/.test(k))).toBe(true);
        expect(counts.has('ce_62_camp')).toBe(false);
    });
});
