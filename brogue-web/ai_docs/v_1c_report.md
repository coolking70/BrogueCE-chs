# V-1c 交付报告：机器系统的结构还原（资格过滤 / 配额 / 递归 / 回滚）

> 执行：ZCode/GLM（开发方），2026-09-18。
> 任务书：`ai_docs/tasks/v-1c.prompt.md`。本轮为独占轮、移动生成期 RNG 流。
> 全部改动限于 worktree `wt-v-1c`（分支 `round/v-1c`）的 `brogue-web/` 内。

## 1. 对任务书的反驳

本轮 CE 引用全部逐字复核，**行号与语义零冲突**（blueprintQualifies
Architect.c:455-468；配额在 `addMachines()` :1757-1775；外包/领养 :1543-1575；
回滚 :1576-1583 与 :1676-1687；备份 :1222 "point of no return"；
常量 variants/GlobalsBrogue.c:1026-1030；`rewardRoomsGenerated`
Rogue.h:2504 / RogueMain.c:292）。以下是需要说明的分歧与补充：

1. **门禁跑法（任务书 §8 已过时）**：任务书写
   `npx vitest run --fileParallelism=false`；但 `project_conventions.md`
   2026-09-18 的「门禁跑法更正」已实测废除该参数（串行 24 分钟且是跨文件
   泄漏的**病因**本身；并行 7 分钟、同 1161 绿零红），用户指令亦明确不带该
   参数。**本轮按并行全量 `npx vitest run` 执行**。
2. **`deepestLevelForMachines` 的值任务书未给出**：自查为
   `variants/GlobalsBrogue.c:1030 .deepestLevelForMachines = AMULET_LEVEL`
   （=26）。配额保底 while 的深度闸门按 26 落地（web 常量
   `DEEPEST_LEVEL_FOR_MACHINES`）。
3. **category ↔ BP_\* 映射的核对结果（任务书 §3.1 授权自查）**：
   - `reward` ↔ `BP_REWARD`：吻合（web 5 条 reward_* 蓝图的 flags 数组
     本就带 `BP_REWARD` 字符串，category 与之一致）；
   - `key_guard` ↔ `BP_ADOPT_ITEM`、`vestibule` ↔ `BP_VESTIBULE`：
     CE 目录（variants/GlobalsBrogue.c:299 一带 9 条 BP_VESTIBULE、:348
     一带 16 条 BP_ADOPT_ITEM）证实前厅/守卫机器正是靠这两个旗标被递归
     请求建立；web 蓝图的 flags 数组不带这两个字符串，**category 字段是
     它们在本轮的语义载体**（`effectiveBpFlags = flags ∪ category 映射`）；
   - `thematic` ↔ **无 CE 对应位**：CE 顶层（addMachines）除奖励房外只有
     Bullet 变体 L1 兵器库与 D26 `MT_AMULET_AREA`；CE 的风味机器
     （如 `MT_SWAMP_AREA`，autoGeneratorCatalog GlobalsBrogue.c:139）走
     runAutogenerators 通道——该通道 web 侧无载体且被 c_6 钉死空转。
     因此 area_* 蓝图映射为空集、**不再被顶层抽中**（D2：自创内容退池
     留形，非删除），内容回归归 V-2 数据与 autoGenerator 接线轮。
4. **blueprints.json 零改动**：任务书 §4 预留的「只加 BP_* 标记字段」
   例外最终**没有动用**——category 已足以承载资格语义，数据一字未改。
5. **一处降 scope 申报（CE :715-723）**：fillVestibuleInterior 首版曾把
   BP_TREAT_AS_BLOCKING / BP_REQUIRE_BLOCKING 的连通性复核接上
   `levelIsDisconnectedWithBlockingMap`，全量门禁撞红 c_4b F1
   （「DF 子系统生产引用白名单」扫描器——任务书 §6 清单外）。因该检查
   在当前数据下结构性不可达，按「宁可停下申报」降 scope：从生产代码
   移除接线（本报告 §2 留形清单、§7 无涉），激活轮补上。此撞红的成因
   是本轮四段 grep 漏了第五形态的一个变体——扫描器钉的不是字段读取
   而是**模块符号引用**，主题 grep（machine/配额/递归）够不到它。
6. **applyBlueprint 签名兼容**：新签名 `(bp, room, ctx?)`，v_1b /
   p1_33 / blueprint_center 的两参调用与原型包装全部不受影响（实测绿）。

## 2. 四件事逐条落地情况

| # | 事项 | 状态 | 落点 |
|---|---|---|---|
| 1 | 抽签资格过滤 `blueprintQualifies` | ✅ | `BlueprintEngine.ts`：导出函数直译 CE :455-468（深度覆盖 + required 全含 + ADOPT/VESTIBULE 两条 NOT-unless-required）；每次建造尝试重掷蓝图（CE chooseBP :1028-1061） |
| 2 | 奖励房配额 + 跨层计数器 | ✅ | `buildMachines()` 直译 CE addMachines :1757-1775；`rewardRoomsGenerated` 模块级计数器 + `get/set/reset` 三口；Game.ts：startNewGame 清零（RogueMain.c:292 等价）、toSnapshot/loadSnapshot 往返（旧档 `?? 0` 兜底） |
| 3 | 递归外包 / 领养 / 前厅 | ✅ | applyBlueprint 特征循环内直译 CE :1495-1575：MF_ADOPT_ITEM 消耗父机物品（只领一次）；MF_OUTSOURCE_ITEM_TO_MACHINE 不落本机、交子机器；MF_BUILD_VESTIBULE 在特征位建前厅；10 次重试、成功并 `subMachines`（CE 并入 spawned 缓冲的 web 等价）、全败整机中断 |
| 4 | 失败回滚（两触发点） | ✅ | `backupLevel/restoreLevel`（CE copyMap levelBackup :1222，快照 layers/char/color/isPassable/isOpaque/machineNumber/trapType/altarGroupId）；触发点①递归 10 次全败（:1576-1583）、②feature 实例数不达 minimumInstanceCount（:1676-1687，web 缺省取 `instanceCount[0]`，字段已进 FeatureDef 供 V-2 显式化）；`buildAMachine` 的 point of no return 与 CE 同位（选址成功后） |

**deferral：无。** 四件事全部落地。任务书 §4 的禁令全部遵守：
未实现 MF_KEY_DISPOSABLE、未改 blueprints.json、未动 BrogueCE-master/。

**结构性留形（生产不可达，激活轮需重核）**——因生产数据零载体：
- `MF_OUTSOURCE_ITEM_TO_MACHINE` / `MF_BUILD_VESTIBULE` / `MF_ADOPT_ITEM`
  的递归路径（R1/R2/R3 用合成蓝图行使，机制已被测试钉住）；
- `fillVestibuleInterior`（CE :674-730 直译）：CE :706-710 的 HAS_ITEM
  中止在 web 结构性不可达（机器阶段物品是指令、不在网格上）；
  cost 口径用 web 的 PDS_FORBIDDEN 约定（Game.findQualifyingPathLocNear
  同款：`!isPassable ∪ LAVA ∪ WATER_DEEP ∪ TRAP ∪ 机器格`），非 CE
  populateGenericCostMap 的逐地形代价——P1-33 已登记的同族偏差；
- **BP_TREAT_AS_BLOCKING / BP_REQUIRE_BLOCKING 复核（CE :715-723）刻意
  未接线**：首版曾用 `levelIsDisconnectedWithBlockingMap` 接上，全量门禁
  撞红 c_4b F1（「DF 子系统符号的生产引用白名单」扫描器，授权清单不含
  该测试）；因该检查在当前数据下结构性不可达，按边界纪律**降 scope 移除
  接线**（生产代码侧消除撞红，不动清单外测试），留待激活轮按 c_4b 测试
  标题预告的「C-4d 接线机器时再扩清单」流程扩白名单后补上。

## 3. 纯测量数据

同一测量口径（15 seeds × D1-D26 = 390 层，临时 spec 采集后已删除）：

| 指标 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| 机器总数 | 1518（3.89/层） | **87（0.22/层）** | -94% |
| 有机器层数 | 372/390 | 73/390 | 配额语义（约每 4 层 1 间 + 15% 加成） |
| 锁门机器 | 1022 | 35 | 锁/钥仍一一对应 |
| 类别分布 | key_guard 474 / reward 293 / thematic 200 / vestibule 551 | reward 87 | 顶层抽签只剩 BP_REWARD |
| 蓝图物品指令 | 542 | 125 | |
| 蓝图怪物指令 | 1322 | 23 | |

改造后蓝图分布：reward_consumables 30 / reward_pedestals 19 /
reward_kennel 16 / reward_commutation 12 / reward_library 10。

CE 手算对照（新测试 Q3/Q4 钉点，6-pocket 合成图）：D10、计数器 0 →
恰 **2** 台；计数器 1 → 恰 **1** 台（CE while 手算一致；旧制
`min(2+⌊10/3⌋,6)=5` 的实现会在 Q3 翻红）。整局每局实测 5.8 台
（87/15），与「保底界 6 + 15% 加成」的理论量级吻合。

## 4. 改动清单

生产（2 文件）：
- `src/engine/Generator/BlueprintEngine.ts`：buildMachines → CE addMachines；
  新增 buildAMachine / blueprintQualifies / fillVestibuleInterior /
  backupLevel / restoreLevel / effectiveBpFlags；findGateRoom 三态化；
  applyBlueprint 增领养/外包/前厅递归与最小实例数检查；rewardRoomsGenerated
  计数器三口；构造器增可选蓝图注入（测试夹具用）。
- `src/engine/Core/Game.ts`：GameSnapshot.rewardRoomsGenerated 字段；
  startNewGame 清零；toSnapshot/loadSnapshot 往返。

测试（3 改 1 增）：
- `src/test/v_1c_machine_structure.test.ts`：**新增**，12 用例。
- `src/test/p1_33_machine_chokepoint.test.ts`：a) 防塌缩下限按配额语义
  重校准（1200→50 台、700→15 锁、零机器层上限→非零层 ≥40 下限，注释写明
  口径变更缘由）；e) run() 前补 `resetRewardRoomsGenerated()`（配额计数器
  是 run 级全局，同 C-4a-0「完整生成链」口径）。
- `src/test/p1_37_machine_flag_i18n.test.ts`：AD1 机器数下限 300→12
  （防"生成器/记录器整体失效"，不钉数量）。
- `src/test/fixtures/generation_baseline.json`：授权重捕获（note 追加、
  capturedAt=V-1c）。

数据：`src/data/blueprints.json` **零改动**。

`git diff --stat`：
```
 brogue-web/src/engine/Core/Game.ts                 |   27 +-
 brogue-web/src/engine/Generator/BlueprintEngine.ts |  476 ++++++-
 .../src/test/fixtures/generation_baseline.json     | 1490 +++++------
 .../src/test/p1_33_machine_chokepoint.test.ts      |   25 +-
 .../src/test/p1_37_machine_flag_i18n.test.ts       |    5 +-
 5 files changed, 1214 insertions(+), 809 deletions(-)
（另有未跟踪新文件：src/test/v_1c_machine_structure.test.ts 约 430 行、
 ai_docs/v_1c_report.md 本报告）
```

## 5. 对抗性测试与反向验证

12 个用例（Q1/Q2/Q1b/Q3/Q4/Q4b/Q7/R1/R2/R3/R4/R4b），每个钉一种合理
的错误实现（详见测试文件头注）。强制反向验证**三处改坏**，全部真实翻红
后还原，`grep -rn "REVERT-ME" src/` = **0**：

- **①递归全败不中止**（`if (!success && false) return null`）→
  R3 红，真实输出：
  ```
  × R3 领养 10 次全败 → 整机回滚：无输出、地图逐位复原、无孤儿（CE :1576-1583） 16ms
  AssertionError: 领养全败时不得有任何机器（含残骸）流出: expected [ Array(1) ] to deeply equal []
  ```
- **②失败后不恢复地图**（删 `this.restoreLevel(backup)`）→ R3+R4 双红：
  ```
  AssertionError: 回滚后地图与动手前不一致（备份/恢复缺失或残缺）: expected '1/0/0/0| |0|||0|1;…' to be '1/0/0/0| |0|||0|1;…'
  AssertionError: 最小实例数回滚后地图未复原: expected '1/0/0/0| |0|||0|1;…' to be '1/0/0/0| |0|||0|1;…'
  ```
- **③资格过滤删两条 NOT-unless-required 守卫** → Q2 红：
  ```
  × Q2 两条 NOT-unless-required 守卫：ADOPT/VESTIBULE 位只在被要求时可选；…  3ms
  AssertionError: expected true to be false // Object.is equality
  ```
  （附注：③下 Q1b 仍绿——当前数据里 vestibule/key_guard 本就不带
  BP_REWARD，顶层要求位已足够排除它们；两条守卫的独力价值在 required
  为空或未来新增调用方时，Q2 是唯一防线。）

还原后 12/12 复绿。

## 6. 哨兵处置

- **生成期**：`generation_baseline` 按任务书 §5 授权重捕获
  （4 seeds × D1-D26 全量指纹/怪物/物品重写，note 注明 V-1c 与原因）。
- **交互期**：本轮生产改动全部发生在生成期（机器建造），玩家回合路径
  零改动、零新增掷骰——无需交互期哨兵（per B-1c 规矩的分工口径）。
- **新哨兵形态**：本轮新测试未锚定 RNG 流绝对位置；夹具为
  任务书 §7.1 允许的 ②（合成层：手工 Grid + 注入合成蓝图）与
  ③（性质断言：类别全集、配额手算钉点、地图逐位复原、计数器单调），
  端到端走完整生成链（C-4a-0 口径）。

## 7. 需要追加授权的测试

全量门禁共 **2 个清单外撞红**，均按「停下，不要改」处置，逐个归因如下。

**① `src/test/c_5_fall_subsystem.test.ts`（对抗①，:135）**——坠落回合
RNG 消耗 pin：`expected 10611 to be 15339`。该 pin 是**维护式快照**，其
注释自带沿革（7550→12327 C-6→14218 B-4a→15344 B-4b→15339 V-1a）与
「每个移动生成流的轮次 +1 行」的既定协议；注释还明确记录了验收方裁定
「这里允许硬填数值」的理由（web 单条连续流使"一层生成成本"无法脱离
seed+路径独立测得）。本轮移动生成流使 D2 生成成本变为 **10611**，
该测试文件不在任务书 §6 清单内——**请验收方按既定协议 +1 行重捕获**
（机制断言——怪物不得推进/不得受伤/深度已变/玩家掉血等 12 条——本轮
全绿，坠落门语义未破坏）。

**② `src/test/b_4a_item_generation.test.ts`（计量表重置用例，:114）**——
`expected -116 to be 34`（m[14] = POTION_LIFE 的 frequency）。
归因：`-116 = 34 - 150`，即 **seed7 的新局在 D1 恰好生成了 1 瓶生命药水**
（decrementFrequency=150）。这是本轮 CE 结构还原的**直接且合法的后果**：
CE 配额的前 2 层 40% 加成（Architect.c:1763，maxLevelForBonusMachines=2）
使 D1 可以出奖励房，reward_consumables 的 POTION feature 在 D1 抽中
life（CE 计量表 life 在 D1 无生成门：保底公式 `0*4+3 < 1` 不触发、
频率 34 可被正常抽中，Items.c:703-715 已核对）。旧制度下 D1 出 life
**结构性不可能**（reward_consumables 的 depthRange 从 D2 才开始），
所以「开局 life=34」是从未受考验的快照前提。该测试不在授权清单——
**请验收方裁定**：按新事实更新断言（seed7 定值为 -116；或断言改写为
"60+30 / 40+17 两条仍证重置生效 + life 允许 D1 偏移"）。注意测试的
本旨（计量状态随开局重置）并未被破坏——enchant 90 / strength 57 两条
同用例断言本轮全绿。

清点过的其他清单外测试（v_1a T5 整局 ench/life 带、p1_20 totalItems>500、
p1_26、c_6、p4_3、p1_29、b_4b、blueprint_center、p1_31_35、
invented_content_pool、horde/monster 系）**全部实测仍绿**。

## 8. 门禁结果

**`npx vitest run`（并行全量、不带文件参数、无 --fileParallelism=false）**：
```
 Test Files  2 failed | 90 passed (92)
      Tests  2 failed | 1177 passed | 8 skipped | 5 todo (1192)
 Duration  434.54s
```
唯二的 failed 即 §7 申报的 c_5（1 例）与 b_4a（1 例），均为清单外
维护式 pin 的预期撞红，已附归因与建议处置；除此之外**零红**——含全部
授权修改的测试（p1_33 / p1_37 / blueprint_center / p1_31_35 / v_1b /
generation_baseline）与清单外风险面（v_1a / p1_20 / c_4b / c_6 / c_8 …）。

**C-8 广度断言坏层 = 0 的证据**（最终代码全量门禁内实测通过）：
```
 ✓ src/test/c_8_connectivity.test.ts (7 tests)
 ✓ T1 复现样本回归：seed12 逐层下潜到 D25，上/下行楼梯互相可达且非机器可走格单连通
 ✓ T2 广度断言（区间来自修复前后实测）：30 seed × D1-D25 坏层=0   95401ms
```
（7 例含 T-AD2/3/4 判据对抗与 T4 零 RNG 哨兵，全绿。）

**`npm run build`**：
```
 dist/assets/index-DlX5RoQ1.js               885.55 kB │ gzip: 267.58 kB
 (!) Some chunks are larger than 500 kB after minification. Consider: …
 ✓ built in 1.49s
```
（vue-tsc -b 类型门禁通过；chunk 体积警告为存量既有，非本轮引入。）

## 9. 遗留与登记

**给 V-2（数据全量还原）**：
1. reward 蓝图接上 `MF_OUTSOURCE_ITEM_TO_MACHINE`（钥匙外包给守卫机器）
   与 `MF_BUILD_VESTIBULE`（锁门前厅）feature 后，本轮建成的递归机制
   即让 key_guard/vestibule 内容回归——CE 基座大奖（附魔卷轴 XOR 生命
   药水，GlobalsBrogue.c:218-219）的两条 MF_ALTERNATIVE feature 亦然；
   落地同一次提交会再次移动生成期 RNG 流，`generation_baseline` 随 V-2
   重捕获（v_1b_report §8 预告继续有效），其 P1 前提自检届时按注释更新。
2. `MT_AMULET_AREA`（D26 护符房）在 web 无载体蓝图——本轮顶层两个
   CE 调用（Bullet L1 兵器库、D26 护符房）都因数据缺席而留形未接，
   护符层目前仍由 populateLevel 直投护符（B-4b 口径）。
3. thematic 内容（area_swamp 等）回归路径 = autoGeneratorCatalog 的
   MT_* 条目接线（MT_SWAMP_AREA 等），注意 c_6 的「无载体条目不得接成
   空转链」钉死与激活流程。
4. `minimumInstanceCount` 目前缺省取 `instanceCount[0]`：V-2 按 CE 原值
   显式化时，若某 feature 的 CE 下限高于 [min,max] 下沿，机器失败率会
   上升（这是 CE 语义，不是回归）。
5. **激活留形分支的轮次请逐字重核**：fillVestibuleInterior 的 HAS_ITEM
   中止与 cost 口径（见 §2 留形清单）；**BP_TREAT_AS_BLOCKING /
   BP_REQUIRE_BLOCKING 复核本轮降 scope 未接线**——激活时先按 c_4b F1
   的流程扩白名单（该测试标题自预告「C-4d 接线机器时再扩清单」），再接
   `levelIsDisconnectedWithBlockingMap`（CE :715-723 两分支：false 判
   不断即弃、true 的区域数 < 100 即弃）；CE `populateGenericCostMap` 若在
   V-2 一并移植，dijkstra 代价表需对齐。
6. **验收方两处 +1 行**（§7 申报）：c_5 的生成成本 pin 15339 → 10611；
   b_4a 的 D1 life 计量断言 34 →（seed7 定值）-116。两处都是移动生成流
   轮次的既定成本，且 c_5 注释自证这是设计内协议。
7. 钥匙轮交接（v_1b_report §8 原样有效）：MF_KEY_DISPOSABLE 未实现；
   web 的「每锁一钥 + keyLoc{loc,machine}」与 CE 的
   addLocationToKey/addMachineNumberToKey 需在钥匙轮合流——本轮递归
   领养机制就位后，「守卫机器持有钥匙」的 CE 语义（key 跟着 MF_OUTSOURCE
   走、由子机器放置）已有落点，钥匙轮可在此基础上接 keyLoc 第三维。
8. p1_33 e) 的确定性现在依赖测试内 `resetRewardRoomsGenerated()`——若
   未来把计数器从模块态迁入 Game 实例态，需同步该测试与 Q3/Q4/Q7。
