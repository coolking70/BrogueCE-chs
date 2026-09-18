# UI-2：`isProtected` 的其余三个 CE 消费点（与 V-2a 并行，**严禁触碰生成期**）

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错事实**。
凡引用的 CE 行号/语义都**必须打开 `../BrogueCE-master/` 逐字核对**，
冲突时**以 CE 源码为准**，并在 `## 对任务书的反驳` 一节写明。

⚠️ **验收方近期连犯两类错，请对任务书保持怀疑**：
① 把上一轮的 deferral 登记当成"尚未实现"照抄（I-1：燃烧发光其实 C-7 早做了）；
② 把测试的快照前提当成永恒事实（V-1c：b_4a 的"D1 不会生成计量物"）。
**凡本文说"web 目前没有 X"，请先自己 grep 验证。**

## 1. 背景

I-1 把 `isProtected` 接上了 CE 的**护甲腐蚀豁免**（`Combat.c:425-431`），
但 CE 一共有**四个**消费点，另外三个当时因载体在授权清单外而登记未做。
本轮补齐。三者同源，都围绕"这件装备受保护"这一个事实。

## 2. 三件事

### 2.1 武器降级机制（CE `Combat.c:1432-1450`）——**这是本轮的重头**

CE 原文（**逐字核对**）：

```c
if (degradesAttackerWeapon && attacker == &player && rogue.weapon &&
    !(rogue.weapon->flags & ITEM_PROTECTED)
    // Can't damage a Weapon of Acid Mound Slaying by attacking an acid mound... just ain't right!
    && !((rogue.weapon->flags & ITEM_RUNIC) && rogue.weapon->enchant2 == W_SLAYING &&
         monsterIsInClass(defender, rogue.weapon->vorpalEnemy)) &&
    rogue.weapon->enchant1 >= -10) {
    rogue.weapon->enchant1--;
    if (rogue.weapon->quiverNumber) { rogue.weapon->quiverNumber = rand_range(1, 60000); }
    equipItem(rogue.weapon, true, NULL);
    // "your %s weakens!"
    checkForDisenchantment(rogue.weapon);
}
```

**web 现状（验收方已核实，请复核）**：`MONST_DEFEND_DEGRADE_WEAPON`
全库只出现在 `src/data/monsters.json`（数据）与
`src/engine/UI/DetailGenerator.ts:98`（怪物词条文案「被击中时会腐蚀武器」）
——**战斗消费点为零**。

⚠️ **这意味着游戏正在对玩家撒谎**：详情面板承诺了一个不存在的机制。
所以本轮**要么实现它、要么改掉文案**——按用户的既定裁决
（「优先还原 CE 的逻辑结构，避免原创差异引起后续连锁反应」），
**优先实现**；`MONST_DEFEND_DEGRADE_WEAPON` 是**真 CE 旗标**（CE 树 15 处命中，
见路线图「蓝图旗标审计表」），不是自创词元。

**若实现遇到 web 无载体的子条件**（例如 `W_SLAYING` 符文的 vorpalEnemy 判定、
`checkForDisenchantment`、`quiverNumber` 重掷），**不要自创**：
按惯例登记"无载体"并说明激活路径，把能做的部分做对。

### 2.2 物品栏的 `}` 括号（CE `Items.c:3629/3641`）

CE：`(theItem->flags & ITEM_PROTECTED ? '}' : closeParen)`
——受保护的物品在物品栏里，**闭括号从 `)` 变成 `}`**。

web 载体：`src/components/InventoryOverlay.vue:283`
`<span class="item-letter">{{ entry.letter }})</span>` —— **硬编码 `)`**。

### 2.3 物品详情的"不会被酸液腐蚀"（CE `Items.c:2394-2400`）

CE 在 `itemDetails()` 里，护甲详情段：

```c
// protected?
if (theItem->flags & ITEM_PROTECTED) {
    // 中文：「%s不会被酸液腐蚀。」（goodColorEscape 绿色）
    // 英文："The %s cannot be corroded by acid."
}
```

⚠️ **CE 自己就带中文分支**（`chineseUi`）——本项目是汉化版，
**请直接采用 CE 的中文原文**「不会被酸液腐蚀。」，不要另行翻译。

web 载体：物品详情走 `src/engine/UI/DetailGenerator.ts` 的
`generateItemDetail`（经 `game.inspectTarget` 驱动）。

## 3. 绝对禁止

- **不得修改 `BrogueCE-master/`**（只读参考，D6）。
- **不得触碰生成期任何代码**，**不得重新捕获 `generation_baseline`**。
  ⚠️ 本轮与 **V-2a（蓝图数据／前厅回归）并行**，V-2a 活动在
  `src/data/blueprints.json` 与 `src/engine/Generator/`。
  **本轮请待在战斗/物品显示路径内。**
  `generation_baseline` 绿且 fixture 未动 = 你没越界的证据。
- **不得自创 CE 没有的机制**（见 §2.1 的无载体处置）。
- 不得为了让测试变绿而放宽断言。

## 4. 允许修改的文件

**先按四段 grep 自查**（`project_conventions.md`）。
⚠️ 写清单前**先读 `ai_docs/i-1_report.md` 的「遗留与登记」节** ——
那是本轮三件事的来源，也预告了载体位置。

**生产代码：**
- `src/engine/Core/Game.ts`（**仅**战斗结算路径）
- `src/entities/Monster.ts`、`src/engine/Items/Item.ts`
- `src/engine/UI/DetailGenerator.ts`
- `src/components/InventoryOverlay.vue`
- `src/locales/**`

**测试：**
- `src/test/i_1_interaction.test.ts`（同源，可扩）
- `src/test/b_1a_identification.test.ts`（`}` 括号若影响显示）
- `src/test/scroll_effects.test.ts`（`isProtected` 由卷轴置位）
- `src/engine/UI/DetailGenerator.test.ts`
- `src/test/p1_30_i18n_gate.test.ts`
- 新建 `src/test/ui_2_protection.test.ts`

**清单外撞红：停下，不要改**，写进 `## 需要追加授权的测试`。

## 5. 测试要求

1. **武器降级的行为终点**：带 `MONST_DEFEND_DEGRADE_WEAPON` 的怪物被玩家击中时，
   **不带保护**的武器附魔 −1 并有消息；**带保护**的完全跳过、无消息。
   ⚠️ 命中确定性要像 I-1 那样处理：用必中配置 + 先断言"命中确实发生"，
   **排除"豁免看起来生效其实是没打中"的假绿**。
2. **`enchant1 >= -10` 下界**：已降到 −10 的武器不再继续降。
3. **`}` 括号**：受保护物品显示 `}`，未受保护显示 `)`。
4. **详情文案**：受保护护甲的详情含「不会被酸液腐蚀。」，未受保护的不含。
5. **假文案清算**：断言 `MONST_DEFEND_DEGRADE_WEAPON` 的文案与**实际机制一致**
   （实现了就保留文案；若判定无载体而改文案，则断言文案不再承诺不存在的效果）。
6. **对抗性测试 ≥ 3 条 + 强制反向验证**：真改坏 → 跑 → **贴真实失败输出**
   → 还原 → `grep -rn "REVERT-ME" src/` = 0。

## 6. 门禁

`npx vitest run`（**不带文件参数**；⚠️ **不要加 `--fileParallelism=false`**）
**外加 `npm run build`**（不要用 `tsc --noEmit`）。

⚠️ V-2a 并行跑着会抢 CPU：**重型测试翻红时先单独重跑该文件**再下结论。

## 7. 最终回复必须包含

1. `## 对任务书的反驳`
2. `## 三件逐条落地情况`（含任何"无载体"登记及其证据）
3. `## 改动清单`
4. `## 对抗性测试与反向验证`（含**真实失败输出**）
5. `## 需要追加授权的测试`
6. `## 门禁结果`（含 `generation_baseline` 绿且 fixture 未动的证据）
7. `## 遗留与登记`
