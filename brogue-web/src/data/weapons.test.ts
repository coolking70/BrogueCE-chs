/**
 * src/data/weapons.test.ts — 武器表数值对齐回归（CE 权威基线）
 *
 * 黄金值来源：BrogueCE-master/src/brogue/Globals.c 的 weaponTable（表头 L1582），
 * 格式为 {name, frequency, marketValue, strengthRequired, power, range:{min,max,clumpFactor}}。
 * web 的 damage 记法经 Combat.parseDamageString 解析：min = X+Z、max = X*Y+Z、clumping = X，
 * 故 CE range {min,max,1} 统一写成 "1dN+M"（N = max−min+1，M = min−1）以同时满足
 * min/max 对齐与 clumping = 1。
 *
 * 覆盖范围：web 表 13 条中的 12 条 CE 对应条目。halberd 为 web 侧多余条目
 * （CE weaponTable 无对应行），无权威值可断言，不在本表内（详见交付报告）。
 * CE 的 incendiary dart（L1601）与 javelin（L1602）web 表中不存在，本任务不新增。
 */
import { describe, it, expect } from 'vitest';
import weaponsJson from './weapons.json';
import { CombatSystem } from '../engine/Combat/Combat';

interface WeaponEntry {
    id: string;
    name: string;
    strengthRequired: number;
    damage: string;
}

const weapons = weaponsJson as WeaponEntry[];
const byId = new Map(weapons.map(w => [w.id, w]));

/** CE 权威值：str = strengthRequired；min/max 来自 range{min,max,clumpFactor=1}。 */
const CE_WEAPONS = {
    dagger:     { str: 12, min: 3,  max: 4 },
    sword:      { str: 14, min: 7,  max: 9 },
    broadsword: { str: 19, min: 14, max: 22 },
    whip:       { str: 14, min: 3,  max: 5 },
    rapier:     { str: 15, min: 3,  max: 5 },
    flail:      { str: 17, min: 9,  max: 15 },
    mace:       { str: 16, min: 16, max: 20 },
    war_hammer: { str: 20, min: 25, max: 35 },
    spear:      { str: 13, min: 4,  max: 5 },
    war_pike:   { str: 18, min: 11, max: 15 },
    axe:        { str: 15, min: 7,  max: 9 },
    dart:       { str: 10, min: 2,  max: 4 },
} as const;

/** 全部 12 件 CE 对应武器都必须在 web 表中存在。 */
describe('weapons.json — CE weaponTable 条目齐全', () => {
    it('12 件 CE 武器 id 全部存在', () => {
        for (const id of Object.keys(CE_WEAPONS)) {
            expect(byId.has(id), `缺少 CE 武器：${id}`).toBe(true);
        }
    });
});

describe('weapons.json — strengthRequired 与 damage 解析值对齐 Globals.c weaponTable', () => {
    it('dagger：str=12，1d2+2 → min=3/max=4/clumping=1', () => {
        const w = byId.get('dagger')!;
        // Globals.c:1583  dagger str=12 range={3,4,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.dagger.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.dagger.min);
        expect(p.max).toBe(CE_WEAPONS.dagger.max);
        expect(p.clumping).toBe(1);
    });

    it('sword：str=14，1d3+6 → min=7/max=9/clumping=1', () => {
        const w = byId.get('sword')!;
        // Globals.c:1584  sword str=14 range={7,9,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.sword.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.sword.min);
        expect(p.max).toBe(CE_WEAPONS.sword.max);
        expect(p.clumping).toBe(1);
    });

    it('broadsword：str=19，1d9+13 → min=14/max=22/clumping=1', () => {
        const w = byId.get('broadsword')!;
        // Globals.c:1585  broadsword str=19 range={14,22,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.broadsword.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.broadsword.min);
        expect(p.max).toBe(CE_WEAPONS.broadsword.max);
        expect(p.clumping).toBe(1);
    });

    it('whip：str=14，1d3+2 → min=3/max=5/clumping=1', () => {
        const w = byId.get('whip')!;
        // Globals.c:1587  whip str=14 range={3,5,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.whip.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.whip.min);
        expect(p.max).toBe(CE_WEAPONS.whip.max);
        expect(p.clumping).toBe(1);
    });

    it('rapier：str=15，1d3+2 → min=3/max=5/clumping=1', () => {
        const w = byId.get('rapier')!;
        // Globals.c:1588  rapier str=15 range={3,5,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.rapier.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.rapier.min);
        expect(p.max).toBe(CE_WEAPONS.rapier.max);
        expect(p.clumping).toBe(1);
    });

    it('flail：str=17，1d7+8 → min=9/max=15/clumping=1', () => {
        const w = byId.get('flail')!;
        // Globals.c:1589  flail str=17 range={9,15,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.flail.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.flail.min);
        expect(p.max).toBe(CE_WEAPONS.flail.max);
        expect(p.clumping).toBe(1);
    });

    it('mace：str=16，1d5+15 → min=16/max=20/clumping=1', () => {
        const w = byId.get('mace')!;
        // Globals.c:1591  mace str=16 range={16,20,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.mace.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.mace.min);
        expect(p.max).toBe(CE_WEAPONS.mace.max);
        expect(p.clumping).toBe(1);
    });

    it('war_hammer：str=20，1d11+24 → min=25/max=35/clumping=1', () => {
        const w = byId.get('war_hammer')!;
        // Globals.c:1592  war hammer str=20 range={25,35,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.war_hammer.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.war_hammer.min);
        expect(p.max).toBe(CE_WEAPONS.war_hammer.max);
        expect(p.clumping).toBe(1);
    });

    it('spear：str=13，1d2+3 → min=4/max=5/clumping=1', () => {
        const w = byId.get('spear')!;
        // Globals.c:1594  spear str=13 range={4,5,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.spear.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.spear.min);
        expect(p.max).toBe(CE_WEAPONS.spear.max);
        expect(p.clumping).toBe(1);
    });

    it('war_pike：str=18，1d5+10 → min=11/max=15/clumping=1', () => {
        const w = byId.get('war_pike')!;
        // Globals.c:1595  war pike str=18 range={11,15,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.war_pike.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.war_pike.min);
        expect(p.max).toBe(CE_WEAPONS.war_pike.max);
        expect(p.clumping).toBe(1);
    });

    it('axe：str=15，1d3+6 → min=7/max=9/clumping=1', () => {
        const w = byId.get('axe')!;
        // Globals.c:1597  axe str=15 range={7,9,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.axe.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.axe.min);
        expect(p.max).toBe(CE_WEAPONS.axe.max);
        expect(p.clumping).toBe(1);
    });

    it('dart：str=10，1d3+1 → min=2/max=4/clumping=1', () => {
        const w = byId.get('dart')!;
        // Globals.c:1600  dart str=10 range={2,4,1}
        expect(w.strengthRequired).toBe(CE_WEAPONS.dart.str);
        const p = CombatSystem.parseDamageString(w.damage);
        expect(p.min).toBe(CE_WEAPONS.dart.min);
        expect(p.max).toBe(CE_WEAPONS.dart.max);
        expect(p.clumping).toBe(1);
    });
});
