# V-2b-3 补完轮（给新接手的执行方）

## 0. 你接手的是什么

这是一个 Brogue CE（C 语言 roguelike）到 TypeScript/Vue 的**高保真复刻**项目。工作模式是
**执行方 / 验收方分离**：你负责实现，另一方独立验收（跑独立门禁、抽验你报告里的每条声称、
回 CE 源码复核你的判断）。**报告里说"已完成"但实际没做的项，历史上被抓出来过。**

**第一件事：通读 `ai_docs/project_conventions.md`。** 它不是背景资料，是本轮的硬约束来源
（授权清单纪律、守卫处置规则、留痕反转惯例都在里面）。不读会踩坑。

### 本轮的前情

上一轮（V-2b-3，接 CE 的机器"通电"网络）跑到一半以 `unknown_error` 中断，**产物完好、
保留在 `round/v-2b-3` 分支的工作区**（未提交）。验收方逐项核过，**下面这些已经做完，
不要重做、不要"顺手重构"**：

| 已完成 | 位置 |
|---|---|
| `activateMachine`（CE `Time.c:1173-1228` 直译，含洗牌序） | `Promotion.ts:253` |
| `circuitBreakersPreventActivation`（CE `:1230-1242`） | `Promotion.ts:218` |
| wired 分支（原占位升格为真实通电，CE 三要点已注） | `Promotion.ts` |
| `IS_POWERED` 格标记 | `Grid.ts` |
| 9 个新 TerrainType + 目录条目 | `Grid.ts` / `TerrainCatalog.ts` / `DungeonFeatureCatalog.ts` |
| 六条 CE 蓝图（18/22/24/25/67/68），蓝图 27→33 | `blueprints.json` |
| `MF_REPEAT_UNTIL_NO_PROGRESS` 的 failsafe（上界 1000 + 显式抛错） | `BlueprintEngine.ts:1264` |
| `wiredBranchHit` 的留痕反转 | `c_4c_promotion.test.ts` |
| 两个 `Record<TerrainType>` 穷举表补成员 | `c_7_lighting` / `r_1_appearance` |

`npm run build` 现在是**绿**的（验收方补修了 `v_2b_3_wired.test.ts:422` 的一处笔误：
`nested.missingDf` → `nested.deferred!.missingDf`，因为 `missingDf` 在 `DeferredPromotion`
上，同文件 415 行写法正确）。

**原始规格是 `ai_docs/tasks/v-2b-3.prompt.md`**，仍然有效，遇到语义问题回去查它。

---

## 1. 本轮要做的：让 15 条失败归零

验收方跑的完整门禁：**1248 通过 / 15 失败**。逐条如下，**按类处理**。

### A 类：穷举表 / 目录计数（9 条）——新数据落地后计数变了

```
c_4a_0_layer_model   归属表与 drawPriority 表        59 vs 50
c_4a_terrain_catalog 全 TerrainType 键覆盖            62 vs 53
c_4a_terrain_catalog terrainAllowsMove ≡ 旧排除清单   PORTCULLIS_CLOSED: expected false to be true
c_4a_terrain_catalog Game.canMoveTo ≡ 旧清单          PORTCULLIS_CLOSED: 同上
c_4a_terrain_catalog promote/fire 字段生产读者白名单  BlueprintEngine.ts:926 在白名单外
c_4b_dungeon_feature E1 DF 条数                        49 vs 35
c_4b_dungeon_feature E2 闭包自洽                       集合差 1
c_4b_dungeon_feature E4 缺 tile 登记条数               19 vs 8
g_2_gas_df_wiring    DF_EXPLOSION_FIRE 接线集合        19 vs 8
```

处理原则：**这些数字是"当前事实的快照"，本轮新增了地形与 DF 条目，所以要顺着实测挪。**
但每挪一个都要：

1. **说明这个数字为什么变**（新增了哪些条目导致 35→49），不要只改数字；
2. `PORTCULLIS_CLOSED` 那两条**不是改数字，是判断题**：关闭的闸门该不该可通行？
   回 CE `Globals.c` 查它的 `T_OBSTRUCTS_PASSABILITY`，按 CE 事实决定它进不进
   `terrainAllowsMove` 的排除清单，并在报告里给出 CE 行号；
3. `BlueprintEngine.ts:926` 那条是**扫描器白名单**——本轮机器侧确实开始读 promote/fire
   字段了，属于该扫描器头注预告的扩清单时刻，**扩清单、不要删断言**。

### B 类：留痕反转（3 条）——载体集合变动

```
p1_42_secret_door_search  C1  TM_IS_SECRET 持有集变化（新增 3 个 _HIDDEN 地形）
v_1b_alternative          P1  MF_ALTERNATIVE 载体集变动
v_2b_2a_placement_flags   P1  PERMIT_BLOCKING 载体数 22 vs 13
```

**留痕反转是本项目的核心纪律，务必按它来做**：这些断言钉的是"某个前提当前为真"。
本轮让前提变了，**正确做法是把断言改成主张新事实**（写出新的集合/数字 + 为什么变），
**错误做法是删掉断言或放宽成不等式**。放宽即视为本轮失败。

改之前先回 CE `GlobalsBrogue.c` 的蓝图原表核对新数字对不对——数字变了可能是对的
（新蓝图带来的），也可能是你落的数据有误。

### C 类：需要真诊断（2 条）——**不要当成表格顺手改掉**

```
v_2b_2b_blueprints  「TM_IS_WIRED 格保留机器标记（CE :1695）」  expected +0 to be 12
p1_37_machine_flag_i18n  AD3 机器旗标穿存档往返                  45 vs 44
```

第一条尤其可疑：它期望 12 个 wired 格保留机器标记，实测 **0 个**。这意味着要么六条新蓝图
没产出 wired 格，要么 `BP_NO_INTERIOR_FLAG` / 机器标号与 `TM_IS_WIRED` 的交互有问题
（CE `Architect.c:1691-1696`：带 `TM_IS_WIRED | TM_IS_CIRCUIT_BREAKER` 的格**豁免**
`BP_NO_INTERIOR_FLAG` 的去标记）。**先查清成因再决定改哪边**；若结论是实现有缺陷，
修实现而不是改断言。

第二条查清是真回归还是新地形带来的合理计数变化。

### D 类：基线（1 条）

`generation_baseline` 偏离 **234 处** —— 预期内（六条新蓝图 + 通电机制）。
**必须是最后一步**：等 A/B/C 三类全绿之后再重捕获，否则会把中间态固化进基线。
重捕获后在报告里做成因拆分（多少来自新蓝图入池、多少来自通电机制）；**分不开就说分不开**，
不要编。

---

## 2. 铁律

- **授权清单**：本轮可改 `src/` 下与上述失败相关的文件、`src/data/blueprints.json`、
  `src/engine/` 相关实现、`src/test/fixtures/generation_baseline.json`（仅最后一步）。
  **`BrogueCE-master/` 只读**（那是 CE 原始源码，是事实基准，改它等于篡改标准答案）。
  改了清单外的文件必须在报告里单列申报。
- **守卫顺延不放宽**：期望值顺着实测挪，绝不放宽成 `toBeGreaterThan` 之类。
- **撞断 > 5 个就停**：在报告里说明，不要硬改（本轮已知 15 条，按上面分类处理不算"撞断"）。
- **不许跳过 build**：每改一批就跑一次 `npm run build`，别攒到最后——上一轮就是因为
  攒着没跑，9 个新地形把两个穷举表撞红才发现。
- **授权反驳**：以上任何判断若与你读 CE 源码所得不符，**你有权也有义务驳回并纠正**，
  但必须给出 `BrogueCE-master/src/...` 的文件:行号。历次轮次里这条多次拦下过验收方的
  错误判断——认真用，不要为了顺从而实现一个错的东西。

---

## 3. 门禁与报告

```
npx vitest run
npm run build
```

- `npx vitest run` 是**并行**的（墙钟约 9 分钟）。**不要**加 `--fileParallelism=false`：
  串行会复用单 worker，反而制造跨文件的模块单例污染。
- 类型门禁必须用 `npm run build`（它跑 `vue-tsc -b`，会套用 `noUnusedLocals`），
  **不要**用 `npx tsc --noEmit`，那会漏掉未使用变量。
- 失败清单**完整输出**，不要 `| tail` 截断。

报告写到 `ai_docs/reports/v-2b-3.report.md`，含：

1. A 类每条数字变化的**成因说明**（不是只报改了）
2. `PORTCULLIS_CLOSED` 可通行性的判断与 CE 行号
3. B 类三条反转后的新事实与 CE 核对结果
4. **C 类两条的诊断过程与结论**（这是本轮最重要的一节）
5. D 类基线偏离的成因拆分
6. 清单外改动申报（有则列，无则写"无"）
7. 任何行使授权反驳之处
8. 门禁两条命令的完整输出结尾
