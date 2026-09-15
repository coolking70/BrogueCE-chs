# 会话交接（滚动更新，读这一份即可接手）

> **本文取代 `night_plan_2026-09-15.md`**（那份已定格为历史记录，勿参照）。
> 最后更新：2026-09-16 傍晚，C-2 跑中。
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

## 当前状态（2026-09-16）

- 测试：**580 passed 零红**（C-2 合并前的干净读数），build 绿。
- **Phase D（怪物行为）全部完成**（P4-1 ~ P4-10）。
- **Phase C 进行中**：C-0（环路）、C-1（房间剖面）已完成；**C-2（湖泊四类液体）跑中**。
- **Phase B**：B-1（匕首/刺剑/连枷）已完成；鉴定系统、投掷武器、占位物品仍欠。

### ★ 并行执行期间，全量测试结果不可信

实测教训：`invented_content_pool` 单独跑 6/6 绿、耗时 **53 秒**，而全局超时 120 秒；
C-2 的 zcode 在另一 worktree 里也反复跑 vitest，两边抢 CPU，于是
`armor_model_effect` / `horde_terrain_spawn` / `invented_content_pool` /
`monster_stats_effect` / `p1_29` 这些**重型长跑测试集体超时翻红**。

**规矩**：
1. 执行方在跑时，全量读数只作参考；
2. 看到重型测试翻红，**先单独重跑该文件**再下结论；
3. **提交前的最终门禁必须在没有执行方占用 CPU 时跑一遍**。

已知重型测试（单跑即接近超时线）：`invented_content_pool`(53s)、
`armor_model_effect`、`monster_stats_effect`、`horde_terrain_spawn`、
`p1_29_lake_connectivity`、`p1_33_machine_chokepoint`、`c_0_add_loops`。

---

## 队列

| # | 轮次 | 状态 | 任务书 |
|---|---|---|---|
| 1 | **C-2** 湖泊四类液体 + 镶边 + 打通 + 建桥 | 🟡 跑中 | `tasks/c-2.prompt.md` |
| 2 | **P1-37 + i18n 硬编码** | ⬜ 待写 | 见下 |
| 3 | **C-3** finishWalls / finishDoors / removeDiagonalOpenings | ⬜ 待写 | 见下 |
| 4 | **C-4** promoteTile 生命周期 + DF 目录（吸收 P1-23） | ⬜ 待写 | 大工程 |
| 5 | **C-5** 坠落子系统（吸收 P1-22） | ⬜ 待写 | 大工程 |
| 6 | **C-6** runAutogenerators | ⬜ 待写 | |
| 7 | **C-7** 光照目录 + 动态视野 + 矿灯深度衰减 | ⬜ 待写 | |
| — | Phase B 余项：鉴定系统 / 投掷武器 / 占位物品 | ⬜ | 大工程 |

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
