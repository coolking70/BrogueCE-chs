# C-8 结案报告：`generateTerrain` 连通性漏洞（生成期 DF 放置否决缺 web 移动图口径）

- 分支：`round/c-8`（= main + docs，工作区改动，未 commit）
- 改动面：`src/engine/Map/DungeonFeature.ts`（+138/−1）、新增 `src/test/c_8_connectivity.test.ts`
- 结论速览：**切断点确实在 `generateTerrain` 的调用跨度内，但不在任务书猜测的
  carve / 加环 / 湖泊 / finishWalls 任何一步，而在 `designEnvironmentOvelays` 的
  `runAutogenerators(false)`（C-6 接线的自动生成器趟）**：`DF_CRYSTAL_WALL`
  （autoGenerator 表 index 1）的传播足迹把可走格改成水晶墙、切断已连通的关卡。
  web 的连通性否决**存在**且结构与 CE 一致，缺的不是某个否决调用点，
  而是**否决判据的通行口径**：CE 判据（`cellIsPassableOrDoor`）把 CHASM/LAVA/TRAP
  算阻挡，在它自己的图上"远侧本是孤岛、不贴带、不成 zone"，于是放行真实切断。
  修复 = 在 `spawnDungeonFeature` 的 blocking 否决处**并列加严**一个
  web 移动图同形判据 `levelIsDisconnectedOnMovementGraph`，纯泛洪、零 RNG。

---

## 一、对任务书的反驳

1. **「切断点在 generateTerrain 内部（carve / 加环 / 湖泊 / finishWalls 一带）」
   ——半对半错。** 广义上对：V-1a 执行方的快照结论（generateTerrain 返回点
   连通块已裂开）**成立**，独立复核确认（见 §二阶段表，F2 阶段即裂）。
   狭义上错：任务书列的四个嫌疑阶段全部无罪——阶段表显示 carve（A）、
   addLoops（B）、finishWalls(false)（C）、overlays（E）、fillLakes（F，
   **P1-29 闸门守住了**）、removeDiagonalOpenings（G）、cleanUpLakeBoundaries（H）、
   buildABridge（I）全程单连通块；裂开发生在 **F2 = `runAutogenerators(false)`**
   （CE digDungeon 第 7 步，Architect.c:2933），随后所有阶段维持两块直到
   populateLevel。生成器的湖泊闸门、墙门收尾、对角消除都没有问题。

2. **「web 对应的步骤有没有做（否决）、差在哪」——任务书预设"web 缺了某个
   否决"。实际是否决在、判据的图错了。** `spawnDungeonFeature` 里的 blocking
   否决（CE :3377-3381 的逐字移植）一直在跑：seed12/D25 的 5 次水晶墙放置里
   3 次被它正确拦下（dis=1）。漏掉的 2 次是 CE 判据的**通行口径盲区**：
   `levelIsDisconnectedWithBlockingMap` 的相位 1 只给"贴带的可通行格"成区，
   而 CHASM（D25 层有 19 格）在 `cellIsPassableOrDoor` 口径下是阻挡——被切断的
   远侧在 CE 图里**本来就与带隔着深渊、不贴带、拿不到 zone 标号**，相位 3
   自然无相触，返回 0（放行）。在同一网格上用 web 移动图口径（canMoveTo ∪
   SECRET_DOOR，8 向）复算：放置前单连通块 808 格 → 放置后 436/367 两块。
   所以修复方向仍是任务书裁决的"补否决"而不是自创事后修补器——补的是
   **判据口径**，结构与 CE 三相位逐一同形，先例是 P1-29（4 向 CE 判据 →
   8 向 web 移动图）。

3. **V-1a 的数字不能直接采信，但机制结论可以。** 23 格 / 996+23 的具体数字
   出自 v-1a 的流位置，本轮分支上同 seed 同层是 436/367——同一种子机制
   （水晶墙足迹封咽喉），不同流位置不同布局。本报告全部引用本分支实测。

4. **任务书 §1 的"四条闸门都在报红"在本分支不成立。** `round/c-8` = main 代码，
   四条闸门在本分支当前全绿（坏层没落在它们的 seed 集里）；c_3 T12 的
   SWEEP_SEEDS（15 个）不含 seed 12，而全量扫描显示坏层恰在 seed 12/D25。
   这正是任务书 §1.1 自己指出的"坏层=0 是运气"——本轮实测坐实了它，
   且 c_8 的 T2 把闸门覆盖从 15 seed 扩到 30 seed。

## 二、诊断数据

### 2.1 复现样本与阶段表（本分支、修复前，seed 12 / D25）

用 seed 1..30 扫描（c_3 T12 同口径：canMoveTo ∪ SECRET_DOOR，8 向）找到本分支
真实坏层 **seed12/D25**，在 `Architect.generateTerrain / generateLevel` 各阶段
之间挂连通性快照（临时埋点，结案前已剥离，`git diff` 复核为零残留）：

| 阶段 | 可走格 | 连通块 |
|---|---|---|
| A_carve（carveDungeon+落位） | 820 | **1** |
| B_loops（addLoops+门位落位） | 822 | 1 |
| C_finishWalls5 | 822 | 1 |
| E_overlays（可踏入叠加层） | 822 | 1 |
| F_fillLakes（**P1-29 闸门后**） | 808 | **1** |
| **F2_autogenNM（runAutogenerators(false)）** | **796** | **2 [436, 360]** |
| G_diagOpen / H_cleanup / I_bridge / D_terrainEnd | 796 | 2 |
| J_traps / K_machines / L_autogenM / M_finishDoors / N_levelEnd | 798 | 2（小机器格内域） |

终态：上行梯 (34,5)、下行梯 (54,20) 分居两块，up 可达 361 格 → 卡死局。

### 2.2 F2 内部：5 次 DF_CRYSTAL_WALL 放置的逐次审计

在 `spawnDungeonFeature` 的否决判定处挂临时探针（已剥离）：

| 放置种子格 | 足迹构成 | CE 判据 | web 移动图口径 | 结果（修复前） |
|---|---|---|---|---|
| (38,9) | 草×1 地板×2 浅水×2 深水×1 墙×1（7 格） | dis=0 放行 | **436/367 两块** | 落地 → **切断关卡** |
| (13,4) | 网×7 墙×1（8 格） | dis=0 放行 | （在已被切的图上 436/360） | 落地 |
| (18,24) | 地板×12 门×1 墙×1 等（16 格） | dis=1 | （若建则 436/320/25） | 被否决 ✓ |
| (26,7) | 地板×14 墙×1 等（16 格） | dis=1 | （若建则 436/291/54） | 被否决 ✓ |
| (36,20) | 网×7 墙×1 等（9 格） | dis=1 | （若建则 360/343/85） | 被否决 ✓ |

修复后同层同阶段：F2 = 801 格单连通块（(38,9) 被新判据拦下，
CRYSTAL_WALL 15→8；(13,4) 的网带无害、照常放行），终态上下行梯互相可达
（up 可达 712 格，其余连通块均为机器格内域）。

### 2.3 广度测量

| 口径 | 样本 | 坏层 | 发生率 |
|---|---|---|---|
| 修复前，c_3 T12 的 15 seed × D1-D26 = 390 层 | main 流位置 | 0 | 0（运气） |
| 修复前，30 seed × D1-D26 = 780 层（D26 无下行梯，坏层口径适用 754 层） | 本轮扫描 | **1**（seed12/D25） | **≈ 1/754 ≈ 0.13%** |
| 修复后，120 seed × D1-D26 = 3120 层（有效口径 3000 层） | 本轮复扫 | **0** | 0 |

（v-1a 分支 15 seed × D1-D26 抓到 1 层，与本轮 30-seed 抓到 1 层同量级；
修复后 3000 层零坏层。）

## 三、与 CE 的对照

`levelIsDisconnectedWithBlockingMap`（Architect.c:3137-3198，通行判据
`cellIsPassableOrDoor` :48-55）在 CE 生成期共五类否决点，全部逐字核对：

| CE 调用点 | 语义 | web 对应 | 状态 |
|---|---|---|---|
| :724（机器蓝图资格，BP_TREAT/REQUIRE_BLOCKING） | 机器内部图否决 | web 机器走自造 BlueprintEngine，不同源（历轮登记） | 不适用 |
| :1197（addMachines 同上） | 同上 | 同上 | 不适用 |
| :1451（机器特征 tile，MF_* 旗标 + T_PATHING_BLOCKER，单格） | 机器 tile 否决 | 同上 | 不适用 |
| :1823（runAutogenerators 的 **terrain 直铺分支**：drawPriority 门槛 + 单格否决） | 自动生成器地形否决 | AutoGenerator.ts:711-718 逐字移植（T-1 重核） | **在，但带同样的口径盲区**（见 §七.1——本分支上双重不可达） |
| :3377-3381 + :3397（spawnDungeonFeature 的 blocking 条件与放行判断） | **DF 足迹否决（本轮出事点）** | DungeonFeature.ts spawnDungeonFeature | **否决在、判据口径错** → 本轮修复 |
| （湖泊：designLakes 的放置否决，Architect.c:2588 lakeDisruptsPassability） | 湖泊选址否决 | P1-29 已移植且口径正确（8 向 canMoveTo） | 一直是对的（阶段表 F 站住） |

**差在哪**：CE 的判据在「cellIsPassableOrDoor 图」（CHASM/LAVA/TRAP = 阻挡）
上评估；web 的移动图（canMoveTo ∪ SECRET_DOOR，8 向）里 CHASM/LAVA 可走
（P1-25/P1-28 的既有裁决）。凡 DF 足迹与深渊/岩浆合围出的切断，CE 判据
结构性看不见（远侧不贴带 → 不成 zone → 无相触）。这不是移植走样——
CE 判据忠实还原了，是**两套图不一致**；P1-29 给湖泊闸门做过的同一个
口径裁决（4 向 CE → 8 向 web 移动图），本轮补齐到 DF 放置否决上。

## 四、修复方案与 RNG 消耗

**改动**（`src/engine/Map/DungeonFeature.ts`，+138/−1）：

1. 新增 `levelIsDisconnectedOnMovementGraph(grid, blockingMap): boolean`——
   CE 三相位（贴带成区 / 漫带 / 相触，:3149-3197）的同形移植，两处差异
   （P1-29 先例）：通行判据 = `terrainAllowsMove ∪ SECRET_DOOR`；
   分区/漫带/相触全 8 向。
2. `spawnDungeonFeature` 的 blocking 放行条件改为两查并列加严：
   CE 判据 = 0 **且** 移动图判据 = false 才放行。

**零 RNG 消耗论证**（§2.3 的硬约束，做到了）：

- 两个判据都是纯泛洪，判定本身不掷骰；
- 否决路径不多掷、不少掷：`spawnMapDF` 的扩散掷骰发生在判定**之前**，
  否决只是不落格、不算成功，后续无补掷/重试；`fillSpawnMap`、
  DFF_CLEAR_* 清理、（CRYSTAL_WALL 无）subsequentDF 全都无骰；
- 因此 **RNG 流逐位不变**：未发生切断的层上，修复前后网格逐格一致
  （放行行为不变）；发生切断的层上只有"是否落这十几格"的差别，
  这类层修复前本来就是坏层；
- **实测**：`generation_baseline`（4 seed × D26 地形指纹/怪物/物品）全量门禁
  通过、零重捕获；`rng.randomNumbersGenerated` 增量哨兵钉在 c_8 T4
  （否决与放行两条路径掷骰增量均 = 0）。

**对 V-1a 的含义**：可直接合并，基线无需重捕获。唯一注意项——V-1a 的
量级复测数字（附魔 25.9→14.9 等）是带着本 bug 测的；合并后只有发生过
切断的层（≈0.1% 量级）的物品落点会变（牌堆变长），统计量级不受影响，
建议合并后重跑一遍其复测确认即可。

## 五、改动清单

```
 src/engine/Map/DungeonFeature.ts       | 138 ++++++++++++++
 src/test/c_8_connectivity.test.ts      | 336 +++++++++++++（新增，7 用例）
 2 files changed
```

- `git diff --stat`（最终，含新增文件则加 `--stat` 不可见的新文件两行）：
```
 brogue-web/src/engine/Map/DungeonFeature.ts  | 139 +++++++++++++++-
 1 file changed, 138 insertions(+), 1 deletion(-)
未跟踪新文件：
 ai_docs/C-8_report.md            （本报告）
 src/test/c_8_connectivity.test.ts（297 行，7 用例）
```
- 诊断期临时埋点（Architect.c8diag 快照、spawnDungeonFeature 探针、
  `src/test/zz_c8_diag.test.ts` 扫描脚本）**全部剥离**，
  `git diff` 与 `grep -rn "C8DIAG\|REVERT-ME" src/` 复核为零；
  `src/engine/Generator/Architect.ts` 恢复与 HEAD 逐字节一致（diff 为空）。

## 六、对抗性测试与反向验证

c_8_connectivity.test.ts（7 用例）与被捕获的错误实现一一对应：

| 用例 | 断言 | 被捕获的错误实现 |
|---|---|---|
| T1 复现回归 | seed12/D25 上下行梯互达 + 非机器可走格单连通（T12 口径） | 任何重新引入切断的改动 |
| T2 广度断言 | 30 seed × D1-D25 坏层 = 0（区间来自修复前 1 坏/修复后 0 坏的实测） | 同上，覆盖面扩到闸门 15 seed 之外 |
| T3 机制断言（AD1） | 壕沟夹具：CE 判据=0、移动图判据=true、spawn 否决且不改格 | **只跑 CE 判据（= 修复前形态）** |
| T4 零消耗（AD5） | 否决/放行两条路径 `randomNumbersGenerated` 增量均 0 | 否决路径偷掷骰（重试/补偿） |
| T-AD2（AD2） | 水晶封密门 → 否决 | 移动图判据漏并 SECRET_DOOR |
| T-AD3（AD3） | 对角咽喉夹具 → 判切断、spawn 否决 | 分区/相触退化成 4 向 |
| T-AD4（AD4） | 贴带但未切断（墙格带）→ 照常放行并落格 | 一刀切否决（≥2 贴带区即拒） |

**反向验证（真实失败输出）**：把 `spawnDungeonFeature` 的放行条件临时回退为
只跑 CE 判据（修复前形态）后，`npx vitest run src/test/c_8_connectivity.test.ts`：

```
 ❯ src/test/c_8_connectivity.test.ts (7 tests | 4 failed) 68234ms
     × T1 复现样本回归：… 7406ms
     × T2 广度断言（区间来自修复前后实测）… 60822ms
     × T3 机制断言（AD1）：壕沟夹具… 2ms
     × T-AD3 方向数退化成 4 向：对角咽喉夹具… 0ms

AssertionError: seed12/D25 上行楼梯到不了下行楼梯（卡死局回归）：
  up=(34,5) down=(54,20) 可达=361: expected false to be true
AssertionError: seed12/D25 上/下行楼梯不互相可达（卡死局）：
  up=(34,5)→false down=(54,20)→false: expected false to be true
AssertionError: 切断壕沟的水晶墙必须被否决（否决只跑 CE 判据的实现在此翻红）:
  expected true to be false
```

回退版下 T1 报出的 up/down 坐标与可达格数（361）与诊断阶段表逐位一致；
T4/T-AD2/T-AD4 按设计保持绿（它们针对的是别的错误实现）。还原后 7/7 绿，
`grep -rn "REVERT-ME" src/` = 0、`grep -rn "C8DIAG" src/` = 0。

## 七、需要追加授权的测试

**无。** 清单外没有撞红。四段 grep 自查留档（任务书 §4）：

1. 主题 grep（`spawnDungeonFeature|levelIsDisconnected`）：生产侧命中
   Bolt/Game/Gas/AutoGenerator/DungeonFeature/DungeonFeatureCatalog/Promotion——
   本轮**零新增调用方**（spawnDungeonFeature 的调用面不变）；
2. 结构性穷举表（`DUNGEON_FEATURE_CATALOG|DF_MISSING_TILES`）：5 个测试文件，
   本轮**未增删任何目录条目**；
3. 公共目录标识符：同上，未触碰；
4. 扫描器形态（`.mechFlags|…`）：DungeonFeature.ts 本就在命中集里
   （既有读者），本轮**未新增形态**。

## 八、门禁结果

（完整输出尾部见本报告末尾附录；要点：）

- `npx vitest run --fileParallelism=false`（不带文件参数）：**全部通过**，
  含四条既有闸门（c_3 T12 / p1_26 / p1_29 / p1_33）全绿、
  `generation_baseline` 零漂移；
- `npm run build`（vue-tsc -b + vite build）：**通过**（遵照项目常识，未用
  `tsc --noEmit` 下结论）。

## 九、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| §2.1 阶段快照表钉死切断点 | ✅ §二.1（F2 = runAutogenerators(false)） |
| §2.1 广度测量 ≥30 seed × D1-D26 + 发生率 | ✅ 修复前 30 seed（1/754）；修复后 120 seed（0/3000） |
| §2.2 CE 对照（哪些步骤否决、web 缺哪个） | ✅ §三（五类调用点 + 判据口径差距） |
| §2.3 修复零 RNG 消耗、基线不变 | ✅ §四（论证 + 哨兵 + 基线门禁实测） |
| §3 禁改 BrogueCE-master / 物品生成 / 白名单放宽 | ✅ 未触碰；p1_29 的 KNOWN_MACHINE_STAGE_BAD_LEVELS 保持空集 |
| §4 文件边界 | ✅ 只改 DungeonFeature.ts + 新增 c_8 测试；Architect.ts 已还原为 HEAD 原样 |
| §5.1 复现样本回归 | ✅ c_8 T1 |
| §5.2 广度断言（区间来自实测） | ✅ c_8 T2 |
| §5.3 机制断言（不否决就切断的场景被拒） | ✅ c_8 T3 |
| §5.4 对抗 ≥3 + 反向验证贴真实输出 | ✅ §六（5 条对抗 + 回退版 4 翻红实录） |
| §6 门禁（全量单 worker + build，四闸门全绿） | ✅ §八 |

## 十、遗留与登记

1. **AutoGenerator.ts:711-718 的 terrain 直铺分支仍只有 CE 单判据**——本轮
   **有意不修**，双重结构性不可达：(a) index 33 是唯一 wired terrain 条目，
   `minDepth: 40`，web 最大深度 26；(b) 它的落点基座是 WALL，墙→水晶墙
   不改变可走性，该分支的连通性否决本就空转。**激活轮需重核**：未来若接
   任何「FLOOR 基座 + 阻挡 tile」的 terrain 条目，必须把放行条件同样扩成
   「CE 判据 ∧ levelIsDisconnectedOnMovementGraph」。
2. **「CHASM 可走」口径的既有限界**（非本轮造成，登记）：闸门口径
   （canMoveTo ∪ SECRET）把 CHASM/LAVA 算可走，而玩家踩上 CHASM 会坠落
   （C-5）。因此"闸门连通"强于"本层内真实可达"。这是 P1-25/28/29 的既定
   裁决，四条闸门与本轮修复都按该口径；若未来要把"坠层"算成阻断，
   属口径级变更，需另立轮次。
3. **机器阶段仍可切断非机器格连通**（p1_29 报告已登记的独立缺陷，
   BlueprintEngine 锁门/特征水深水不受 P1-29 闸门约束）——本轮阶段表里
   K_machines 之后的小连通块即机器内域，属设计内豁免；真坏层若将来
   出自机器阶段，修法应是把同类否决口径补进 BlueprintEngine 选址，不在
   本轮边界内。
4. **「挑 seed」现象的量化**：同一漏洞在 15-seed 闸门集上 0 命中、
   30-seed 集上 1 命中——坏层发生率 ≈0.13% 时，闸门 seed 集的"全绿"
   提供 1-(1-0.0013)^390 ≈ 40% 的漏检概率。c_8 T2 把覆盖扩到 30 seed
   也只是把漏检概率降到 ~26%；**结构性解法是本轮这种"生成期否决"**
   （每层每放置都判，与 seed 无关），测试覆盖只是辅助线。
5. **性能**：移动图判据只对 blocking DF 放置运行（现役每层 0-5 次水晶墙），
   每次 2-3 个全图泛洪；全量套件耗时无可测变化。

## 附录：门禁输出尾部

**`npx vitest run --fileParallelism=false`（不带文件参数，npm test 的单 worker
口径），完整输出尾部：**

```
 Test Files  87 passed (87)
      Tests  1110 passed | 8 skipped | 5 todo (1123)
 Start at  14:16:45
 Duration  1643.95s (transform 897ms, setup 0ms, import 11.33s, tests 1625.85s, environment 13ms)
```

- 四条既有闸门（c_3 T12 / p1_26 / p1_29 / p1_33）包含在 87 个全绿文件内；
- `generation_baseline`（4 seed × D26 地形指纹/怪物数/物种/物品数）全绿
  ——修复对基线零漂移的实测确认；
- c_8_connectivity.test.ts 7 用例全绿。

**`npm run build`（vue-tsc -b && vite build），完整输出尾部：**

```
dist/assets/BufferResource-CIeGOiHZ.js       10.60 kB │ gzip:   2.79 kB
dist/assets/webworkerAll-BCVQTlhR.js         11.88 kB │ gzip:   3.94 kB
dist/assets/CanvasRenderer-CoKDWGuS.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-KDZ9qpbl.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-7vQscYTj.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-DAUD5nHK.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-BTFgSrqP.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-D6j_BRrm.js               882.16 kB │ gzip: 265.78 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.46s
```

（chunk 体积警告为既有状况，与本轮无关；退出码 0。）
