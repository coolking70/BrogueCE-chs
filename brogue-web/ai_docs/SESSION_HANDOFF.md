# 会话交接（滚动更新，读这一份即可接手）

> **本文取代 `night_plan_2026-09-15.md`**（那份已定格为历史记录，队列状态已过期，勿参照）。
> 最后更新：2026-09-16 P4-10 投出后。
> **每次验收通过并提交后，必须回来更新「当前状态」与「队列」两节**——否则新会话会被误导。

---

## 角色与工具

- **执行方**：本机 zcode 调用 GLM-5.3-Flash。**23:00–09:00 免费不限量**。
- **验收方**：Claude（本会话）。写任务书、独立探针验收、提交。
- 调用：`bash ai_docs/tasks/zrun.sh <任务书> <cwd> yolo`
  （自动前置注入 `ai_docs/project_conventions.md`；内核版本锚定 `0.16.5`，漂移即 abort）。
- **必须用 Bash 工具的 `run_in_background` 启动**，才有完成通知。
  用 `nohup ... &` 起的进程面板看不见、无通知，只能手动轮询——踩过一次，空转了四小时四十分。

---

## 当前状态（2026-09-16）

- 测试：**481 passed 零红**，build 绿。
- Phase D（怪物行为）已完成 P4-1 ~ P4-9，**只剩 P4-10（waypoint）正在跑**。
- Phase C 评审已通过，决议见 `ai_docs/phase_c_generator_proposal.md` §九。

### 最近一轮（P4-9）留下的两件事

1. **对 CE 的有意偏离**：`buildSafetyMap` 把玩家格修正移到了楼梯禁入循环之后。
   仅存在于"玩家站在楼梯格"这一 CE 进场不可达的状态。回退条件依赖 **P1-31**。
2. **P1-31 已登记**：web 玩家出生/换乘落在楼梯坐标上（`Game.ts:851-855`），
   CE 明确避开楼梯（`RogueMain.c:845-851` 的 4 邻域搜索排除 `HAS_STAIRS`）。

---

## 队列

| # | 轮次 | 状态 | 任务书 |
|---|---|---|---|
| 1 | **P4-10** waypoint 游荡导航 | 🟡 跑中 | `tasks/p4-10.prompt.md` |
| 2 | **P1-30** i18n 键存在性红灯 + 补齐缺口 | ⬜ 已写 | `tasks/p1-30.prompt.md` |
| 3 | **P1-26** 不变量断言（Phase C 前置） | ⬜ 已写 | `tasks/p1-26.prompt.md` |
| 4 | **P1-29** 湖泊连通性修复（8.5% 关卡下不去） | ⬜ 已写 | `tasks/p1-29.prompt.md` |
| 5 | **C-0** `addLoops` 环路 | ⬜ 待写 | 锚点见 phase_c 文档 §三 |
| 6 | Phase B 武器三项（匕首背刺 / 刺剑突进 / 连枷移动攻击） | ⬜ 待写 | 旗标全仓零引用 |
| 7 | Phase C 正篇 C-1 起 | ⬜ 待写 | phase_c 文档 §6.1 |

**依赖与互斥**（并行前必查）：
- P1-29 **依赖** P1-26（要把留痕断言改成严格 0）。
- P1-29 与 C-0 都改 `Architect.ts` → 必须串行。
- P4-10 在改 `Monster.ts`/`Architect.ts` → 与 P1-30、P1-29 冲突。
- **绝不并行两个都移动 RNG 流的轮次**——基线报告会互相污染。

---

## 并行执行（已实测可行，尚未正式启用）

共享工作树上跑两个执行方会毁掉验收前提（`git status` 分不清谁改了什么，撞过一次）。
正确做法是 **git worktree**：

```bash
git worktree add <路径> -b <分支>
ln -s <主树>/brogue-web/node_modules <worktree>/brogue-web/node_modules
```

实测：独立目录 + 软链共享 `node_modules`（本体仅 3MB，node_modules 204M 不必复制），
与主树并发跑 vitest 互不干扰。

**规矩**：
1. 只并行"允许修改"清单**真正不相交**的轮次（每份任务书都写明了，开跑前查）。
2. **执行可以并行，验收一律串行。** 质量来源是验收方的独立探针，不能稀释。
3. 不并行两个都动 RNG 的轮次。
4. 最多 2 个并发。

---

## 验收流程（每轮照做，一步不能省）

1. `git status --short` + `git diff --stat` 查越界。
2. `npx vitest run --reporter=dot` 通过数不低于上一轮；`npm run build` 绿。
   **注意执行方可能用"N passed"掩盖红项**——自己看完整输出，确认 `failed` 为 0。
3. **写独立探针**放 `src/test/zz_probe_<轮次>.test.ts`，**跑完务必删掉**。
4. 通过则提交（提交信息写清病灶、CE 行号、探针证据、未实现项、执行方纠正了我哪些错）；
   不通过则打回，说清"哪条断言、期望什么、实测什么、死路在哪"。
5. 探针撞见的**本轮范围外**的 bug，记进路线图并单独提交，不要顺手改。

### ★ 探针的铁律（血泪换来的）

**探针必须打在真实生成的关卡/真实数据上，不能只复核执行方的人造场景。**

P4-9 有 7 条对抗性测试全绿，但 safety map 在真实关卡上是**整张平图**、
`safetyNextStep` 在 60 个抽查格上给出方向 **0 个**（逃跑怪全部原地不动）。
原因是它的测试舞台都会把玩家脚下的楼梯刻掉再传送到人造地板格，种子天然活着。
**只复核它的场景就会放过去。**

---

## 验收方自己反复踩的坑

1. **怪物之间默认非敌对**（`willAttackTarget` 走 `monstersAreEnemies`）。
   探针验怪打怪，攻击者必须 `isAlly = true`，或直接拿玩家当靶子。
2. **单次攻击会因命中掷骰 miss**——按单次断言就是统计脆弱。改累计 N 次，
   或断言"命中表包含哪些目标"而非"血量掉了没"。
3. **叫错函数层**。几何攻击分"构建命中表 / 单目标结算"两层，要走真实入口。
4. **量错判据**。深水的 `isPassable` 是 `true`，真正拦住移动的是 `canMoveTo` 里
   单独的 `WATER_DEEP` 排除——用 `isPassable` 量连通性会让 8.5% 的坏关卡完全隐形。
5. **写任务书时凭函数名和一处调用点下结论**。已因此写错：PDS 常量（CE 是 −1/−2
   不是 30000/29999）、湖泊重试次数（20 不是 9）、`setUpWaypoints` 的调用时机
   （在生成决策**之后**，不是中途）、"复用 P4-6 函数"却把那些函数所在文件列为禁改。
   **动手前把调用点上下文打开读完。**

---

## 已知代码坑

- `Game.canMoveTo` 排除 `WATER_DEEP` 但**不排除** `LAVA`（P1-25）。
- `environment.ignite()` 只点燃草/植被/沼泽/门；无视地形点火用 `igniteForced()`。
- `GasType.FIRE` 是声明了但全仓无人使用、伤害结算里也没有对应分支的死枚举。
  火焰伤害的真实来源是 `cell.isBurning`。
- `Pathfinding.ts` 的 `PDS_OBSTRUCTION=30000`/`PDS_FORBIDDEN=29999` 与 CE 的
  −2/−1 不符，但在该文件内部自洽且有别的调用方——**本阶段不要去纠正**，
  新代码用 `SafetyMap.ts` 里的 `CE_PDS_*`。
- `behaviorFlags` 与 `abilities` 是两个 Set；`abilities` **全库无运行期写入者**，
  是死通道。旗标经 `syncFlagDerivedStatuses`（CE `initializeStatus`）翻译成状态生效。
- 伤害记法 `"XdY"` 解析为 `{min:X, max:X*Y, clumping:X}`，**不是 min-max**。
- i18n：`defaultValue` 是无声降级通道，缺键直接渲染英文（P1-30 待修）。

---

## 项目决策速查

D1 行为一律照 CE，不调参凑手感 ｜ D2 自创内容保留代码但退出实际游戏 ｜
D3 大改先出方案文档再动手 ｜ D4 brogue-web 独立、不与其他项目共用文件 ｜
D5 `brogueweb/` 已封存 ｜ D6 `BrogueCE-master/` 只读参考，任务书禁改清单须包含它

详见 `ai_docs/dev_roadmap_2026Q3.md` 开头。
