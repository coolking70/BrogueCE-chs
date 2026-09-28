import { beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import { ItemCategory as C, type Item } from '../engine/Items/Item';
import { ItemLoader as L } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { createItemDetailContext, type ItemDetailContext } from '../engine/UI/ItemDetailContext';
import { itemKnowledge } from '../engine/UI/ItemKnowledge';
import { Player } from '../entities/Player';
import { enchantedDamage, netEnchant, runicWeaponChance } from '../engine/Combat/CombatFormulas';
import { charmRechargeDelay } from '../engine/Items/CharmModel';
import { WAND_INITIAL_RANGES } from '../engine/Items/ArcanaInstance';
import { createHeadlessGame } from './harness';
import { BoltEffect } from '../engine/Combat/Bolt';
import { Monster, type MonsterData } from '../entities/Monster';
import monsterData from '../data/monsters.json';

const text = (item: Item, ctx: number | ItemDetailContext = 12) => generateItemDetail(item, ctx).sections.flatMap(s => s.lines.map(l => l.text)).join('\n');
const ctx: ItemDetailContext = { strength: 12, hp: 17, maxHp: 30, nutrition: 200, maxNutrition: 2150,
    carried: true, equipped: false, weapon: null, armor: null, currentTurn: 120 };
const tables = [
    [L.genWeapons, L.spawnWeapon.bind(L), C.WEAPON], [L.armors, L.spawnArmor.bind(L), C.ARMOR],
    [L.genPotions, L.spawnPotion.bind(L), C.POTION], [L.genScrolls, L.spawnScroll.bind(L), C.SCROLL],
    [L.food, L.spawnFood.bind(L), C.FOOD], [L.genStaffs, L.spawnStaff.bind(L), C.STAFF],
    [L.genWands, L.spawnWand.bind(L), C.WAND], [L.genRings, L.spawnRing.bind(L), C.RING],
    [L.charms, L.spawnCharm.bind(L), C.CHARM], [L.keys, L.spawnKey.bind(L), C.KEY],
    [L.amulets.filter(a => !a.excludeFromGeneration), L.spawnAmulet.bind(L), C.AMULET],
] as const;

beforeEach(() => {
    if (!i18next.isInitialized) i18next.init({ lng: 'zh_CN', resources: { zh_CN: { translation: zhCN } }, initImmediate: false });
    i18next.addResourceBundle('zh_CN', 'translation', zhCN, true, true);
    i18next.changeLanguage('zh_CN');
    rng.seedRandomGenerator(44004); L.initConsumables();
});

describe('X4-R4 legal catalogue/state matrix', () => {
    it('covers all 99 existing CE identities, with effect assertions and forbidden information', () => {
        const evidence: string[] = [], counts: Record<string, number> = {};
        let identities = 0;
        for (const [table, spawn, category] of tables) for (const row of table) {
            const item = spawn(row.id, -1, -1)!;
            expect(item, row.id).toBeTruthy(); identities++;
            const flavored = [C.POTION, C.SCROLL, C.STAFF, C.WAND, C.RING].includes(category);
            const equipment = [C.WEAPON, C.ARMOR, C.RING].includes(category);
            // Throwing weapons are born unidentified, but have no cursed/runic
            // birth state. Prenamed categories have no unknown state at all.
            const naturallyKnown = !item.canBeIdentified;
            const throwing = ['dart', 'incendiary_dart', 'javelin'].includes(row.id);
            const states = naturallyKnown ? ['natural'] : flavored ? ['unknown', 'kind', 'full', 'detected'] : ['unknown', 'full', 'detected'];
            if (category === C.STAFF) states.push('capacity');
            if ([C.STAFF, C.WAND].includes(category)) states.push('capacity_unknown_kind');
            if (category === C.RING) states.push('instance_only');
            if (equipment && !naturallyKnown) {
                if (!throwing) states.push('cursed');
                states.push('equipped', 'familiarity');
            }
            for (const state of states) {
                L.identifiedItems.delete(row.id); L.magicPolarityRevealed.delete(row.id);
                item.identified = state === 'full' || state === 'instance_only' || naturallyKnown;
                item.maxChargesKnown = state === 'capacity' || state === 'capacity_unknown_kind'; item.magicDetected = state === 'detected' || state === 'cursed';
                item.runicType = undefined; item.runicKnown = false;
                item.isCursed = state === 'cursed'; item.enchantment = item.isCursed ? -3 : 3;
                if (state === 'instance_only') item.enchantment = 0; // CE negation
                if (category === C.STAFF) { item.maxCharges = 3; item.charges = 1; }
                if (category === C.WAND && state === 'capacity_unknown_kind') item.charges = 0; // CE negation
                if (state === 'familiarity') item.charges = 1;
                if (['kind', 'full', 'capacity'].includes(state)) L.identify(row.id);
                item.originDepth = 7;
                const c = { ...ctx, equipped: state === 'equipped' };
                const before = JSON.stringify(item), random = rng.getState();
                const known = [...L.identifiedItems], polarity = [...L.magicPolarityRevealed];
                const detail = text(item, c), k = itemKnowledge(item, c);
                expect(detail, `${row.id}/${state}`).toContain('第 7 层');
                if (flavored && !k.kindKnown) {
                    expect(detail).toContain('谁知道');
                    expect(detail).not.toContain(row.description);
                    expect(detail).not.toContain(item.name);
                } else if (category !== C.AMULET) expect(detail).toContain(row.description);
                if (equipment && !k.instanceKnown) {
                    expect(detail).not.toMatch(/实际伤害|实际防御值|附魔等级 [+-]?\d|附魔 \+3/);
                    expect(detail).toMatch(/自动鉴定/);
                }
                if (equipment && !k.curseKnown) expect(detail).not.toContain('被诅咒');
                if (state === 'cursed') expect(detail).toContain('被诅咒');
                if (state === 'equipped') expect(detail).toMatch(/正手持|正穿着|手指上/);
                if (category === C.STAFF && !k.chargesKnown) expect(detail).not.toContain('充能: 1/3');
                if (state === 'capacity') expect(detail).toContain('充能上限: 3（当前余量未知）');
                if (state === 'instance_only') {
                    expect(detail).toContain('自动鉴定'); expect(detail).not.toContain('最多按');
                    expect(detail).not.toContain('附魔等级');
                }
                if (category === C.CHARM) expect(detail).toContain('冷却回合:');
                if (category === C.FOOD) expect(detail).toContain('足够饥饿');
                expect(JSON.stringify(item)).toBe(before); expect(rng.getState()).toEqual(random);
                expect([...L.identifiedItems]).toEqual(known); expect([...L.magicPolarityRevealed]).toEqual(polarity);
                counts[C[category]] = (counts[C[category]] ?? 0) + 1;
                evidence.push(`${row.id} / ${state}\n${detail}\n`);
            }
        }
        for (const item of [L.spawnGem(28, -1, -1), L.spawnGold(77, -1, -1)!]) {
            identities++; const detail = text(item, ctx); expect(detail).toMatch(/财富|77 枚/);
            expect(itemKnowledge(item).runicKnown).toBe(false); expect(itemKnowledge(item).curseKnown).toBe(false);
            evidence.push(`${C[item.category]} / natural\n${detail}\n`);
        }
        expect(identities).toBe(99);
        if (process.env.X4_R4_EVIDENCE) writeFileSync('ai_docs/reports/x4-r4-evidence/state-matrix.txt',
            `Identities: ${identities}\nStates: ${JSON.stringify(counts)}\n\n${evidence.join('\n')}`);
    });

    it.each([C.POTION, C.SCROLL, C.STAFF, C.WAND, C.RING])('unknown %s never exposes hidden identity or effect', category => {
        const [pool, spawn] = tables.find(t => t[2] === category)!;
        for (const row of pool) {
            L.identifiedItems.delete(row.id);
            const item = spawn(row.id, -1, -1)!;
            item.identified = false; item.runicKnown = false;
            const detail = text(item, ctx);
            expect(detail).toContain('谁知道');
            expect(detail).not.toContain(row.description);
            expect(detail).not.toMatch(/伤害 \d+~|最多瞬移|附魔将增加|充能:|充能上限:/);
        }
    });

    it('hidden E, curse, rune and remaining uses have no effect on unknown output', () => {
        for (const item of [L.spawnWeapon('dagger', -1, -1)!, L.spawnArmor('leather_armor', -1, -1)!, L.spawnRing('ring_of_wisdom', -1, -1)!, L.spawnStaff('staff_of_fire', -1, -1)!, L.spawnWand('wand_of_domination', -1, -1)!]) {
            item.enchantment = 2; item.identified = false; item.isCursed = false; item.runicType = undefined;
            const before = text(item, ctx);
            item.enchantment = -7; item.isCursed = true; item.runicType = 'slaying'; item.vorpalEnemy = 'dragon';
            if ([C.STAFF, C.WAND].includes(item.category)) { item.maxCharges = 99; item.charges = 87; }
            expect(text(item, ctx)).toBe(before);
        }
    });

    it('unknown current equipment is stripped of hidden enchantment before comparison', () => {
        const player = new Player(1, 1), item = L.spawnWeapon('sword', -1, -1)!;
        player.equippedWeapon = L.spawnWeapon('dagger', -1, -1)!;
        player.equippedWeapon.enchantment = 11;
        const a = createItemDetailContext({ player, absoluteTurnNumber: 0 }, item);
        expect(a.weapon).toMatchObject({ enchantment: 0, assumed: true });
        player.equippedWeapon.enchantment = -9;
        const b = createItemDetailContext({ player, absoluteTurnNumber: 0 }, item);
        expect(text(item, a)).toBe(text(item, b)); expect(text(item, a)).toContain('假设');
        expect(Object.isFrozen(a)).toBe(true); expect(Object.isFrozen(a.weapon)).toBe(true);
    });
});

describe('X4-R4 CE branches and numeric predictions', () => {
    it('uses catalogue descriptions for restored instances and reserves the R3 aggravation branch', () => {
        const item = L.spawnPotion('potion_of_life', -1, -1)!;
        // 验收裁决：描述不写入物品实例（CE 按种类表查询；避免快照/存档膨胀与 trace 漂移），详情从目录解析。
        expect(item.description).toBeUndefined();
        expect(L.potions.find(p => p.id === item.consumableId)!.description).toBeTruthy();
        item.description = undefined; L.identify(item.consumableId!);
        expect(text(item, ctx)).toContain('33%');
        const scroll = L.spawnScroll('scroll_of_identify', -1, -1)!;
        scroll.consumableId = 'scroll_of_aggravate_monsters'; L.identify(scroll.consumableId);
        expect(text(scroll)).toContain('唤醒本层怪物');
        expect(L.scrolls.some(s => s.id === 'scroll_of_aggravate_monsters')).toBe(false);
    });

    it('food boundary, carried/vault origin, no-context omission and special assets', () => {
        const item = L.spawnFood('ration_of_food', -1, -1)!;
        expect(text(item, { ...ctx, nutrition: 350 })).toContain('已经足够饥饿');
        expect(text(item, { ...ctx, nutrition: 351 })).toContain('还不够饥饿');
        item.originDepth = 9; item.flags = ['ITEM_IS_KEY'];
        expect(text(item, ctx)).toContain('第 9 层的宝库');
        expect(text(item, 12)).not.toMatch(/足够饥饿|第 9 层/);
        expect(text(item, { ...ctx, carried: false })).not.toContain('第 9 层');
        expect(text(L.spawnAmulet('amulet_of_yendor', -1, -1)!, ctx)).toContain('带回地表');
    });

    it.each([2, 3, 9, 10])('all 12 staff branches with known capacity E=%s; remaining charges stay hidden', e => {
        const expected: Record<string, string> = {
            lightning: `伤害 ${Math.floor((2 + e) * 3 / 4)}~${4 + Math.floor(5 * e / 2)}`,
            fire: '免疫火焰', poison: '中毒', tunneling: `溶解 ${e} 层`, blinking: `最多瞬移 ${2 * e + 2} 格`,
            entrancement: '模仿你的行动', obstruction: '一半', discord: `持续 ${4 * e} 回合`,
            conjuration: `召唤 ${Math.trunc(3 * e / 2)} 把`, healing: `最大生命值的 ${Math.min(100, 10 * e)}%`,
            haste: `持续 ${2 + 4 * e} 回合`, protection: '最多持续 20 回合',
        };
        for (const row of L.genStaffs) {
            const item = L.spawnStaff(row.id, -1, -1)!;
            Object.assign(item, { enchantment: e, maxCharges: e, charges: 0, maxChargesKnown: true }); L.identify(row.id);
            const detail = text(item, ctx);
            expect(detail).toContain(expected[row.id.replace('staff_of_', '')]!);
            expect(detail).not.toContain(`充能: 0/${e}`);
            const base = ['staff_of_blinking', 'staff_of_obstruction'].includes(row.id) ? 10000 : 5000;
            expect(detail).toContain(`约 ${Math.trunc(Math.floor(base / e) / 10)} 回合`);
            item.identified = true; expect(text(item, ctx)).toContain(`充能: 0/${e}`);
        }
    });

    it('uses apparent wisdom, observed history only, and never reads a hidden recharge timer', () => {
        const p = new Player(1, 1), item = L.spawnStaff('staff_of_fire', -1, -1)!;
        Object.assign(item, { enchantment: 3, maxCharges: 3, maxChargesKnown: true }); L.identify(item.identityId!);
        p.ringLeft = L.spawnRing('ring_of_wisdom', -1, -1)!; p.ringLeft.enchantment = 7;
        let c = createItemDetailContext({ player: p, absoluteTurnNumber: 120 }, item);
        expect(c.apparentRingBonuses).toEqual({});
        L.identify('ring_of_wisdom'); c = createItemDetailContext({ player: p, absoluteTurnNumber: 120 }, item);
        expect(c.apparentRingBonuses).toEqual({ ring_of_wisdom: 1 });
        expect(text(item, c)).toContain('约 138 回合');
        expect(text(item, { ...c, knownStaffUses: [115, 110, 90] })).toContain('5、10、30 回合前');
        expect(text(item, { ...c, knownStaffUses: [115] })).toContain('5 回合前');
        expect(text(item, { ...c, knownStaffUses: [115, 110] })).toContain('5、10 回合前');
        expect(text(item, c)).not.toContain('最近使用');
        const a = text(item, c); item.staffRechargeRemaining = 111; expect(text(item, c)).toBe(a);
    });

    it('known capacity is the sole E projection for an unidentified staff, including inconsistent legacy fixtures', () => {
        const item = L.spawnStaff('staff_of_blinking', -1, -1)!;
        Object.assign(item, { enchantment: 2, maxCharges: 2, maxChargesKnown: true }); L.identify(item.identityId!);
        const first = text(item);
        expect(first).toContain('最多瞬移 6 格（附魔后 8 格）');
        item.enchantment = 4; // Not a legal CE state: hidden field is not read.
        expect(text(item)).toBe(first);
        item.maxChargesKnown = false;
        expect(text(item)).not.toContain('最多瞬移');
    });

    it('all nine wand ranges, use count, remaining/empty uses and increments respect both knowledge gates', () => {
        for (const [id, [lo, hi]] of Object.entries(WAND_INITIAL_RANGES)) {
            const item = L.spawnWand(id, -1, -1)!; item.timesUsed = 2;
            expect(text(item)).toContain('已使用 2 次'); expect(text(item)).not.toContain('附魔将增加');
            L.identify(id); expect(text(item)).toContain(`出生时有 ${lo} 到 ${hi} 次`);
            expect(text(item)).toContain(`附魔将增加 ${lo} 次`);
            item.maxChargesKnown = true; item.charges = 0;
            expect(text(item)).toContain('充能: 0'); expect(text(item)).not.toContain('充能未知');
        }
    });

    it('ring cap appears only after familiarity or detection; curse is independent of kind identification', () => {
        const ring = L.spawnRing('ring_of_wisdom', -1, -1)!;
        expect(text(ring)).not.toContain('最多按'); ring.charges = 1499;
        expect(text(ring)).toContain('最多按 +1'); ring.timesEnchanted = 2;
        expect(text(ring)).toContain('最多按 +3'); ring.charges = 1500; ring.magicDetected = true;
        expect(text(ring)).toContain('最多按 +3'); ring.isCursed = true; ring.enchantment = -3;
        expect(text(ring)).toContain('被诅咒'); expect(text(ring)).not.toContain('附魔等级');
        L.identifyInstance(ring); expect(text(ring)).toContain('附魔等级 -3');
    });

    it('all 21 CE runes have gated prose; numerical triggers require instance identification', () => {
        for (const [ids, spawn] of [[L.WEAPON_RUNIC_BY_CE_INDEX, () => L.spawnWeapon('dagger', -1, -1)!],
            [L.ARMOR_RUNIC_BY_CE_INDEX, () => L.spawnArmor('leather_armor', -1, -1)!]] as const) {
            for (const id of ids) {
                const item = spawn(); Object.assign(item, { runicType: id, runicKnown: true, identified: false, enchantment: 3, vorpalEnemy: 'dragon' });
                const rune = () => generateItemDetail(item, ctx).sections.find(s => s.header?.startsWith('附魔:'))!;
                expect(rune().lines[0]!.text.length, id!).toBeGreaterThan(8);
                const a = rune(); item.enchantment = 20; expect(rune()).toEqual(a);
                item.enchantment = 3; item.identified = true;
                expect(rune().lines.every(l => l.text.length > 0)).toBe(true);
                if (id === 'slaying' || id === 'immunity') expect(JSON.stringify(rune())).toContain('巨龙');
                item.runicKnown = false; expect(text(item)).toContain('无法辨认的发光符文');
            }
        }
    });

    it('equipment next-enchantment includes strength reduction, including the zero-requirement edge', () => {
        const item = L.spawnWeapon('dagger', -1, -1)!;
        Object.assign(item, { identified: true, runicKnown: true, runicType: 'paralyzing', enchantment: 3, strengthRequired: 13 });
        const next = netEnchant(4, 12, 12);
        expect(text(item, ctx)).toContain(`再附魔后伤害: ${enchantedDamage(3, next)}~${enchantedDamage(4, next)}，力量需求 12`);
        expect(text(item, ctx)).toContain(`再附魔后 ${runicWeaponChance(next, 'paralyzing', { damageMin: 3, damageMax: 4 })}%`);
        item.strengthRequired = 0; expect(text(item, ctx)).toContain('力量需求 0');
    });

    it('all charms include E/E+1 recharge; protection and invisibility include CE limits', () => {
        for (const row of L.charms) {
            const item = L.spawnCharm(row.id, -1, -1)!; item.enchantment = 2;
            expect(text(item, ctx)).toContain('附魔后');
            expect(text(item, ctx)).toContain(`冷却回合: ${charmRechargeDelay(row.id as Parameters<typeof charmRechargeDelay>[0], 2)}`);
        }
        expect(text(L.spawnCharm('charm_of_protection', -1, -1)!, ctx)).toContain('最多持续 20 回合');
        expect(text(L.spawnCharm('charm_of_invisibility', -1, -1)!, ctx)).toContain('超过两格');
    });

    it('inline Game status/healing formulas agree with actual E and E+1 effects', () => {
        const g = createHeadlessGame(44004, 'test');
        const target = new Monster(g.player.x + 1, g.player.y, (monsterData as MonsterData[]).find(m => m.id === 'rat')!);
        target.maxHp = 100;
        const effects = [
            ['staff_of_haste', BoltEffect.HASTE, 'hasted'],
            ['staff_of_discord', BoltEffect.DISCORD, 'discordant'],
            ['staff_of_healing', BoltEffect.HEALING, null],
        ] as const;
        const apply = (g as unknown as { applyBasicBoltEffect(target: Monster, effect: BoltEffect, e: number): unknown }).applyBasicBoltEffect.bind(g);
        for (const [id, effect, status] of effects) {
            const item = L.spawnStaff(id, -1, -1)!;
            Object.assign(item, { enchantment: 3, maxCharges: 3, maxChargesKnown: true }); L.identify(id);
            const detail = text(item, ctx);
            for (const e of [3, 4]) {
                target.hp = 1;
                if (status) target.setStatusDuration(status, 0);
                apply(target, effect, e);
                const value = status ? target.getStatusDuration(status) : target.hp - 1;
                expect(detail).toContain(`${value}${status ? ' 回合' : '%'}`);
            }
        }
    });

    it('the existing ground-inspect outlet shares context-free sections and consumes no time/RNG', () => {
        const g = createHeadlessGame(44004, 'test');
        const item = L.spawnPotion('potion_of_strength', g.player.x, g.player.y)!;
        g.items.push(item); g.grid.getCell(item.x, item.y)!.isVisible = true;
        const before = rng.getState(), turn = g.absoluteTurnNumber;
        g.handleInspectAt(item.x, item.y);
        expect(g.inspectTarget).toEqual(generateItemDetail(item, g.player.effectiveStrength));
        expect(rng.getState()).toEqual(before); expect(g.absoluteTurnNumber).toBe(turn);
    });
});
