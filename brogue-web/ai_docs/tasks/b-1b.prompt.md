# B-1b：鉴定态持久化 + call 绰号 + 戒指双槽 + 移除免费按钮

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：CE 源码优先。最近三轮你都纠正过验收方或前置文档——
G-3 指出"半径 4"是 `effectRadius`、F-2c 指出爆炸伤害取 `maxHP/2` 且免疫窗是生物状态、
**B-1a 反驳了 B-0 勘察表里"identify 卷轴不自亮种类"的结论（`Items.c:7774` 原文为准）**。
**请继续，包括反驳本任务书与任何前置文档。**

**先读**：`ai_docs/b_1a_identification_report.md` **§8 的「给 B-1b」五条——
本轮范围基本就是那五条**；`ai_docs/b_0_phase_b_survey.md` 相关节。
凡本任务书与它们冲突，**以 CE 源码为准并在报告里指出**。

---

## 一、本轮定位

**⚠️ 本轮与 C-6（runAutogenerators，改生成）并行执行。**
B-1a 已把两层未知态模型与揭示规则做好，但 **P1-48：鉴定态完全不进存档**
（B-0 探针实证：喝/读/扔建立的 3 条鉴定，**读档后 3 → 0 全丢**）。本轮补齐。

---

## 二、范围（= B-1a §8 的五条）

1. **持久化（P1-48）**：快照新增 `identifiedItems`（种类集）与实例的
   `identified` / `canBeIdentified` / `maxChargesKnown` / `timesUsed`；
   `deserializeItem` 里"按 spawn 语义重建未知态"的分支整体可删。
   **B-1a 立的留痕测试"鉴定态不进存档"本轮反转**（测试名已注明）。
2. **call / inscribe 绰号**：`callTitles: Map`；`displayName` 的三态
   （真名 / called / 风味）——called 分支还没写。CE 的 `callTitle` 语义自己核对。
3. **identify 卷轴目标指定**：`identifyRandomItem` 已按 `canBeIdentified` 备好目标池，
   把"随机挑一个"换成"玩家挑"（CE `promptForItemOfType`）。
4. **移除两个免费按钮**：`InventoryOverlay.vue:167/172` 调用的
   `rechargeArcanaItem` / `uncurseItem`（`Game.ts:4001/4017`）——
   这是 web 自创的作弊入口，按 D2 退出实际游戏。
   ⚠️ `removeCurseFromInventory` 清负附魔的偏差（B-0 §5.3-5/9）**本轮不动**，只登记。
5. **戒指双槽**：`processIncrementalAutoID` 的调用方要遍历 `ringLeft` / `ringRight`
   （B-1a 说三槽语义已在 `decrementWornFamiliarity` 的单件粒度上就绪，循环展开即可
   ——**请验证这个预测**）。

---

## 三、★ 哨兵要建在构造地图上，不要锚定真实关卡

B-1a 立的 A13「RNG 流哨兵」把物品签名锚在**真实生成的关卡**上，
结果 C-5 一改地图，合并时就得重锚（本链已发生两次：C-5 撞 g_2/g_3 的 FIRE-NAT、
C-5 撞 B-1a 的 A13）。

**本轮与 C-6 并行，而 C-6 改生成——同样的事会再发生一次。**

所以：**本轮若要立 RNG 哨兵，请建在构造地图 / 固定物品集上**，
使它只对"本轮有没有多消耗掷骰"敏感，而对地图变化免疫。
`generation_baseline` 仍是权威判据，不要用哨兵替代它。

---

## 四、明确不做（写显式留痕测试）

- **投掷**（B-2）、**三占位卷轴**（B-3）、**生成规则对齐**（B-4，独占轮）。
- **detect magic 极性**（B-1c）——`isPolarityRevealed()` 保持留形。
- `removeCurseFromInventory` 的负附魔偏差（只登记）。
- **不碰生成器**——那是并行的 C-6 的地盘。

---

## 五、硬门禁：本轮不许移动 RNG 流

持久化与 UI 交互不该消耗掷骰。**`generation_baseline` 必须保持绿**
（它已按 C-5 重捕获）。红了说明动了生成期，**停下来报告，不许刷新 fixture**。

---

## 六、文件边界（硬约束）

**允许修改**（路径已由验收方 grep 核实）：
- `src/engine/Core/Game.ts`（快照 schema、`identifyRandomItem`、
  移除两个免费方法）
- `src/engine/Items/Item.ts`、`ItemLoader.ts`
- `src/entities/Player.ts`（**仅**戒指双槽所需）
- `src/components/InventoryOverlay.vue`（**仅**移除 167/172 两个按钮入口 +
  identify 目标选择 UI）
- `src/locales/zh_CN.json`（仅增键）
- **既有测试**（两段 grep 生成）：
  `b_1a_identification.test.ts`（**留痕反转**）、
  `p1_31_35_placement_snapshot.test.ts`（快照增字段）、
  `scroll_effects.test.ts`（identify 卷轴改指定目标）、
  `p2_0_seeded_rng.test.ts`、`p1_28_flag_channel.test.ts`
  **限定**：只改因本轮行为变化而到期的断言，**不许放宽守卫性质**。逐条写进报告。
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- **C-6 的地盘**：`src/engine/Generator/` 下任何文件、`src/engine/Map/`
- `src/engine/Environment/`、`src/entities/` 下除 `Player.ts` 外的文件
- **`BrogueCE-master/` 下任何文件**
- 任何 `src/data/*.json`（生成规则归 B-4）、`src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`**、`src/test/harness.ts`、上面未列出的既有测试文件

**已知工具盲区**（B-1a 踩过）：i18n 扫描器**整体跳过模板字符串**，
写在 `${}` 里的 `t()` 调用会被判成死键打红门禁。扫描器不在允许清单——
**改自己的写法绕开，不要改扫描器**（B-1a 就是这么处理的）。

---

## 七、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少七条**，必须含：
   - 存档只存了种类集、丢了实例旗标（或反之）
   - 读档后未知态被"按 spawn 语义重建"覆盖
   - called 绰号覆盖了真名（已鉴定物品仍显示绰号）
   - identify 卷轴仍随机挑而非玩家挑
   - 免费按钮仍可调用
   - 戒指只处理了一只手
   - **RNG 流被移动**（§五，**建在构造地图上**）
3. **反向验证（强制）**：至少四条真的改坏、贴真实失败输出、还原。

---

## 八、交付

报告写入 `ai_docs/b_1b_identification_persistence_report.md`，必须含：
- 快照 schema 的新增字段与向后兼容（旧存档怎么办）；
- CE `callTitle` 语义的出处与复核；
- **B-1a 那条"戒指三槽语义已就绪、循环展开即可"预测的验证结论**；
- `generation_baseline` 保持绿的实际输出行；
- 改了哪些既有测试断言、逐条说明为什么到期；
- 对抗性测试与反向验证的真实失败输出；
- 给 B-1c / B-2 / B-4 的登记清单。

**留痕规矩**：遇到留痕与文件边界冲突，**停下来申报**，
**不要把代码扭曲成扫描正则看不见的形态**——那是自造假绿。
