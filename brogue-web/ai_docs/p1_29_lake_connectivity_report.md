# P1-29 轮次报告：修复 8.5% 关卡下楼梯不可达（湖泊连通性验证）

日期：2026-09-15　分支：`round/p1-29`（独立 worktree）
改动文件：`src/engine/Generator/Architect.ts`、`src/engine/Map/Connectivity.ts`（新增）、
`src/test/p1_26_invariants.test.ts`（仅留痕断言 → 严格 0）、
`src/test/p1_29_lake_connectivity.test.ts`（新增）、`src/test/p1_29_adversarial_gate.test.ts`（新增）

---

## 〇、与预设不符之处（只列不修）——**本轮最重要的一条发现**

### 0.1 硬指标「不可达层数归零」按字面**未达成**，原因在任务书边界之外

任务书预设：8.5% 坏层的根因是湖泊没有连通性验证，修湖即归零。

**实测结论：湖泊这个根因被彻底修掉了（湖泊致不可达 = 0，见 §三/§四），
但修复后仍有 2/260 层（0.8%）不可达——它们是第二个、独立的 bug，
病灶在 `src/engine/Generator/BlueprintEngine.ts`（机器阶段），不在本任务书
「允许修改」清单里。按项目常识 §5.1「发现'该修但在边界外'的问题时：
只列入报告，不要动手」，本轮不动它。**

证据链（临时探针分阶段拍照 + 逐格 diff，探针用完已删，方法可复现）：

| 层 | Architect 阶段（房间+湖泊+陷阱） | 机器阶段后 | 切割者 |
|---|---|---|---|
| seed777/D15 | **全连通**（干地 482/482） | 366/479，孤岛 113 格（下楼梯落点在内） | **机器锁门**：3 个格子被改成 LOCKED_DOOR（terrain 21，`canMoveTo` 排除），其一落在树状走廊割点上（该层深水格数 = 0，可排除任何水因） |
| seed999/D12 | **全连通**（干地 181/181） | 62/180，孤岛 118 格 | **机器特征水深水**：`BlueprintEngine.ts:307` 注释所指的 key_flood_trap 类特征把 WATER_DEEP 直接盖在走廊上（**绕过了本轮湖泊闸门**——闸门只约束 Architect 的 overlay 阶段） |

两例共同的放大器：web 尚无 `addLoops`（C-0，下一轮），地牢是**树**——
任何割点被锁门/水切断即永久孤岛。`BlueprintEngine.findSuitableRoom` 从
**任意非机器地板格** BFS 出一个"至多 maxSize 的连通块"当房间（不是 CE 那种
墙体包围的 vault），再把 LOCKED_DOOR 盖在块边界第一个贴墙格上；在无环路的
树上这经常是割点。修复该缺陷（连同给机器特征水过闸门）建议单开一轮，
P1-26 的严格 0 断言红着的就是它，修复落地后自然翻绿。

### 0.2 其余核对

- 任务书引 CE `designLakes`（Architect.c:2638-2688）、`lakeDisruptsPassability`
  （2588-2636）、20 次放置尝试（2659 `for (k=0; k<20; k++)`）——**逐行核实无误**。
- 「深水在 `canMoveTo` 里不可进入」——核实无误（`Game.ts:5855-5870`，
  排除 GRANITE/WALL/SECRET_DOOR/LOCKED_DOOR/WATER_DEEP，不排除 LAVA）。
- 「web 湖泊生成在 `Architect.ts` 的 `designEnvironmentOvelays`（约 333 行）」——属实。
- 修复前 21/260 坏层经「水体豁免泛洪」归因（把 WATER_DEEP 临时视为可通行再
  泛洪）：**21/21 全部水切**——任务书对修复前人群的根因归因完全成立。
- 「P1-26 的交接说明」照做：红（11）→ 改 0 → 现 red 1（=0.1 节的机器缺陷，
  非湖泊）。轨迹见 §七。

---

## 一、方案选择：(a) 在现有结构上加闸门（+ 一个测试缝隙）

**选 (a)，理由：**

1. **本任务书的定位是"最小修法"**（phase_c 提案 §八.4：「湖泊放置后做一次
   连通性验证，不通过就撤销该湖，远小于整个 C-2，可以单独摘出来先做」）。
   (b) 按 CE 重写 `designLakes`（六档尺寸递减 30×15→20×10、湖凿穿花岗岩、
   lakeMap 累积、`fillLakes` 四类液体、`createWreath` 镶边、`buildABridge`）
   是 C-2 的正篇，本轮做等于预支 C-2 且必然二次返工。
2. web 的 overlay 结构同时承载**可踏入**地形（浅水/草/树/泥/网）——这些
   不隔断移动，CE 的 `designLakes` 里没有对应物；重写反而要发明混合逻辑。
3. 任务书允许："若 web 的湖泊生成结构与 CE 不同构，用最接近的对应物并在
   报告说明"。

**影响面：** `designEnvironmentOvelays` 里只有 WATER_DEEP 一类走新闸门
（`canMoveTo` 口径下唯一不可踏入的叠加层），其余 overlay 代码路径逐字未动。
另把 `generateLevel` 的步骤 0-3 原样提取为 `public generateTerrain(depth)`
（纯移动代码，rng 消耗顺序不变——修复前后探针数据逐位一致可证），
给"湖泊阶段完成态全连通"这一合同一个可测的锚点。

**与 CE 的三处有意差异（均非平衡取舍，D1 不适用）：**

| CE | web 本轮 | 理由 |
|---|---|---|
| `lakeFloodFill`（2569-2586）**4 向**泛洪 | **8 向** | 闸门保护的就是"玩家可达"不变量；web 移动是 8 向且 `canMoveTo` 无对角穿墙限制（Game.ts:4684 注释）。CE 用 4 向是因 CE 对角移动有防挤墙规则。p1_26 验收泛洪同为 8 向 |
| 干地判据 `!cellHasTerrainFlag(T_PATHING_BLOCKER)` | `terrainAllowsMove`（Game.canMoveTo 地形口径镜像） | 任务书钉死：深水在 web 的实际移动规则里不可进入；CE 的 TM_CONNECTS_LEVEL 机器旗标 web 无对应物 |
| 湖凿穿花岗岩（`designLakes` 把 DUNGEON 层设 FLOOR） | 只盖 FLOOR（保留 web 行为） | 凿洞属 C-2；web 现有 overlay 对非 FLOOR 一律不覆盖 |

尺寸循环（六档递减）与最小生成尺寸按 web 原样保留（`randRange(8,20) ×
randRange(6,15)`、4×4）——方案 (a) 下最接近的对应物；**20 次放置尝试照搬 CE**
（`LAKE_PLACEMENT_ATTEMPTS = 20`）。

---

## 二、实现（CE 行号对照）

新增 `src/engine/Map/Connectivity.ts`：

- `terrainAllowsMove(terrain)` —— `Game.canMoveTo`（Game.ts:5855）地形判据的
  镜像；有测试按 TerrainType **全枚举**与 `Game.canMoveTo` 本体逐格比对钉死
  （漂移即红）。
- `lakeDisruptsPassability(grid, wouldBeLaked)` —— CE Architect.c:2588-2636
  对应物：把候选湖**假想放置**后，全部干地（可走 ∧ 非候选）必须属同一个
  8 向连通块；任一干地漏掉即"破坏连通性"。CE 的 `brogueAssert(x != -1)`
  （全图无干地）在 web 按 vacuous 接受——候选集只含 FLOOR，楼梯/门不可能
  被盖，实际到不了该分支。

`Architect.ts`：

- `placeGatedLakeBlob()` —— CE `designLakes`（2638-2688）放置语义：
  最多 20 次随机选址（2659）；每次先算**真正会被盖上的格子集**
  （blob 命中 ∧ 目标格是 FLOOR，与落地盖章同一子集规则），假想放置过
  `lakeDisruptsPassability` 才落地；不通过换位重试，**耗尽就跳过该湖**
  （CE 语义：不硬塞）。空候选（盖不到任何地板）视为无效尝试。
- `Architect.lakeGateStats = { placed, skipped }` —— 进程级累计，供测试/报告
  观测跳过频率（否则"有没有靠弃放蒙混"无法观测）。
- `designEnvironmentOvelays`：`const gated = !terrainAllowsMove(overlay.type)`
  分流；gated 走闸门，其余原路径逐字未动。

---

## 三、修复前后对比（10 种子 × D1–D26 = 260 层，同驱动同判据）

### 3.1 下楼梯不可达层数

| | 修复前 | 修复后 |
|---|---|---|
| 坏层数 | **21/260（8.1%）** | **2/260（0.8%）** |
| 归因 | 21/21 水切（湖泊） | 2/2 机器阶段（§〇.1），**湖泊致坏层 = 0** |
| 与 P1-26 的 5 种子交集 | 11 层，可达数与其报告逐一吻合（如 20260913/D1 可达 1/346） | 1 层（777/D15，机器锁门） |

修复前 21 坏层明细（探针实测，`[水切]` = 水体豁免后下楼梯变为可达）：
424242/D8(98/319)、777/D11(143/310)、20260913/D1(1/346)、20260913/D20(251/289)、
31337/D9(148/213)、31337/D12(236/254)、31337/D13(25/330)、20260916/D3(207/234)、
20260916/D8(31/336)、20260916/D13(89/203)、20260916/D14(20/359)、
1/D13(111/305)、1/D19(38/210)、1/D21(313/386)、1/D22(378/449)、
999/D8(70/290)、999/D13(397/425)、20260915/D18(33/198)、
55555/D10(153/226)、55555/D14(452/525)、55555/D17(366/389)。

### 3.2 水格数——如实披露：湖变小了，但**不是靠不放**

| | 修复前 | 修复后 | 变化 |
|---|---|---|---|
| 深水总格 | 4852 | 2662 | **−45%** |
| 浅水总格（不受闸门影响的对照） | 13454 | 13699 | +1.8% |
| 端到端闸门统计 | — | **placed=258 / skipped=0**（260 层，每层都有湖落地） | — |
| 湖泊阶段扫描（15 种子 × 26 = 390 层） | — | placed=383 / **skipped=1**，全连通 | — |

解释（三点，缺一不可）：

1. **两个数字来自不同的地图**：闸门的每次换位重试都会移动 RNG 流，
   同种子的湖形状/位置/后续一切生成全部重排——这不是"同一些湖被缩小"，
   而是"新地图上新湖"的对比。
2. **闸门偏好覆盖面小的位置**：大 blob 盖在大厅中央恰恰是会切断关卡的位置，
   会被拒绝换位；最终接受的是贴墙/覆盖少的位置。深水格均值 18.7 → 10.2/层
   主要是这个机理，**这正是"放得下才放"的 CE 语义本身**。
3. **"干脆不放"被数据排除**：skipped=0（端到端 260 层）——没有一个湖因
   20 次耗尽被放弃；每层仍有 0-2 个湖提案（`randRange(0,2)` 不变）且全部落地。
   浅水 +1.8% 持平也佐证整体地形没有系统性萎缩。真正的弃放极罕见
   （390 层湖泊阶段扫描中仅 1 次）。

---

## 四、10 种子复验汇总（端到端，`canMoveTo` 本体、8 向泛洪、上楼梯 → 下楼梯）

```
[p1_29] 端到端扫描：260 层，坏层=777/D15、999/D12，深水格=2662 浅水格=13699
[p1_29] 湖泊阶段扫描：390 层，闸门 placed=383 skipped=1，深水格=3848 浅水格=19342
[p1_29 AD1] 闸门短路后：43/130 层湖泊阶段不连通（闸门正常时应为 0）
```

- 湖泊阶段（闸门合同范围）：15 种子 × D1-D26 = 390 层**全部全连通**。
- 端到端：10 种子 × D1-D26，坏层恰为 §〇.1 的两个机器阶段缺陷
  （钉死在 `KNOWN_MACHINE_STAGE_BAD_LEVELS`，修机器后应更新为空集）。

---

## 五、对抗性测试 ↔ 错误实现映射（任务书 §测试要求 3）

文件：`src/test/p1_29_lake_connectivity.test.ts`（7 条）+
`src/test/p1_29_adversarial_gate.test.ts`（AD1，vi.mock 隔离）。

| # | 错误实现 | 捕获者 | 实测 |
|---|---|---|---|
| AD1 | **闸门短路**：`lakeDisruptsPassability` 恒返回 false（总是接受候选位） | `p1_29_adversarial_gate.test.ts`：短接后不可达必须回升 | 短路后 **43/130 层**湖泊阶段不连通（vs 闸门正常时 0）——闸门是承重墙 |
| AD2 | **20 次耗尽后硬塞**（而非跳过） | 「对抗 AD2」：两间互不连通斗室上，任何非空候选都被拒 → 必须 `return false` 且零深水落地；附开阔地正控（证明助手没被钉死为拒绝） | RV2 中红：`expected true to be false`；且核心不变量同红（390 层中真实发生过 1 次跳过，硬塞即破坏该层） |
| AD3 | **判据误用 `cell.isPassable`**（深水 isPassable=true，阻隔隐形——验收方踩过的坑） | 「对抗 AD3」：A-P-B-Q-C 三间 + 预存深水桥 W，候选湖盖 P。canMoveTo 口径必须拒绝（W 不是干地）；误用 isPassable 则把 W 当干地而接受。附地板桥对照（真实替代路径必须接受，防闸门过严） | RV3 中红：`expected false to be true`；同轮另有两条联动红（见 §六 RV3） |

附加钉子（防漂移，非对抗项）：

- 「判据口径钉死」：`terrainAllowsMove` 对全部 TerrainType 与 `Game.canMoveTo`
  本体逐一比对——Game 侧排除清单一变，这里立刻红。
- 「核心不变量」：390 层湖泊阶段完成态全连通（闸门合同的普适断言）。
- 「决定性」：同种子两次生成，地形指纹 + 深水格数逐一一致。
- 「端到端」：10 种子坏层集合恰等于已知机器缺陷集（集合相等断言，
  失败消息写明何时该更新成什么）。

---

## 六、反向验证（3 条，全部真实改坏 → 跑红 → 还原；`grep "临时改坏" src/` 无残留）

**RV1：把闸门短路（`const gated = false`）** —— 核心不变量红（节选）：

```
× 核心不变量：15 种子 × D1-D26 湖泊阶段完成态全连通（湖泊闸门合同）
AssertionError: 湖泊阶段完成态存在不连通层（闸门合同被破坏）：
seed424242/D5: 干地 351 中仅 345 格连通
seed424242/D13: 干地 513 中仅 6 格连通
seed424242/D24: 干地 320 中仅 13 格连通
seed777/D6: 干地 333 中仅 56 格连通
…（共数十层）
```

同轮「端到端」用例亦红（坏层集合偏离已知机器集）。

**RV2：耗尽后硬塞最后一个候选位（而非跳过）** —— AD2 红（节选）：

```
× 对抗 AD2：每次放置都破坏连通时，20 次尝试耗尽必须放弃该湖（不硬塞）
AssertionError: 闸门在 20 次尝试全拒绝后仍返回 true = 硬塞
: expected true to be false // Object.is equality
```

同时「核心不变量」红——390 层中真实存在 1 次耗尽（skipped=1），
硬塞那个湖直接破坏该层连通。

**RV3：判据换成 isPassable 标度（深水视为可通行）** —— 三条联动红（节选）：

```
× 对抗 AD3：判据是 canMoveTo 口径——预存深水桥不算干地
AssertionError: 深水桥不能算干地：盖住 P 会切断 B、C，必须拒绝
: expected false to be true // Object.is equality

× 判据口径钉死：terrainAllowsMove 与 Game.canMoveTo 对全部 TerrainType 逐一一致
AssertionError: terrainAllowsMove 与 Game.canMoveTo 口径漂移（…）

× 端到端 10 种子 × D1-D26：坏层集合恰为已知机器阶段缺陷集（湖泊致坏层=0）
```

值得记录的现象：RV3 下「核心不变量」**仍绿**——该测试与闸门共用同一个
判据函数，错判据是"自洽"的。这正是深水 isPassable 隐形坑的本质
（phase_c §四 的自我纠错），所以口径必须靠与 `Game.canMoveTo` 的**交叉**
比对（口径钉死用例）和显式水桥场景（AD3）来钉，单一不变量不够。

---

## 七、P1-26 断言交接轨迹（任务书验收 1）

按 P1-26 报告 §八 的交接说明执行：

1. 修复前：`上楼梯能走到下楼梯——已知 bug P1-29 留痕…` 绿（恰好 11）。
2. 改 `KNOWN_UNREACHABLE_STAIRS_LEVELS` 11 → 0、断言名去"已知 bug"字样、
   失败消息改写（指向机器阶段缺陷与本报告）。该文件 diff 仅此授权范围
   （35 行，其余 4 条不变量逐字未动）。
3. 修复后实跑：**red，`expected 1 to be +0`**——这 1 层就是 seed777/D15
   （机器锁门，§〇.1）。**湖泊造成的 11 层全部已修复**；这条红是第二个
   bug 的主追踪器在履行职责，机器缺陷修复后自然翻绿。

门禁因此为"除 `generation_baseline` 与 p1_26 这一条外全绿"，两项红都有
明确归属，见 §八。

---

## 八、门禁输出尾部

**关于红项的明确声明**：`npm test` 共 49 文件，**47 文件全绿**；
2 个失败文件均非"静默掩盖"，逐一说明如下——

1. `src/test/generation_baseline.test.ts`（1 用例）：**预期内红**。
   闸门换位重试移动 RNG 流，同种子地图按设计改变（本轮修的就是地图）。
   按任务书**未刷新 fixture**，由验收方授权重捕获。
   失败样例（节选）：`seed424242 D3 fp: 基线=94267331:4720 现在=7dd16dd9:4721`。
2. `src/test/p1_26_invariants.test.ts` 的「上楼梯能走到下楼梯（严格 0）」
   1 用例：见 §七——**第二个 bug 的主追踪器**，非本轮回归。

`npm test` 尾部：

```
 Test Files  2 failed | 47 passed (49)
      Tests  2 failed | 498 passed | 8 skipped | 5 todo (513)
   Start at  14:11:57
   Duration  20.83s (transform 1.87s, setup 0ms, import 6.26s, tests 90.14s, environment 11ms)
```

除上述 2 条外全绿：新增 8 条（p1_29_lake_connectivity 7 + adversarial_gate 1）
全绿；既有 485 条不变（含 p1_26 其余 4 条、P4-x 全系、p2_* 等）。

`npm run build` 尾部（绿）：

```
dist/assets/WebGLRenderer-Bw6uA6vm.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-BI434xf9.js               936.21 kB │ gzip: 295.32 kB
(!) Some chunks are larger than 500 kB after minification. Consider:
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.41s
```

（chunk 体积警告为既有现象；vue-tsc 通过。）

`git diff --stat`（已跟踪文件；新增 3 文件未跟踪：Connectivity.ts 约 100 行、
p1_29_lake_connectivity.test.ts 约 330 行、p1_29_adversarial_gate.test.ts 约 90 行）：

```
 brogue-web/src/engine/Generator/Architect.ts   | 78 +++++++++++++++++++++-
 brogue-web/src/test/p1_26_invariants.test.ts   | 37 ++++++-------
 2 files changed, 94 insertions(+), 21 deletions(-)
```

`git status --short`（调试探针已全部删除）：

```
 M src/engine/Generator/Architect.ts
 M src/test/p1_26_invariants.test.ts
?? src/engine/Map/Connectivity.ts
?? src/test/p1_29_adversarial_gate.test.ts
?? src/test/p1_29_lake_connectivity.test.ts
```

无任何 git 写操作；改动全部留在工作区。

---

## 九、验收条款逐条对照

| 任务书要求 | 状态 |
|---|---|
| 1. 给湖泊放置加连通性验证：切断就换位重试，耗尽就跳过（CE 语义） | ✅ `placeGatedLakeBlob`：20 次尝试（CE 2659 照搬）、假想放置 + 泛洪验证（CE 2588 语义）、耗尽跳过；skipped=0（端到端） |
| 2. P1-26 常量改 0、去"已知 bug"字样、让它真的绿 | ⚠️ 部分：改 0 与改名 ✅；"绿"未达成——红 1 层为**机器阶段独立缺陷**（§〇.1，边界外只列不修）。湖泊造成的 11 层已全部修复且有普适断言（390 层湖泊阶段全连通）兜底 |
| 3. 重试次数/尺寸循环照 CE | ✅ 20 次照搬；尺寸循环属方案 (a) 保留 web 对应物（§一，任务书明示许可） |
| 扩大取样 ≥10 种子 × D1-D26 零不可达 + 汇总 | ⚠️ 10 种子已跑、汇总在 §四；湖泊致不可达=0，端到端残留 2 层（机器阶段），集合钉死 |
| 对抗性测试 ≥3 条（短路/硬塞/isPassable） | ✅ AD1（43/130 回升）、AD2（+正控）、AD3（+对照），各对应具体错误实现 |
| 反向验证 ≥2 条真实失败输出 | ✅ RV1/RV2/RV3 三条，真实输出见 §六，已还原无残留 |
| 决定性测试锁住 | ✅ 同种子两次生成指纹+深水格数逐一一致；p1_26 决定性断言亦绿 |
| 不靠少放湖蒙混：前后水格对比 + 跳过频率 | ✅ §3.2：深水 −45% 的机理解释（闸门偏好小覆盖位 + RNG 流重排），placed=258/skipped=0 证明非弃放；浅水 +1.8% 对照 |
| 报告含方案理由/CE 对照/前后对比/复验汇总/对抗映射/RV 输出/基线红情况 | ✅ §一/§二/§三/§四/§五/§六/§八 |
| 与预设不符之处单列开头 | ✅ §〇（机器阶段第二个 bug + 全部事实核对） |
| 边界：只动允许清单；禁改文件未动；无 git 写操作；无仓库内临时文件 | ✅ 见 §八 git status；Game.ts / data/*.json / fixtures / Random.ts / 其它既有测试零改动；探针已删 |

## 十、给验收方与下一轮的建议

1. **generation_baseline 重捕获**：待授权（本轮未动 fixture）。
2. **机器阶段连通性缺陷**（777/D15 锁门割点、999/D12 特征水深水）建议
   单开一轮：`findSuitableRoom` 的"任意 BFS 块当房间 + 边界贴墙格当门"
   需要 CE 的 doorSite 语义；机器特征水深水应过同一闸门。若 C-0（addLoops）
   先落地，树变网后该缺陷的暴露频率也会下降，但缺陷本身仍在。
3. p1_26 的严格 0 断言维持红色追踪上述缺陷；机器修复落地后它会自然翻绿
   （届时不需改任何期望值）。
