# V-2b-8 补完轮

> **在分支 `round/v-2b-8` 上执行**（不是 main）。产物完好，接着往下做。

## 0. 先读：产物完好，且**上一轮没做错，是任务书写错了**

上一轮的交付在 `round/v-2b-8` 分支上（提交 `WIP(V-2b-8)`），**不要推倒重来**。
已完成且经验收方复核：

| 已完成 | 证据 |
|---|---|
| `buildAMachine` 的 `bp` 形参 | 报告 §1 |
| MT_* 接线 | 报告 §2 |
| 4 地形 + 6 DF（含闭包） | 报告 §3 |
| 八条蓝图 | 报告 §4 |
| **thematic 机器真的建出来了** | 3 seed × 78 层实测 **30 台**（Shrine 3 / Idyll 2 / Swamp 17 / Remnant 7 / Dismal 1）——翻转了 V-1c 以来 thematic 绝迹的状态 |

**上一轮唯一的问题不是它的错**：验收方任务书 §7 写成「只跑**你实际改动过**的文件」。
但授权清单存在的意义恰恰是**改动会外溢**——验收方本地全量门禁跑出 **15 条失败**，
其中 **9 个文件上一轮从未跑过**。这是任务书的缺陷，已在本轮 §4 修正。

## 1. 要修的 15 条（验收方本地全量门禁实测）

### A 类：穷举表计数（3 条）——机械更新

```
c_4a_terrain_catalog  全 TerrainType 键覆盖      expected 103 to be 101
r_1_appearance        穷举表覆盖全部成员          expected 103 to be 101
c_4a_0_layer_model    归属表与 drawPriority 全等表  …(100) vs …(?)
```
表体像是更新了、**计数断言没跟上**。核对新增了几个成员，把三处数字同步。

### B 类：新地形的可通行性（2 条）——判断题

```
c_4a_terrain_catalog  terrainAllowsMove ≡ 旧排除清单   BLOODFLOWER_STALK: expected false to be true
c_4a_terrain_catalog  Game.canMoveTo ≡ 旧清单          BLOODFLOWER_STALK: expected false to be true
```
**回 CE 查 `BLOODFLOWER_STALK` 的 `T_OBSTRUCTS_PASSABILITY`**，按 CE 事实决定它进不进
排除清单，给出 `Globals.c` 行号。不要为了让测试绿而随手选一边。

### C 类：机器结构合同（2 条）——**真缺陷候选，先诊断**

```
blueprint_center  b) 全局扫描          expected [ …(3) ] to deeply equal []
p1_33             a) 端到端复验        机器结构合同被破坏：seed777/D2 ce_60_idyll center (71,21) 不可通行 …
```
新落的 thematic 机器（如 `ce_60_idyll`）的 **center 落在不可通行格**上。
这两条是同一缺陷的两把尺子。

回 CE 查：Idyll 这类 **BP_ROOM 之外的区域机器**，CE 怎么定它的"中心"？
web 的 `center` 语义（宝藏落点，见 `BlueprintEngine.ts` 的 `findSuitableRoom` / 前厅分支注释）
对区域机器是否适用？**先查清成因再决定改哪边**——若结论是实现错，修实现；
若是断言前提对区域机器不适用，按留痕反转改断言**并说明为什么**。

### D 类：覆盖门被触发（1 条）——**这是好事，说明守卫在工作**

```
v_2b_7_features  F1  6 seed × D1-26 应至少观察到一只携钥匙的怪（否则本用例空转）: expected 0 to be greater than 0
```
V-2b-7 给这条加了覆盖门，正是为了防止它静默空转。本轮生成流一动，
**样本里再也没有携钥匙的怪了**。

**不要直接放宽这个门。** 查清：是新机器挤掉了 11 号 Vampire lair 的生成机会，
还是别的原因？若确属"合法的概率变化"，**换更大的样本或更稳的选样**让它重新有观测对象；
若是 11 号建不出来了，那是回归。

### E 类：其余 7 条——逐条诊断

```
c_5_fall_subsystem   坠落回合 RNG 消耗增量偏离
c_5_fall_subsystem   深水落点必须零伤害: expected 10 to be 0
f_2c_explosion       起火登记豁免：本趟不掷衰老骰: expected 1 to be 0
g_2_gas_df_wiring    2 体积不得凭空消失: expected 0 to be >= 1
p1_37                AD3 A−B 变动（选中层 D2）
v_1a                 T3 area_shrine 掩码逐字: expected undefined to be defined
v_2b_2a              P1 TREAT_AS_BLOCKING 载体数
```

`v_1a` T3 的 `undefined` 值得先看——`area_shrine` 是本轮碰到的蓝图之一。
`c_5` / `f_2c` / `g_2` 三条看着与本轮主题无关，**要么是新地形/DF 的外溢，要么是真回归**，
逐条给结论。

## 2. 基线

上一轮已重捕获（耗时 186.88s）。**本轮改完后必须再重捕获一次**（仍是最后一步）——
因为 §1 的修复若涉及实现改动，生成流会再动。

上一轮诚实申报了"数值上分不开"（云端窗口装不下三次反事实构建）。**本轮若仍分不开，
照样如实说**；但若窗口允许，补上分离实验。

## 3. 授权改动清单

沿用 `v-2b-8.prompt.md` §3 的清单（已含本轮全部 15 条涉及的文件），**再加**：
`src/test/c_5_fall_subsystem.test.ts`、`src/test/f_2c_explosion.test.ts`。

清单外改动必须申报。`BrogueCE-master/` 只读。**守卫顺延不放宽**。

## 4. 门禁跑法（**已修正上一轮的缺陷**）

上一轮的口径「只跑你实际改动过的文件」**是错的**。改为：

> **跑 §3 授权清单里的全部文件**（不只是你改动过的），逐个或分批
> `npx vitest run src/test/<file> …`。授权清单存在的意义就是改动会外溢。

参考耗时（验收方本地实测）：清单里最重的几个是
`c_8_connectivity` 364s、`b_4a_item_generation` 523s、`c_1_room_profile` 418s。
**若窗口装不下全部，优先跑本轮 15 条涉及的文件 + `generation_baseline`**，
并在报告里列出**你没跑到的文件**——不要沉默跳过。

`npm run build` 要跑。仍然**不要**跑不带文件参数的全量 `npx vitest run`。

## 5. 报告

写到 `ai_docs/reports/v-2b-8-finish.report.md`，含：

1. 15 条逐条：成因 → 处置 → 依据（CE 行号或实测数据）
2. **C 类那两条的诊断过程**（本轮最重要的一节）
3. **D 类覆盖门的处置**：怎么让它重新有观测对象，而不是放宽
4. §2 基线重捕获与成因说明
5. §4 口径下你**跑了哪些文件、没跑哪些**
6. 授权反驳（本任务书的失败分类是验收方按错误消息首行做的，读代码发现分错了就指出来）
