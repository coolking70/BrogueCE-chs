/**
 * src/data/armors.test.ts — 护甲表数值对齐回归（CE 权威基线）
 *
 * 黄金值来源：BrogueCE-master/src/brogue/Globals.c 的 armorTable（表头 L1606）。
 * 注意：CE 的 armor 字段是 ×10 定点（显示值 = armor/10，见 Items.c:1544），
 * web 的 armor 字段存的是显示值，因此 web 值 = CE 值 ÷ 10。
 *
 * web 的 "plate_mail"（Plate Mail）对应 CE 的 "plate armor"（L1611），
 * 沿用 web 现有 id/名称，仅对齐数值。
 */
import { describe, it, expect } from 'vitest';
import armorsJson from './armors.json';

interface ArmorEntry {
    id: string;
    name: string;
    strengthRequired: number;
    armor: number;
}

const armors = armorsJson as ArmorEntry[];
const byId = new Map(armors.map(a => [a.id, a]));

/** CE 权威值：armor 列为「CE 定点值 ÷ 10」后的 web 显示值。 */
const CE_ARMORS = {
    leather_armor: { str: 10, armor: 3 },  // CE 30
    scale_mail:    { str: 12, armor: 4 },  // CE 40
    chain_mail:    { str: 13, armor: 5 },  // CE 50
    banded_mail:   { str: 15, armor: 7 },  // CE 70
    splint_mail:   { str: 17, armor: 9 },  // CE 90
    plate_mail:    { str: 19, armor: 11 }, // CE 110
} as const;

describe('armors.json — 全部 6 件护甲对齐 Globals.c armorTable', () => {
    it('6 件护甲 id 全部存在', () => {
        for (const id of Object.keys(CE_ARMORS)) {
            expect(byId.has(id), `缺少 CE 护甲：${id}`).toBe(true);
        }
    });

    it('leather_armor：str=10，armor=3（CE 30 ÷10）', () => {
        const a = byId.get('leather_armor')!;
        // Globals.c:1606  leather armor str=10 armor=30（×10 定点）
        expect(a.strengthRequired).toBe(CE_ARMORS.leather_armor.str);
        expect(a.armor).toBe(CE_ARMORS.leather_armor.armor);
    });

    it('scale_mail：str=12，armor=4（CE 40 ÷10）', () => {
        const a = byId.get('scale_mail')!;
        // Globals.c:1607  scale mail str=12 armor=40（×10 定点）
        expect(a.strengthRequired).toBe(CE_ARMORS.scale_mail.str);
        expect(a.armor).toBe(CE_ARMORS.scale_mail.armor);
    });

    it('chain_mail：str=13，armor=5（CE 50 ÷10）', () => {
        const a = byId.get('chain_mail')!;
        // Globals.c:1608  chain mail str=13 armor=50（×10 定点）
        expect(a.strengthRequired).toBe(CE_ARMORS.chain_mail.str);
        expect(a.armor).toBe(CE_ARMORS.chain_mail.armor);
    });

    it('banded_mail：str=15，armor=7（CE 70 ÷10）', () => {
        const a = byId.get('banded_mail')!;
        // Globals.c:1609  banded mail str=15 armor=70（×10 定点）
        expect(a.strengthRequired).toBe(CE_ARMORS.banded_mail.str);
        expect(a.armor).toBe(CE_ARMORS.banded_mail.armor);
    });

    it('splint_mail：str=17，armor=9（CE 90 ÷10）', () => {
        const a = byId.get('splint_mail')!;
        // Globals.c:1610  splint mail str=17 armor=90（×10 定点）
        expect(a.strengthRequired).toBe(CE_ARMORS.splint_mail.str);
        expect(a.armor).toBe(CE_ARMORS.splint_mail.armor);
    });

    it('plate_mail：str=19，armor=11（CE 110 ÷10）', () => {
        const a = byId.get('plate_mail')!;
        // Globals.c:1611  plate armor str=19 armor=110（×10 定点）
        expect(a.strengthRequired).toBe(CE_ARMORS.plate_mail.str);
        expect(a.armor).toBe(CE_ARMORS.plate_mail.armor);
    });
});
