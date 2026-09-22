# V-2b-9e-1 补完轮报告

## 0. 验收边界

这是任务书 §7 漏列的三个观测测试的补完。上一轮执行的 27 个文件正是当时点名的全部，最终复跑声明与 SHA-256 自证成立，不撤回、不归因为漏跑。生成流移动后必须复跑对生成结果取样的观测测试，与是否直接修改地形/DF 数据无关。

本轮从既有工作树继续。入场保存 632 个文件的 SHA-256；上一轮已有的引擎、测试、滚动基线与报告改动均保留。原样复现结果为 **3 文件、61 用例：58 通过、3 失败**，失败与任务书一致。

## 1. 三条成因复核与处置

### 1.1 c_4b F3：合法叠层；驳回“首个失败由 CE61 草长在浅水上造成”

只读核对 `BrogueCE-master/src/brogue/Globals.c`、`Architect.c` 与 `src/variants/GlobalsBrogue.c`，并在隔离副本中记录 `Grid.setTerrainLayer` 的前后四层值、调用栈与当前蓝图：

- 首个失败是 seed424242 / D1 / `(16,16)`，`ce_60_idyll` 先将 `[FLOOR, NOTHING, NOTHING, NOTHING]` 写成草，再写成 `[FLOOR, WATER_SHALLOW, NOTHING, GRASS]`。不是 CE61。
- 同层 `(23,16)` 先草、再 FOLIAGE、后浅水；`(31,10)` 是 CE58 血草茎随后叠 CE60 浅水。CE58 的草也可被后来 CE60 的水边覆盖。
- `DF_GRASS`（Globals.c:609）字段为 `GRASS / SURFACE / 75 / 5 / DFF_BLOCKED_BY_OTHER_LAYERS`，省略的 `propagationTerrain` 为 0。没有基底限制不等于必能落格：GRASS 的 drawPriority=60（:447），SHALLOW_WATER=55（:414），Architect.c:3232 要求旧最高优先级数值 >= 新数值，55>=60 不成立，**先有浅水时不能再由该 DF 铺草**。
- **先草、后浅水的最终组合合法**：CE60 的 feature 顺序是草/树在前、水塘在后（GlobalsBrogue.c:566-569）；深水池的后继浅水 DF（Globals.c:899-900）只写 LIQUID，浅水 DF 不带清其他层或跨层优先级旗标。深水本体有 CLEAR_OTHER_TERRAIN，但不等于后继浅水边缘也清层。
- CE60 的 BP_NO_INTERIOR_FLAG 使 machineNumber=0 合法；`(28,12)` 实测为 `[NOTHING, WATER_SHALLOW, NOTHING, GRASS]`。原来的“无机器号则拒绝”前提不适用于它。

首个断言会遮住后续失败。完整扫描原有四个 seed/depth 组合后，还观察到 CE58/61、Goblin warren 和 CE34 的合法形态，因此不止向原 LIQUID 列加一个值。新增白名单按 **完整四层元组** 匹配，下表穷举全部 **17 项**（`∅` 为 NOTHING；GAS 一列全部为 ∅）：

| DUNGEON | LIQUID | SURFACE | CE 依据 |
|---|---|---|---|
| FLOOR | WATER_SHALLOW | GRASS | CE60 先草后水 |
| FLOOR | WATER_SHALLOW | FOLIAGE | CE60 先树后水 |
| ∅ | WATER_SHALLOW | GRASS | CE60 浅水覆盖既有草，保留空 DUNGEON |
| FLOOR | WATER_SHALLOW | ∅ | CE60/61 浅水只写 LIQUID |
| FLOOR | ∅ | BLOODFLOWER_STALK | CE58 的 SURFACE feature，GlobalsBrogue.c:559 |
| FLOOR | WATER_SHALLOW | BLOODFLOWER_STALK | CE58 后叠 CE60 浅水 |
| FLOOR | MUD | GRASS | CE61 泥后铺，Globals.c:905 |
| FLOOR | MUD | GRAY_FUNGUS | CE61 DF_SWAMP 链，Globals.c:904-905 |
| FLOOR | WATER_SHALLOW | GRAY_FUNGUS | CE61 后继浅水，Globals.c:903 |
| ∅ | MUD | FOLIAGE | CE61 泥保留既有 SURFACE |
| FLOOR | MUD | ∅ | CE61 泥只写 LIQUID |
| DOOR | MUD | ∅ | CE61 泥无跨层优先级门；LIQUID 写入不受 SURFACE 禁止门限制 |
| MUD_FLOOR | ∅ | GRASS | Goblin warren，GlobalsBrogue.c:266/273；DF_HAY 在 web 由 GRASS 承载 |
| FLOOR_FLOODABLE | ∅ | GRASS | CE34 的 DUNGEON feature，GlobalsBrogue.c:396 |
| FLOOR_FLOODABLE | ∅ | WEB | 同上，保留已有 SURFACE |
| FLOOR_FLOODABLE | MACHINE_COLLAPSE_EDGE_DORMANT | ∅ | CE34 feature + Globals.c:837 的 LIQUID DF |
| FLOOR_FLOODABLE | MACHINE_COLLAPSE_EDGE_DORMANT | GRASS | 同上，保留草层 |

CE61 的 DF_SWAMP / DF_SWAMP_MUD / DF_SWAMP_WATER 均 flags=0，分别只改 SURFACE / LIQUID / LIQUID；这里支持其真实贡献，但不能用其总台数增长解释 CE60 的首个失败。Goblin warren 的 HAY→GRASS 为既有映射，本轮未改目录。CE34 的 FLOOR_FLOODABLE **确实写 DUNGEON**，不能与 CE31 写 LIQUID 的形态混淆。

三层上限与逐格 GAS 恒空不变；CE58 血草茎、CE34、Goblin warren 的新增组合仍要求正机器号。其余组合继续走原守卫，未把各列独立扩成任意组合。还纠正原注释“DF_GRASS 不带 BLOCKED_BY_OTHER_LAYERS”的错误。反向校验：隔离副本将 `(31,24)` 的 `[FLOOR,MUD,NOTHING,GRASS]` 改为未授权的 `[FLOOR,MUD,NOTHING,BLOODFLOWER_STALK]`，F3 失败；已有的草/血草成员不能随意互换。

### 1.2 c_5：同意固定增量随生成流顺延

seed20260917 的同一路径实测 **16214**，将 `.toBe(10401)` 顺延为 `.toBe(16214)`，补上 V-2b-8 与 V-2b-9e-1 两行沿革，说明区域机器路由使已验收同样本机器数 469→823。没有改 seed、动作、范围或比较方式；469→823 沿用上一轮已验收 census，本轮不重新生成基线。

额外调用边界探针测得：坠落动作内 `generateDepth` 一次，消耗 **16211**；动作完整增量 **16214**；`objectiveTimeBlock` 调用 **0 次**；rat 最终仍在 `(4,4)`。因此严格地说，旧注释“一层固定生成账”是对整体坠落动作的简称，不是 `generateDepth` 单函数的全部精确计数。原深度、怪物位置/存活、玩家受伤断言继续保留并通过。

### 1.3 g_2：驳回“舞台外泥格也在产气”的本次成因

旧 openRoom 确实只清一角，覆盖确实全局生效，totalVolume 确实扫全图；但这些代码事实不足以证明本次失败的来源。对**未修改的原用例**实测：

| 时点 | 全图体积 | 证据 |
|---|---:|---|
| 晋升前 | 0 | 全图 MUD 只有 `(8,8)` 一格，无舞台外泥格 |
| 晋升后、第一次扩散前 | 2 | 一次 LIQUID 晋升，gasVolumeAdded=2 |
| 第一次扩散后 | 3 | `(7,8)`、`(7,9)`、`(9,7)` 各 1 |
| 第二次扩散后 | 3 | `(6,7)`、`(6,8)`、`(8,7)` 各 1，均在原舞台内 |

CE Time.c:1423-1426 与 web Gas.ts 都逐格进行整数除法加独立随机舍入。2 体积进入九格邻域，每格按余数独立决定是否加 1；**期望值守恒不保证单次总量 ≤2**，也可能增加，旧注释只考虑随机舍入到 0 的方向并不完整。小体积的 GAS 类型可仍为 NOTHING，但 volume 保留，亦符合 CE :1427-1436，不能把这些 volume 从统计里删掉。生成流移动改变了进入此处的 RNG 状态；本次并非额外气源，也不构成偏离 CE 的扩散缺陷。仅把测量缩回原房间仍会测到 3。

处置采用**全图清场 + 封闭两格气室**：

1. openRoom 按 grid.width×grid.height 清所有层，同时清 `volume` 并同步空镜像，避免日后生成气源污染全图观测；`setTerrain` 本身不清 volume。
2. 在 `(8,8)` 泥格与 `(9,8)` 地板周围连斜角全部封墙。两格互为唯一可通气邻居，2/2=1 无余数，两次真实扩散后为 `[1,1]`。保持原 seed、真实 objectiveTimeBlock、晋升、扩散和镜像路径，不模拟扩散结果。
3. 保留 **`.toBeLessThanOrEqual(2)`**，继续统计全图；补晋升前总量 0、恰一次目标晋升，以及最终两格 `[1,1]` 的断言，拒绝空跑或丢气。MUD.promoteChance 仍在 finally 中还原。

这既修正了本次随机舍入舞台，也消除了原清场范围与测量范围不一致的隐患；不靠换种子找一个偶然 ≤2 的样本。

## 2. 气体反向验证

在 `/private/tmp/v-2b-9e-1-finish-probe` 隔离副本中，对 `EnvironmentManager.updateGases` 的末尾（写回之后、syncGasMirror 之前）临时注入：

```ts
grid.getCell(8, 8)!.volume += 1;
```

这是真实增加真相体积且随后正常同步镜像的错误实现，DF 的 gasVolumeAdded 仍为 2。运行修改后的原“泥格晋升命中后”用例，**1 failed**，失败恰在原上限断言：

```text
2 体积扩散后不得凭空增加: expected 3 to be less than or equal to 2
```

还原临时 Gas.ts 后，同一用例通过。没有将错误实现写入主工作树。F3 的独立未列入白名单元组反向校验也失败，见 §1.1。诊断与反向验证的定向运行包含未选择用例，不冒充最终完整文件门禁。

## 3. 最终门禁、基线与 SHA-256

**这是最终状态下的运行结果，不是中途快照。**

全部源码、测试、fixture 与配置编辑冻结后，于 **2026-09-22 20:27:14—20:27:43（Asia/Shanghai）** 顺序独立复跑任务书 §6 全部命令：

```sh
npx vitest run src/test/c_4b_dungeon_feature.test.ts src/test/c_5_fall_subsystem.test.ts src/test/g_2_gas_df_wiring.test.ts --reporter=json --outputFile=/tmp/v-2b-9e-1-finish.final-tests.json
npm run test:drift
npm run build
```

| 最终门禁 | 结果 | 耗时 |
|---|---|---:|
| c_4b_dungeon_feature.test.ts | 31 passed / 0 failed / 0 skipped | 1.308s |
| c_5_fall_subsystem.test.ts | 13 passed / 0 failed / 0 skipped | 12.059s |
| g_2_gas_df_wiring.test.ts | 17 passed / 0 failed / 0 skipped | 0.946s |
| 上述三文件合计 | **61 passed / 0 failed / 0 skipped**，退出 0 | 命令 12.954s |
| npm run test:drift | **1 passed**，退出 0 | Vitest 11.83s |
| npm run build | vue-tsc 与 Vite 均成功，退出 0 | 命令 3.995s |

构建仅有已有的大 chunk 提示。文件耗时来自 Vitest JSON，三文件并行执行，不能相加为命令耗时。未运行无参数全量 vitest。

**确未重捕获 generation_baseline.json**。入场与最终的每个基线字节相同，test:drift 使用原 fixture 通过。入场全树 manifest 对比只发现指定三个测试文件变化和本报告新增；其他上一轮产物逐文件未变。

SHA-256 自证：最终复跑前后，对 `src/` 全部文件（含测试、fixture）、package/lockfile、Vite 配置与三份 tsconfig 共 **189 文件**逐个取 SHA-256；CE 共 **115 文件**另取清单。两组前后 manifest 完全相等，CE 逐文件也与入场完全相等。总摘要算法：键为**仓库相对路径**，按键排序、UTF-8、`ensure_ascii=False`、无多余空白的 `{path: sha256}` JSON 再做 SHA-256。CE 路径包含 `BrogueCE-master/` 前缀，与上一轮短路径摘要口径不同，逐文件内容未变。

| 范围/文件 | 最终 SHA-256（前后相同） |
|---|---|
| 189 文件输入清单 | `9b660475c6bcdd79531e59f43e139f86e9d576cff0957bafee1996520cf5b75e` |
| 115 文件 CE 清单 | `fb546b9f559f7809a4209f0d39ffd066ac26d42ccde7cba1ba47cca5f3389617` |
| src/test/c_4b_dungeon_feature.test.ts | `9f374f1644d33e9a5fb923ee6c9aa06a29eab6225aeb22168d1dfb9e60ae8de5` |
| src/test/c_5_fall_subsystem.test.ts | `501718d03244bbc46c3ee1efe6aec89eabd76fd2e66f796cccae11fba52aef5e` |
| src/test/g_2_gas_df_wiring.test.ts | `bc5d6e35ae164a7c57a87e30a4dc9fb5aa29045f316197a26588c0c54d5d2c63` |
| src/test/fixtures/generation_baseline.json | `b57c60a9ffb626a4840836666b15d8efc12b7540a631c5c08887e7c8d1093252` |
| src/data/blueprints.json | `1629c2e0ad2d38254456629731111e9696ae2d82be787e88b8a54f2180bf5a61` |

最终证据均在 `/private/tmp/`：`v-2b-9e-1-finish.final.py`（完整命令/摘要算法）、`.final-before.json`、`.final-after.json`、`.final-summary.json`、`.final-tests.json`、`.final-tests.log`、`.final-drift.log`、`.final-build.log`、`.scope.json`。初次从父目录启动脚本时 npx 在测试前异常退出，日志为 `SecItemCopyMatching failed -50`，记录另存 `.startup-failed-*`，不作为测试结果；从项目目录启动上述最终复跑成功，期间没有修改测试或生产代码。

最终复跑结束后只回填本报告，没有继续编辑源码、测试、fixture 或配置。


## 4. 改动申报与既存问题

本轮持久改动限于任务书 §5 的三个测试文件，以及 §7 明确要求的本报告。**无清单外持久改动**。未改任何生产代码、blueprints.json、generation_baseline.json 或 CE；未新增蓝图、解锁 65/66、补 CE8 或改变区域生长实现。隔离探针、错误变体、manifest、命令脚本和日志只保存在 `/private/tmp/v-2b-9e-1-finish*`。

继续登记、未修：既存领养携带品可能同时进入 itemSpawns 与 carriedItem，随后被分别实化成地面物品与携带品。维持上一轮报告的范围与结论，本轮没有混入去重修复。

证据文件（`/private/tmp/`）：`v-2b-9e-1-finish.initial.json`、`.layers.json`、`.gas.json`、`.fall.json`、`.mutation.json`、`.restore.log`、`.extra-probe.json`。原始探针保存在隔离副本 `src/test/finish_probe.test.ts`；主工作树最终状态由 §3 最终命令与前后哈希证明。
