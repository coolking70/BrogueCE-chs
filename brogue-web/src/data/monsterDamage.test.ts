/**
 * src/data/monsterDamage.test.ts — 全部 67 只怪物的 damage 记法与 CE 权威值逐条对账。
 *
 * 权威基线：BrogueCE-master/src/brogue/Globals.c 的 creatureType monsterCatalog
 * （表体 L1026 起，玩家 "you" 为 L1027 首条、非怪物；怪物为 L1030..L1163）。
 * 字段序依 Rogue.h:2172 creatureType：…, damage{min,max,clumpFactor}, …
 *
 * 关键语义：CE 的 damage 是 randomRange{min,max,clump}，{9,13,2} 就是字面 9~13；
 * 而 CombatSystem.parseDamageString 是掷骰记法，"XdY" → min=X, max=X*Y。
 * 因此非 {0,0,0} 怪物统一写 "1dN+M"（N = max−min+1, M = min−1），解析结果
 * min=1+M、max=N+M 与 CE 完全一致、clumping=1；CE {0,0,0}（无近战攻击）写 "0d1"
 * （解析 min=0/max=0）。U13 另存 CE clumping 字段，完整 range 进入近战。
 */
import { describe, it, expect } from 'vitest';
import monstersJson from './monsters.json';
import { CombatSystem } from '../engine/Combat/Combat';

function byId(id: string): (typeof monstersJson)[number] {
    const m = monstersJson.find((x) => x.id === id);
    if (!m) throw new Error(`monsters.json 中找不到 ${id}`);
    return m;
}

/** CE 提取值：[id, Globals.c 行号, min, max, clumpFactor]——67 条，与表序一致。 */
const CE_DAMAGE: ReadonlyArray<readonly [string, number, number, number, number]> = [
    ["rat", 1030, 1, 3, 1],
    ["kobold", 1031, 1, 4, 1],
    ["jackal", 1032, 2, 4, 1],
    ["eel", 1033, 3, 7, 2],
    ["monkey", 1035, 1, 3, 1],
    ["bloat", 1037, 0, 0, 0],
    ["pit_bloat", 1039, 0, 0, 0],
    ["goblin", 1041, 2, 5, 1],
    ["goblin_conjurer", 1043, 2, 4, 1],
    ["goblin_mystic", 1045, 2, 4, 1],
    ["goblin_totem", 1047, 0, 0, 0],
    ["pink_jelly", 1049, 1, 3, 1],
    ["toad", 1051, 1, 4, 1],
    ["vampire_bat", 1053, 2, 6, 1],
    ["arrow_turret", 1055, 2, 6, 1],
    ["acid_mound", 1057, 1, 3, 1],
    ["centipede", 1059, 4, 12, 1],
    ["ogre", 1061, 9, 13, 2],
    ["bog_monster", 1063, 3, 4, 1],
    ["ogre_totem", 1065, 0, 0, 0],
    ["spider", 1067, 3, 4, 2],
    ["spark_turret", 1069, 0, 0, 0],
    ["wisp", 1071, 0, 0, 0],
    ["wraith", 1073, 6, 13, 2],
    ["zombie", 1075, 7, 12, 1],
    ["troll", 1076, 10, 15, 3],
    ["ogre_shaman", 1078, 5, 9, 1],
    ["naga", 1080, 7, 11, 4],
    ["salamander", 1082, 5, 11, 3],
    ["explosive_bloat", 1084, 0, 0, 0],
    ["dar_blademaster", 1086, 5, 9, 2],
    ["dar_priestess", 1088, 2, 5, 1],
    ["dar_battlemage", 1090, 1, 3, 1],
    ["acidic_jelly", 1092, 2, 6, 1],
    ["centaur", 1094, 4, 8, 2],
    ["underworm", 1096, 18, 22, 2],
    ["sentinel", 1098, 0, 0, 0],
    ["dart_turret", 1100, 1, 2, 1],
    ["kraken", 1102, 15, 20, 3],
    ["lich", 1104, 2, 6, 1],
    ["phylactery", 1106, 0, 0, 0],
    ["pixie", 1108, 1, 3, 1],
    ["phantom", 1110, 12, 18, 4],
    ["flame_turret", 1112, 1, 2, 1],
    ["imp", 1114, 4, 9, 2],
    ["fury", 1116, 6, 11, 4],
    ["revenant", 1118, 15, 20, 5],
    ["tentacle_horror", 1120, 25, 35, 3],
    ["golem", 1121, 4, 8, 1],
    ["dragon", 1123, 25, 50, 4],
    ["goblin_warlord", 1127, 3, 6, 1],
    ["black_jelly", 1129, 3, 8, 1],
    ["vampire", 1131, 4, 15, 2],
    ["flamedancer", 1133, 3, 8, 2],
    ["spectral_blade", 1137, 1, 1, 1],
    ["spectral_sword", 1139, 1, 1, 1],
    ["stone_guardian", 1141, 12, 17, 2],
    ["winged_guardian", 1143, 12, 17, 2],
    ["guardian_spirit", 1145, 5, 12, 2],
    ["Warden_of_Yendor", 1147, 12, 17, 2],
    ["eldritch_totem", 1149, 0, 0, 0],
    ["mirrored_totem", 1151, 0, 0, 0],
    ["unicorn", 1155, 2, 10, 2],
    ["ifrit", 1157, 5, 13, 2],
    ["phoenix", 1159, 4, 10, 2],
    ["phoenix_egg", 1161, 0, 0, 0],
    ["mangrove_dryad", 1163, 2, 8, 2],
];

describe('monsters.json damage 记法 ↔ CE monsterCatalog（Globals.c）逐条对账', () => {
    it('共 67 条怪物，全部有 damage 字段', () => {
        expect(monstersJson).toHaveLength(67);
        for (const m of monstersJson) {
            expect(typeof m.damage, `${m.id}.damage 应为字符串`).toBe('string');
        }
    });

    it('每条 damage 经 CombatSystem.parseDamageString 的 min/max 与 CE 一致（行号为 Globals.c monsterCatalog 表体）', () => {
        for (const [id, ceLine, ceMin, ceMax, ceClump] of CE_DAMAGE) {
            const m = byId(id);
            const parts = CombatSystem.parseDamageString(m.damage);
            expect(m.clumping, `L${ceLine}: ${id} clump`).toBe(ceClump);
            expect(
                { id, damage: m.damage, min: parts.min, max: parts.max },
                `L${ceLine}: ${id} damage=${m.damage} 应解析为 ${ceMin}~${ceMax}`
            ).toEqual({ id, damage: m.damage, min: ceMin, max: ceMax });
        }
    });

    it('非 {0,0,0} 怪物记法解析语义为 1dN(+M)（clumping=1）；{0,0,0} 怪物使用 0d1（min=max=0）', () => {
        for (const [id, ceLine, ceMin, ceMax] of CE_DAMAGE) {
            const m = byId(id);
            if (ceMin === 0 && ceMax === 0) {
                // L<行号>: CE {0,0,0} = 无近战攻击 → '0d1' 解析为 0~0
                expect(m.damage, `L${ceLine}: ${id}`).toBe('0d1');
            } else {
                // M = min−1 为 0 时允许省略 "+0"（保留原生 "1dN" 写法，语义相同）
                const n = ceMax - ceMin + 1;
                const mm = ceMin - 1;
                const expected = mm > 0 ? `1d${n}+${mm}` : `1d${n}`;
                expect(m.damage, `L${ceLine}: ${id} 应为 ${expected}`).toBe(expected);
                const parts = CombatSystem.parseDamageString(m.damage);
                expect(parts.clumping).toBe(1);
            }
        }
    });
});
