# 会话交接（滚动更新，读这一份即可接手）

> **本文取代 `night_plan_2026-09-15.md`**（那份已定格为历史记录，勿参照）。
> 最后更新：2026-09-17 凌晨。C-4 链前三轮（4a-0 / 4a / 4b）已提交，**C-4c 跑中**。
> **每次验收通过并提交后，必须回来更新「当前状态」与「队列」两节。**

---

## 角色与工具

- **执行方**：本机 zcode 调用 GLM-5.3-Flash。**23:00–09:00 免费不限量**。
- **验收方**：Claude。写任务书、独立探针验收、裁决、提交、合并。
- 调用：`bash ai_docs/tasks/zrun.sh <任务书> <cwd> yolo`
  （自动前置注入 `ai_docs/project_conventions.md`；内核版本锚定 `0.16.5`）。
- **必须用 Bash 工具的 `run_in_background` 启动**，才有完成通知。
- **配额**：耗尽表现为 HTTP 429 → `zrun.sh` 报 `PARSE_FAIL`、退出码 1。
  诊断方法：绕过 `zrun.sh` 的 stderr 过滤直连内核跑一句 `--prompt "回复：OK"`。
  工作日 14:00–18:00 是高峰时段，积分全额扣。

---

## 当前状态（2026-09-17 凌晨）

- 测试：**64 文件 / 693 passed | 8 skipped | 5 todo，零红**，build 绿。
- **Phase D 全部完成**（P4-1 ~ P4-10）。
- **Phase C**：C-0 环路、C-1 房间剖面、C-2 湖泊、C-3 墙面与门、
  C-4a-0 四层地形模型、C-4a 地形属性表、C-4b DF 目录与 spawnDungeonFeature 已完成；
  **C-4c（promoteTile + 每回合两趟驱动）跑中——它是本链第一个真会改行为的轮次**。
- **Phase B**：B-1 已完成；鉴定系统、投掷武器、占位物品仍欠。
- P1-37（机器旗标 + i18n 硬编码）已完成。

### 必须记住的四条（按被坑次数排序）

1. **`WATER_DEEP` 不是 `DEEP_WATER`。** 写错不报错——vitest 走 esbuild
   只剥类型不检查，运行时得 `undefined`；只有 `npm run build` 的 vue-tsc 报 TS2339。
   **任何让人困惑的测试失败，先跑 build。**
2. **连通性判据有三口径且互相矛盾**（P1-38）：`Grid.setTerrain` 的
   `isPassable`、`Game.canMoveTo`、`Pathfinding` 成本图，对 LOCKED_DOOR /
   WATER_DEEP / CHASM 的裁决各不相同。我已因此三次量错。C-4a 统一。
3. **连通性**分析**口径要放行密门**——用 `harness.analysisAllowsMove`，
   别再各写一份。依据 `Architect.c:202-203`（CE 自己就把密门当通路）。
   ⚠️ 它的前提是玩家找得到密门，而 web 的发现机制远弱于 CE（P1-42）——
   **不要用"连通性闸门全绿"论证"关卡可玩"。**
4. **桥只架深渊**（`T_CAN_BE_BRIDGED = T_AUTO_DESCENT`）。CHASM 暂不生成
   （等 C-5），所以真实关卡里桥恒 0，`buildABridge` 已忠实实现并被 6 个
   构造场景钉死。别去改它。


### ★ 一个已被验证两次的出题模式：结构先行 + 完美门禁

C-4a-0 与 C-4a 都用了同一个套路，它奏效：

1. 先只搬**结构**，刻意让**行为逐位不变**；
2. 于是可以拿 **`generation_baseline` 不重采而绿** 当门禁——
   这是个极强的自动判据，不需要人去逐条判断"这处变化是对是错"；
3. 把"行为该怎么改"的证据**作为干跑测量交付出来**（C-4a-0 交了 74 行
   跨层清除表，112,033 次事件），下一轮拿着数据逐条裁决。

**反例**：C-4 原本想一轮做完"promoteTile + DF 目录"，投不出去——
它预设了两个 web 没有的底座，执行方只能自己现造（无法验收）或硬接（更难拆）。


### ★ C-4c 起，「逐位不变」那个门禁失效了

C-4a-0 / C-4a / C-4b 能拿"`generation_baseline` 不重采而绿"当门禁，是因为
它们只搬结构。**promote 是回合期的事，而 baseline 只测量生成期**——
所以 C-4c 之后 baseline 大概率仍绿，**但那不再是"没改坏"的证据**。
从 C-4c 起，判据换成"实测影响报告 + 既有玩法测试"，
且**既有玩法测试翻红时不许调断言改绿**，必须逐条判"回归"还是"CE 行为首次生效"。

### ★ C-4b 查明的两条硬前提（C-4c 及之后必须守）

1. CE `promoteTile` **先清层再 spawn，且 `abortIfBlocking = false`**——
   这是 DOOR（drawPriority 8）能晋升 OPEN_DOOR（25）而不被 `fillSpawnMap`
   优先级判据挡住的唯一原因。
2. CE `spawnMapDF` **不检查"已标记"**，`probDec = 0` 的非 GAS 输入会**无限震荡**。
   CE 目录里所有走扩散的条目都满足 `probDec > 0`——**隐含输入约定**。
   手搓合成 DF 条目踩到 `dec = 0` 就是死循环，不是断言失败。

### ★ 「能不能走」全库有五套答案（C-4a 实测，我原先写错了机制）

`Grid.setTerrain` 的 `isPassable` 是本体，然后四个消费方**各打各的补丁**：
`Scent.ts:37/48` 加 CHASM/LAVA/WATER_DEEP；`SafetyMap.ts:118/347` 减
SECRET_DOOR 与 CHASM；`WaypointMap.ts:235/352` 只减 SECRET_DOOR。
`Pathfinding.calculateMap` **生产零调用点**（P4-9 后各消费方自算 cost 走 `batchScan`），
所以我原先"Pathfinding 继承了错口径"的说法是错的。
C-4a 已把 `canMoveTo` / `terrainAllowsMove` 迁为查 `TerrainCatalog`；
**真正的翻转点是 `setTerrain` 的启发式**，归 C-4a-1。

### ★ 出题时的自知之明：不要手抄 CE 数据表

C-4a-0 那轮我手抠归属层表，把 CHASM_EDGE 与 OBSIDIAN 按 drawPriority
同档猜成 SURFACE，实际是 LIQUID（`Globals.c:627` 的 DF 条目白纸黑字）。
**我在"照抄 CE 表格"上的错误率高于执行方。**
C-4a 的任务书因此刻意**不给任何 CE 数据表**，只定结构与门禁，表由执行方抽取。

### ★ 写探针前先读这一段（我已栽四次）

**优先跑既有闸门，而不是手搓探针。** p1_26 / p1_29 / p1_33 是前几轮写的，
新一轮一律禁改它们——跑它们本身就是独立验证，且它们的判据已经调对了。

手搓时的四个坑，我全踩过：
- `createHeadlessGame` + `generateDepth` 走**测试模式**的 `generateTestDepth`
  早返回路径，生成不出机器。真实生成要
  `rng.seedRandomGenerator(seed)` + `new Architect()` + `arch.generateLevel(d)`。
- 洪泛起点别取"扫描序第一个可走格"，那格可能是孤立口袋。
- 洪泛**不要在遍历时挡住机器格**——路径可以合法地穿过前厅一类机器内部；
  p1_33 用例 f 的做法是穿过去、只要求非机器可走格可达。
- 用 `cell.isPassable` 或漏掉 `LOCKED_DOOR` 都会让 bug 隐形。

### ★ 并行执行期间，全量测试结果不可信

实测教训：`invented_content_pool` 单独跑 6/6 绿、耗时 **53 秒**，而当时全局超时 120 秒；
C-2 的 zcode 在另一 worktree 里也反复跑 vitest，两边抢 CPU，于是
`armor_model_effect` / `horde_terrain_spawn` / `invented_content_pool` /
`monster_stats_effect` / `p1_29` 这些**重型长跑测试集体超时翻红**。发生过两次。

**C-2 后已治本**：`vite.config.ts` 的 `testTimeout` 上调至 **300s**、`hookTimeout` 120s。
理由与代价写在该文件注释里——**假红比慢更有害，它训练所有人把红灯当背景音**；
代价是真正挂死的用例要 300s 才浮出水面。

**规矩仍然有效**：
1. 执行方在跑时，全量读数只作参考；
2. 看到重型测试翻红，**先单独重跑该文件**再下结论；
3. **提交前的最终门禁必须在没有执行方占用 CPU 时跑一遍**。

已知重型测试（单跑耗时实测）：`c_0_add_loops` **148s**、`p1_29_lake_connectivity` 71s、
`invented_content_pool` 52s，另有 `armor_model_effect`、`monster_stats_effect`、
`horde_terrain_spawn`、`p1_33_machine_chokepoint`。**没有一个声明显式超时**，全靠全局值。

## 队列

| # | 轮次 | 状态 | 任务书 |
|---|---|---|---|
| 1 | **C-4c** promoteTile + 每回合两趟驱动 | 🟡 跑中 `wt-c-4c` | `tasks/c-4c.prompt.md` |
| 2 | **C-4d** 接线机器（TM_IS_WIRED / activateMachine / 断路器） | ⬜ 待写 | C-4c 里留了显式未实现分支 |
| 3 | **C-4a-1** 收敛"能不能走"的五套答案 + 放开单层不变式 | ⬜ 待写 | 输入=C-4a-0 的 74 行表 + C-4a 的 10657 格分歧表 |
| 5 | **P1-42** 密门发现机制对齐 CE（**优先级高**） | ⬜ 待写 | 挡着"可玩性"结论 |
| 6 | **C-5** 坠落子系统（吸收 P1-22）—— 解禁 CHASM 与桥梁 | ⬜ 待写 | 大工程 |
| 7 | **C-6** runAutogenerators ｜ **C-7** 光照目录 | ⬜ 待写 | |
| — | Phase B 余项：鉴定系统 / 投掷武器 / 占位物品 | ⬜ | 大工程 |
| — | P1-39 深水可游 ｜ P1-41 成员铺开改路径距离 ｜ P1-43 蓝图选址避有害地形 | ⬜ | 中小 |

**并行配对规则**：只并行"允许修改"清单真正不相交的轮次；
**绝不并行两个都移动 RNG 流的轮次**；最多 2 个并发；**验收一律串行**。

---

## 未决条目（路线图有详条）

| 条目 | 一句话 | 轻重 |
|---|---|---|
| P1-37 | 宝库地板用 `CHARRED_FLOOR` 冒充 `IS_IN_MACHINE`，玩家会看到"烧焦的地面" | 中 |
| P1-25 | 击退落点判据用 `canMoveTo`，深水/熔岩口径不一致 | 中 |
| P1-14/15/16 | 饥饿行为 / `isProtected` 消费点 / 3 个占位卷轴 | 低 |
| — | `Game.ts:3510-3594` 有六条**完全没走 i18n** 的硬编码英文 | 中 |
| — | 突进的"猛烈突刺"专用措辞需加 i18n 键（B-1 登记） | 低 |

---

## 验收流程（每轮照做）

1. `git status --porcelain` + `git diff --stat` 查越界。
2. 全量测试 + build。**注意上面那条"并行期间读数不可信"。**
   执行方可能用"N passed"掩盖红项——自己看完整输出确认 `failed` 为 0。
3. **写独立探针**放 `src/test/zz_probe_<轮次>.test.ts`，**跑完务必删掉**。
4. 通过则提交（写清病灶、CE 行号、探针证据、未实现项、执行方纠正了我哪些错）；
   不通过则打回，说清"哪条断言、期望什么、实测什么、死路在哪"。
5. 探针撞见的**本轮范围外**的 bug，记进路线图并单独提交，不要顺手改。
6. **回来更新本文件的「当前状态」与「队列」。**

### ★ 探针的铁律

**打在真实生成的关卡/真实数据上，不能只复核执行方的人造场景。**
P4-9 有 7 条对抗性测试全绿，而真实关卡上 safety map 是整张平图、
`safetyNextStep` 在 60 个抽查格上给出方向 0 个。只复核它的场景就会放过去。

### ★ 阈值与基线的区别

- **基线重捕获**（记录当前状态）——有意变更后由验收方授权，正常。
- **放宽阈值**（削弱判据本身）——**必须论证新阈值仍有牙**：依据是什么、
  什么样的错误实现仍会被抓住，并写对抗性测试实证。
  C-1 那轮正是因为坚持这条，才查出"9.7% 阈值被击穿"其实是断言自身的**累计测量 bug**。

---

## 验收方自己反复踩的坑

1. **怪物之间默认非敌对**（`monstersAreEnemies`）——探针验怪打怪，攻击者要 `isAlly = true`。
2. **单次攻击会因命中掷骰 miss**——按单次断言即统计脆弱，改累计 N 次。
3. **叫错函数层**——几何攻击分"构建命中表 / 单目标结算"两层，要走真实入口。
4. **量错判据**——`canMoveTo` 排除的是 GRANITE/WALL/SECRET_DOOR/**LOCKED_DOOR**/**WATER_DEEP**
   （熔岩不排除）。用 `cell.isPassable` 或漏掉 `LOCKED_DOOR` 都会让 bug 隐形，两次都栽过。
5. **凭函数名和一处调用点下结论**。已因此写错：PDS 常量（CE 是 −1/−2 不是 30000/29999）、
   湖泊重试次数（20 不是 9）、`setUpWaypoints` 的种子隔离（CE 整段生成隔离、对主流零扰动，
   我错了三个版本）、"复用 P4-6 函数"却把那些函数所在文件列为禁改。
   **动手前把调用点上下文打开读完。**
6. **留痕测试与文件边界的系统性冲突**——已四次。见 `project_conventions.md` 新增的那一节。

---

## 已知代码坑

- `Pathfinding.ts` 的 `PDS_OBSTRUCTION=30000`/`PDS_FORBIDDEN=29999` 与 CE 的 −2/−1 不符，
  但文件内部自洽且有别的调用方——**不要纠正**，新代码用 `CE_PDS_*` / `WP_PDS_*`。
- `behaviorFlags` 与 `abilities` 是两个 Set；**`abilities` 全库无运行期写入者**，是死通道。
  旗标经 `syncFlagDerivedStatuses`（CE `initializeStatus`）翻译成状态生效。
- **`loopMap` 必须始终等于当前网格的 `analyzeLoopMap` 结果**——这个不变式已在四处漏过：
  `generateTestDepth`(P1-34)、`loadSnapshot`(P1-35)、waypoint 距离图、气味图。
  **新增任何"生成期派生态"时，检查所有重建网格的路径。**
- `environment.ignite()` 只点燃草/植被/沼泽/门；无视地形点火用 `igniteForced()`。
- `GasType.FIRE` 是死枚举；火焰伤害的真实来源是 `cell.isBurning`。
- 伤害记法 `"XdY"` → `{min:X, max:X*Y, clumping:X}`，**不是 min-max**。
- i18n：`defaultValue` 是无声降级通道。P1-30 已装红灯（扫描所有 `t()` 键），
  但**对硬编码英文字符串无效**。

---

## 项目决策速查

D1 行为一律照 CE，不调参凑手感 ｜ D2 自创内容保留代码但退出实际游戏 ｜
D3 大改先出方案文档再动手 ｜ D4 brogue-web 独立、不与其他项目共用文件 ｜
D5 `brogueweb/` 已封存 ｜ D6 `BrogueCE-master/` 只读参考

**执行方的 git 权限**：只读查询（`status`/`diff`/`log`）允许；
写操作（`commit`/`branch`/`merge`/`checkout`）禁止，由验收方负责。

详见 `ai_docs/dev_roadmap_2026Q3.md` 开头与 `ai_docs/phase_c_generator_proposal.md` §九。
