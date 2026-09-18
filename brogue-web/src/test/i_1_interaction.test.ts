/**
 * src/test/i_1_interaction.test.ts — I-1（交互期两笔欠账）的验收测试
 *
 * 第 1 件：isProtected 的消费点（CE Combat.c:425-431 逐字核对）
 *   - MA_HIT_DEGRADE_ARMOR 命中玩家时，带 ITEM_PROTECTED 的护甲**完全跳过**
 *     腐蚀（无降级、无消息）；不带保护的照常降级。
 *   - web 载体：Monster.resolveGeometryAttackOn 与 Monster.takeTurn 两处近战支
 *     （P4-6 几何分发后的两个落点）。isProtected 由 protect_weapon/armor 卷轴
 *     置位（Game.protectEquippedGear，Items.c:7906-7938）。
 *   - 武器侧（CE Combat.c:1432-1440，MONST_DEFEND_DEGRADE_WEAPON）在 web
 *     **无战斗消费点**（旗标仅存于 monsters.json 与 DetailGenerator 文案）——
 *     按任务书不自创腐蚀系统，登记"无载体"，本文件不测。
 *
 * 第 2 件：燃烧怪物的光（CE Light.c:249-251 逐字核对）
 *   - 引擎侧接线已由 C-7 完成（Game.updateVision 的 paintBurning，commit 6c3a34a），
 *     本轮把**行为面**钉死：非 FIERY 燃烧怪在光网格上产生 BURNING_CREATURE_LIGHT、
 *     FIERY 怪不叠加、玩家燃烧同样发光（CE handledPlayer 模式）。
 *   - 形式守卫（发光 ≠ 染色）留在 ui_1_rendering.test.ts，本文件不重复。
 *
 * 对抗性设计：每条 it 注释里写明它打红的具体错误实现。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import type { Item } from '../engine/Items/Item';
import monsterDataJson from '../data/monsters.json';
import { logger } from '../engine/Systems/Logger';

const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

/** 私有成员访问（与 p4_4/p4_5 同一思路）：仅测试通道，不代表公开 API。 */
function priv(game: Game): any {
    return game as any;
}

/** 空房（含燃烧光测试需要的远距探针位）：玩家 (4,5)，地板 2..24 × 2..14。 */
function carveBigRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < 30; x++) {
        for (let y = 1; y < 20; y++) {
            game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= 24; x++) {
        for (let y = 2; y <= 14; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.hp = game.player.maxHp = 200;
}

/** 玩家初始护甲归零并按需打保护。 */
function resetArmor(game: Game, isProtected: boolean): Item {
    const armor = game.player.equippedArmor!;
    armor.enchantment = 0;
    armor.isProtected = isProtected;
    return armor;
}

/** 生成一只必中（hitProbability 在 CombatFormulas 钳 100，对任意护甲防御）的酸怪。 */
function spawnGuaranteedHitMound(game: Game, x: number, y: number): Monster {
    const mound = new Monster(x, y, monsterDataById('acid_mound'));
    mound.accuracy = 10000;
    mound.state = MonsterState.HUNTING;
    game.monsters.push(mound);
    return mound;
}

// ---------------------------------------------------------------------------
// 第 1 件：isProtected 消费点
// ---------------------------------------------------------------------------
describe('I-1 第 1 件：isProtected 豁免酸液腐蚀护甲（CE Combat.c:425-431）', () => {
    it('takeTurn 近战路径：带保护的护甲被酸怪命中也不降级、无腐蚀消息', () => {
        // 打红的错误实现：豁免条件缺失（=本轮改前的代码）——带保护照样被降级。
        const game = createHeadlessGame(4101);
        carveBigRoom(game);
        const armor = resetArmor(game, true);

        const mound = spawnGuaranteedHitMound(game, 5, 5); // 玩家 (4,5) 正右方相邻
        mound.takeTurn(game, 10);

        expect(game.player.hp).toBeLessThan(200); // 命中确实发生了（豁免不是"没打中"）
        expect(armor.enchantment).toBe(0); // 关键断言：带保护 → 附魔不动
        const texts = logger.messages.map(m => m.text).join('\n');
        expect(texts).not.toContain('corroded by acid'); // CE：带保护完全跳过，无消息
    });

    it('takeTurn 近战路径：不带保护的护甲被命中后降级 1 点、打腐蚀消息（行为终点）', () => {
        // 打红的错误实现：把豁免写反/把整个腐蚀机制一起禁掉——不保护的也该降。
        const game = createHeadlessGame(4102);
        carveBigRoom(game);
        const armor = resetArmor(game, false);

        const mound = spawnGuaranteedHitMound(game, 5, 5);
        mound.takeTurn(game, 10);

        expect(game.player.hp).toBeLessThan(200);
        expect(armor.enchantment).toBe(-1); // CE enchant1--，恰好一点
        const texts = logger.messages.map(m => m.text).join('\n');
        expect(texts).toContain('corroded by acid');
    });

    it('resolveGeometryAttackOn 路径（P4-6 几何分发支）：同一豁免两处落点都要过', () => {
        // 打红的错误实现：只改 takeTurn 一处、漏掉几何分发支（两处是复制的
        // 同款代码，漏一处就是"贴脸打你腐蚀、斜角打你不腐蚀"的行为分裂）。
        const game = createHeadlessGame(4103);
        carveBigRoom(game);
        const armor = resetArmor(game, true);
        const mound = spawnGuaranteedHitMound(game, 5, 5);
        const attackOn = (mound as unknown as {
            resolveGeometryAttackOn(game: Game, target: object, voice: string): void;
        }).resolveGeometryAttackOn.bind(mound);

        attackOn(game, game.player, 'hostile');
        expect(game.player.hp).toBeLessThan(200); // 命中发生
        expect(armor.enchantment).toBe(0); // 带保护：不动

        // 反极性：同一落点，去掉保护 → 降 1
        armor.isProtected = false;
        attackOn(game, game.player, 'hostile');
        expect(armor.enchantment).toBe(-1);
    });
});

// ---------------------------------------------------------------------------
// 第 2 件：燃烧怪物的光（接线在 C-7，本轮钉行为面）
// ---------------------------------------------------------------------------
describe('I-1 第 2 件：燃烧怪物在光网格上发光（CE Light.c:249-251）', () => {
    /** 光网格快照：lightAt 返回活引用（clearLighting 原地清零），必须拷贝。 */
    function snap(game: Game, x: number, y: number): { r: number; g: number; b: number } {
        const ch = game.lightMap.lightAt(x, y)!;
        return { r: ch.r, g: ch.g, b: ch.b };
    }

    it('非 FIERY 怪燃烧：自身格光增 2×fireBoltColor{500,150,0}，邻格也受光', () => {
        // 打红的错误实现：①漏接线（增量为 0）；②错光种（蓝通道非 0，如
        // 心灵感应光/矿灯色）；③丢 CE 原点无条件整份（增量只有 500/150/0）；
        // ④只标记自身格不泼邻格。
        const game = createHeadlessGame(4104);
        carveBigRoom(game);
        game.depth = 40; // 深层矿灯半径 ~2.3 格（c_7 同款），12 格外探针基线为真 0
        const goblin = new Monster(16, 11, monsterDataById('goblin')); // 距玩家 12 格
        goblin.accuracy = 0; // 顺手排除任何攻击可能，本用例只看光
        game.monsters.push(goblin);

        priv(game).updateVision();
        const before = snap(game, 16, 11);
        expect(before.r + before.g + before.b).toBe(0); // 基线：不燃烧无光

        priv(game).setBurningDuration(goblin, 7);
        priv(game).updateVision();

        const after = snap(game, 16, 11);
        // LightMap.paintLight：掩码内 100% 一份 + 原点无条件整份（CE 原样）→ 恰两倍
        expect(after.r - before.r).toBe(1000);
        expect(after.g - before.g).toBe(300);
        expect(after.b - before.b).toBe(0); // 火光无蓝通道
        expect(game.lightMap.lightAt(15, 11)!.r).toBeGreaterThan(0); // 是"光"，会泼开
    });

    it('FIERY 怪（wisp）燃烧：不叠加光；但燃烧状态本身照常在（防"用不燃烧来修"）', () => {
        // 打红的错误实现：①删掉 paintBurning 的 fiery 排除（wisp 格翻出火光）；
        // ②反过来"修"成 FIERY 怪不进燃烧状态（Game.ts:8117：FIERY 怪燃烧
        // 不衰减是 Monsters.c:1879-1881 的另一条机制，两种状态必须共存）。
        const game = createHeadlessGame(4105);
        carveBigRoom(game);
        game.depth = 40;
        const wisp = new Monster(16, 11, monsterDataById('wisp'));
        expect(wisp.hasBehavior('MONST_FIERY')).toBe(true); // UI-1 交代的载体重核项
        game.monsters.push(wisp);

        priv(game).updateVision();
        const before = snap(game, 16, 11);

        priv(game).setBurningDuration(wisp, 7);
        priv(game).updateVision();

        const after = snap(game, 16, 11);
        expect(after.r).toBe(before.r);
        expect(after.g).toBe(before.g);
        expect(after.b).toBe(before.b); // 不叠加：三通道零增量
        expect(priv(game).burningDuration(wisp)).toBe(7); // 但它确实在烧
    });

    it('玩家燃烧：同样发光（CE handledPlayer 模式把玩家包含在生物光循环里）', () => {
        // 打红的错误实现：只遍历 monsters、漏掉玩家自己（Light.c:242-247 的
        // handledPlayer 先给玩家）——玩家烧着却不发光。
        const game = createHeadlessGame(4106);
        carveBigRoom(game);

        priv(game).updateVision();
        const before = snap(game, 4, 5); // 矿灯基线，非零

        priv(game).setBurningDuration(game.player, 7);
        priv(game).updateVision();

        const after = snap(game, 4, 5);
        expect(after.r - before.r).toBe(1000);
        expect(after.g - before.g).toBe(300);
        expect(after.b - before.b).toBe(0);
    });
});
