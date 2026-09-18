# V-1b：实现 `MF_ALTERNATIVE` —— V-2 数据落地的前置机制

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错事实**。
凡引用的 CE 行号/语义都**必须打开 `BrogueCE-master/` 逐字核对**，
冲突时**以 CE 源码为准**，并在 `## 对任务书的反驳` 一节写明。

本项目近十轮里，执行方的反驳**多次是对的**，其中数次纠正了验收方的**方向性错误**
（把某条欠账的处置方向搞反、把落点指到 CE 结构相反的地方）。**照样反驳。**

## 1. 为什么这一轮很小

原计划的 V-1b 是"引擎轮"，打包资格过滤 + 配额 + 递归领养 + 回滚。
补勘察后发现**这几件相互耦合，不能拆开落地**：

- **抽签资格过滤**（CE `blueprintQualifies`，`Architect.c:455-468`：
  `BP_VESTIBULE` / `BP_ADOPT_ITEM` 非被要求则不得被顶层抽中）
  必须**配合递归**才成立 —— 否则 web 的 vestibule / key_guard 类蓝图
  会**一个都建不起来**，关卡直接少掉这些机器，中间态比现状更糟；
- **奖励房配额**在 CE 里只管 `BP_REWARD` 抽签
  （`Architect.c:1757-1775`，`(rewardRoomsGenerated + machineCount) * 4 + 2 < depth`，
  靠**跨层全局计数器**，开局在 `RogueMain.c:292` 清零），
  而 web 是**所有类别同池抽**；不先做资格过滤就套配额，
  会把所有机器一起砍掉，同样不是 CE 等价。

所以那三件统一归 **V-1c**（独占的结构大轮）。

**本轮只做一件真正独立、且是 V-2 前置的事：`MF_ALTERNATIVE`。**

## 2. 要做什么

### 2.1 实现 `MF_ALTERNATIVE` 与 `MF_ALTERNATIVE_2`

CE 实现在 `Architect.c:1291-1316`（**逐字核对**）：

- 在 **feature 构建循环之前**一次性决定；
- 把带 `MF_ALTERNATIVE` 的 feature **全部标记 skip**，统计数量 `totalFreq`；
- 若 `totalFreq > 0`，掷**一次** `rand_range(1, totalFreq)`，
  按顺序数到第 `randIndex` 个，把它 un-skip（**只建这一个，其余不建**）；
- 被选中的那个**照常按自身 `instanceCount` 全建**；
- 然后对 `MF_ALTERNATIVE_2` **独立重复一遍**（`for (j = 0; j <= 1; j++)`）——
  两个独立的"几选一"集合，**各消耗一次掷骰**（集合非空时）。

web 的落点：`src/engine/Generator/BlueprintEngine.ts:461` 的
`for (const feature of bp.features)` 之前。

⚠️ **`MF_ALTERNATIVE_2` 在 Brogue 的蓝图目录里零使用**（V-0 已 grep 确认，请复核）。
但**仍要实现**，因为 CE 的循环结构就是两轮 —— 照抄留形，
且 V-2 全表重写时可能用到。

### 2.2 为什么必须先于 V-2

V-0 点名的陷阱：CE 的基座大奖是
「附魔卷轴 **或** 生命药水」二选一（带 `MF_ALTERNATIVE` 的两条 feature）。
**web 现在没有这个机制** —— 若 V-2 先把 CE 掩码数据落进来而本机制缺位，
两条 feature 会**同时生成**，变成**双份发放**，比现状更糟。

### 2.3 顺带：死旗标审计（**只登记，不实现**）

V-0 发现 web 引擎只认 7 个 `MF_*` 旗标，而数据里用了 11 个。
验收方复核确认：引擎认
`MF_ALTAR / MF_ALTAR_GROUP / MF_GENERATE_ITEM / MF_GENERATE_MONSTER /
MF_MONSTER_IS_ALLY / MF_MONSTER_IS_CAGED / MF_NEAR_ORIGIN`，
数据另用了 **`MF_FILL_DOORWAY` / `MF_KEY_DISPOSABLE` / `MF_RING` / `MF_SCATTER`**
—— 这四个是**死旗标**（写在数据里但引擎完全忽略）。

本轮**逐个查清它们在 CE 里的确切语义**（行号为据），
并在报告里给出一张表：旗标 / CE 语义 / web 现状 / 建议归属轮次。
**不要实现它们** —— 那是 V-2 的数据轮或独立小轮的事，本轮只出勘察结论。

## 3. 绝对禁止

- **不得修改 `BrogueCE-master/`**（只读参考，D6）。
- **不得实现**抽签资格过滤、奖励房配额、递归外包/领养、失败回滚（全归 V-1c）。
- **不得实现**§2.3 那四个死旗标。
- **不得修改 `blueprints.json` 的数据内容**（V-2 的事）。
  ⚠️ 例外：若为了给 `MF_ALTERNATIVE` 写测试需要**一个**夹具蓝图，
  **写在测试文件里**，不要动生产数据。
- 不得为了让测试变绿而放宽断言。

## 4. RNG 影响与基线

`MF_ALTERNATIVE` 的实现**会掷骰**（集合非空时每集合一次）。
但**当前 `blueprints.json` 里没有任何 feature 带这两个旗标**（请自行确认），
所以 `totalFreq` 恒为 0、**不会掷骰**，生成流**应当逐位不变**。

**判据**：`generation_baseline` 必须**绿且 fixture 未被重新捕获**。
若你发现实际会掷骰，**停下来说明原因**，不要擅自重捕获基线。

## 5. 允许修改的文件

**先按四段 grep 自查**（`project_conventions.md`）。

**生产代码：**
- `src/engine/Generator/BlueprintEngine.ts`

**测试：**
- 新建 `src/test/v_1b_alternative.test.ts`

**清单外撞红：停下，不要改**，写进 `## 需要追加授权的测试`。
⚠️ 写清单前**先读 V-0 报告 `ai_docs/v_0_survey.md` 的「不确定与缺口」节** ——
验收方已经两次因为没读上一轮报告的预告而漏收撞红文件。

## 6. 测试要求

1. **几选一语义**：构造一个带 3 条 `MF_ALTERNATIVE` feature 的夹具蓝图，
   大样本统计 —— **恰有一条被建**，且三条的命中分布均匀（各约 1/3）。
2. **两个集合独立**：同时带 `MF_ALTERNATIVE` 与 `MF_ALTERNATIVE_2` 的夹具，
   断言两组**各自**恰建一条、互不影响。
3. **被选中者按 `instanceCount` 全建**（不是只建 1 个实例）。
4. **RNG 消耗**：用 `rng.randomNumbersGenerated` 增量断言 ——
   集合非空时**恰消耗 1 次**；**集合为空时恰消耗 0 次**
   （后者是"现有数据零掷骰、基线不动"的机制保证）。
5. **对抗性测试 ≥ 3 条 + 强制反向验证**：真改坏 → 跑 → **贴真实失败输出**
   → 还原 → `grep -rn "REVERT-ME" src/` = 0。
   建议其一：把"选一条"改成"全建" → 测试 1 必须红。

## 7. 门禁

`npx vitest run --fileParallelism=false`（**不带文件参数**）
**外加 `npm run build`**（不要用 `tsc --noEmit`）。

## 8. 最终回复必须包含

1. `## 对任务书的反驳`
2. `## MF_ALTERNATIVE 实现与 CE 的逐条对照`
3. `## 死旗标审计表`（§2.3，四个旗标的 CE 语义 + 建议归属）
4. `## 改动清单`
5. `## 对抗性测试与反向验证`（含**真实失败输出**）
6. `## 需要追加授权的测试`
7. `## 门禁结果`（含 `generation_baseline` 绿且 fixture 未动的证据）
8. `## 遗留与登记`（给 V-1c / V-2 的交接）
