# B-1c：detect magic 极性揭示

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**（`status`/`diff`/`log` 只读允许）。

**授权反驳条款有效**：CE 源码优先。本任务书的事实陈述可能有错——
前几轮执行方纠正过验收方十余次（爆炸伤害取 `maxHP/2` 而非当前血量、
"半径 4" 实为 `effectRadius`、`DF_GAS_FIRE` 是 SURFACE 层等）。
**请继续，包括反驳本任务书。**

**先读**：`ai_docs/b_0_phase_b_survey.md`（鉴定系统全貌）、
`ai_docs/b_1a_identification_report.md` §8「给 B-1c」、
`ai_docs/b_1b_identification_persistence_report.md` 的登记清单。
凡本任务书与它们冲突，**以 CE 源码为准并在报告里指出**。

---

## 一、本轮定位

**⚠️ 本轮与 C-6（runAutogenerators，改生成）并行执行**，文件边界已划开。

B-1a 建了两层未知态模型与揭示规则，其中**极性半支留形**：
`ItemLoader.isPolarityRevealed()`（`ItemLoader.ts:271`）**恒返回 false**，
它的消费点在 `ItemLoader.ts:288` 的升格规则里。B-1b 补了持久化。
本轮把 detect magic 接上，那条留形分支即激活。

---

## 二、范围

### 1. CE 的极性模型

`Rogue.h:1435-1436` 的 `itemTable` 有两个字段：
`magicPolarity`（+1 善意 / −1 恶意 / 0 无魔法）与 `magicPolarityRevealed`。
**自己核实字段语义与它们在 CE 里怎么被设置/读取。**

### 2. `detectMagicOnItem` 与 `POTION_DETECT_MAGIC`

`Items.c:8027` 是 `detectMagicOnItem`，`Items.c:8137-8142` 是药水分支
（遍历背包对每件调用它）。**逐行读完再实现**，注意
`magicCharDiscoverySuffix(...) == -1` 那个前置条件（`Items.c:7757` 与 `8050`
各出现一次）在做什么。

### 3. 接上留形分支

`isPolarityRevealed()` 改为读真实状态；B-1a 的升格规则里"极性半支"随之激活
——**B-1a 预测"改为读真实状态即激活"，请验证这个预测是否成立**
（本项目的惯例：下一轮验收上一轮的预测，已用过五次）。

### 4. ★ 先做载体盘点

`src/data/consumables.json` 里有没有 detect magic 药水？没有的话是新增数据
（**但 `src/data/*.json` 在禁改清单——停下来申报**，不要擅自改数据表）。
按项目规矩：**没有载体的机制不要接成空转链**（C-4c 的硫矿"每回合掷骰 11 次
全部缓办"就是没盘点的下场）。

---

## 三、明确不做（写显式留痕测试）

- **投掷**（B-2）、**三占位卷轴**（B-3）、**生成规则对齐**（B-4，独占轮）。
- `removeCurseFromInventory` 清负附魔的偏差（B-0 §5.3-5/9）——只登记。
- **不碰生成器**——那是并行的 C-6 的地盘。

---

## 四、硬门禁：本轮不许移动 RNG 流

极性揭示是状态读写，不该消耗掷骰。**`generation_baseline` 必须保持绿**。
红了说明动了生成期，**停下来报告，不许刷新 fixture**。

B-1b 建了**构造地图哨兵**（`randomNumbersGenerated` 增量口径，对地图变化免疫）
——本轮可复用同款做法，**不要建地图锚定的哨兵**
（C-5 那轮连累了两个地图锚定哨兵重锚）。

---

## 五、文件边界（硬约束）

**允许修改**（路径已 grep 核实）：
- `src/engine/Items/ItemLoader.ts`、`Item.ts`
- `src/engine/Core/Game.ts`（**仅**药水效果与极性相关区段）
- `src/components/InventoryOverlay.vue`（**仅**极性显示）
- `src/locales/zh_CN.json`（仅增键）
- **既有测试**（两段 grep + 被删符号 grep 生成）：
  `src/test/b_1a_identification.test.ts`（**极性留痕本轮反转**）、
  `src/test/b_1b_identification_persistence.test.ts`（若极性需入档）、
  `src/test/scroll_effects.test.ts`
  **限定**：只改因本轮行为变化而到期的断言，**不许放宽守卫性质**。逐条写进报告。
- 新增测试文件

**禁止修改**（违反即本轮作废）：
- **`src/data/*.json`**（见 §二.4：要加药水种类就停下来申报）
- **C-6 的地盘**：`src/engine/Generator/`、`src/engine/Map/`
- `src/engine/Environment/`、`src/entities/`
- **`BrogueCE-master/` 下任何文件**
- `src/engine/Random.ts`、`vite.config.ts`
- **`src/test/fixtures/*`**、`src/test/harness.ts`、上面未列出的既有测试文件

**已知工具盲区**：i18n 扫描器**整体跳过模板字符串**，写在 `${}` 里的 `t()`
会被判成死键打红门禁。扫描器不在允许清单——**改自己的写法绕开**。

---

## 六、测试要求

1. 每条断言必须能在某个具体的错误实现下失败。
2. **对抗性测试至少六条**，必须含：
   - 极性揭示后仍显示为未知
   - `magicPolarity` 的正负号写反（善意显示成恶意）
   - `magicCharDiscoverySuffix == -1` 的前置条件漏掉
   - 升格规则的极性半支没被激活
   - 极性状态不进存档（若本轮决定入档）
   - **RNG 流被移动**（§四，建在构造地图上）
3. **反向验证（强制）**：至少三条真的改坏、贴真实失败输出、还原。

---

## 七、交付

报告写入 `ai_docs/b_1c_detect_magic_report.md`，必须含：
- CE 极性模型的行号与你复核出的字段语义；
- `magicCharDiscoverySuffix == -1` 前置条件的作用；
- **载体盘点结论**（有没有 detect magic 药水；若需改数据表，申报而非擅改）；
- **B-1a 那条"改为读真实状态即激活"预测的验证结论**；
- `generation_baseline` 保持绿的实际输出行；
- 改了哪些既有测试断言、逐条说明为什么到期；
- 对抗性测试与反向验证的真实失败输出。

**留痕规矩**：遇到留痕与文件边界冲突，**停下来申报**，
**不要把代码扭曲成扫描正则看不见的形态**——那是自造假绿。
