# 夜间连续开发计划（2026-09-15 夜 → 09-16 晨）

> **用途**：本会话若中断，新会话读这一份就能接着干，不必回溯对话。
> 执行方是 zcode / GLM-5.3-Flash（**23:00–09:00 免费不限量**），验收方是 Claude。
> 建立时间：2026-09-15 约 23:20。

## 铁律（每轮都适用，违反即打回）

1. **任务书必须先自己核 CE 事实再写**。前几轮我（验收方）写错过 19 处事实，全靠执行方反驳才没落进代码。任务书里要保留"授权反驳"条款。
2. **文件边界是硬约束**。永远禁改 `src/engine/UI/DetailGenerator.ts`（否则执行方会删标签而不是实现行为）、`src/data/*.json`（除非该轮明确需要）、`src/test/fixtures/*`（尤其不许重新捕获 `generation_baseline.json`）、`src/engine/Random.ts`。
3. **验收方必须独立探针**，不复用执行方的测试。前几轮靠这个抓出了 P4-4 的爆炸失效、P1-24、P1-25。
4. **同一时间只跑一个执行方**。2026-09-15 夜间发生过 Claude 子代理与 zcode 并发改同一批文件，所幸 zcode 还在规划阶段未落盘。开跑前先 `git status --short` 确认工作树干净。
5. **只信任务完成通知，进程检查仅作交叉验证**。zcode 的 node 进程会把自己改名成 `zcode-cli`，`pgrep -f zcode.cjs` 永远搜不到。
6. **门禁只许增不许减**：`npm test` 通过数不得低于上一轮，`npm run build` 必须绿，两条真实输出尾部贴进报告。

## 队列（按此顺序，前一轮验收通过后再投下一轮）

| # | 轮次 | 状态 | 任务书 |
|---|---|---|---|
| 1 | **P4-6** 矛/斧/鞭 怪物侧攻击几何 | ✅ 已提交 d769c40（406 passed） | `ai_docs/tasks/p4-6.prompt.md` |
| 2 | **P4-7** 玩家武器几何 + 钝器击退 | ✅ 已提交 28eacbb（423 passed） | `ai_docs/tasks/p4-7.prompt.md` |
| 3 | **P4-8** 气味图（scent map） | 🟡 跑中（09-16 01:3x 投） | `ai_docs/tasks/p4-8.prompt.md` |
| 4 | **P1-24** `die()` 不归零导致淹死/烧死的怪没死 | ⬜ 待投（小而高价值，可当填充） | 见路线图 P1-24 |
| 5 | **P4-9** safety map（怪物逃跑 / 盟友避险） | ⬜ 待写任务书 | CE 锚点见下 |
| 6 | **P4-10** waypoint 游荡导航 | ⬜ 待写任务书 | CE 锚点见下 |

若队列跑空，按路线图顺序取 P1-14（饥饿行为补全）、P1-15（`isProtected` 消费点）。
**不要**在夜间动 P1-22（坠落子系统）、P1-23（DF 系统）——这两个是大改，需要白天有人在场决策。

## 后两轮的 CE 锚点（写任务书时直接用，不必重新查）

### P4-9 safety map
- `updateSafetyMap()` —— Time.c:1791-1905。初值 `safetyMap[i][j] = 30000`（Time.c:1803）；
  `safetyMap[player.x][player.y] = 0`（Time.c:1879）；`dijkstraScan(safetyMap, playerCostMap, false)`（Time.c:1888）；
  末尾 `resetDistanceCellInGrid`（Time.c:1900）。
- `updateAllySafetyMap()` —— Time.c:1707 起，盟友用的另一张。
- 惰性更新：`IO.c:4480-4481` —— `if (map == safetyMap && !rogue.updatedSafetyMapThisTurn) updateSafetyMap();`
  即**每回合最多算一次**，别每只怪都重算。
- web 底座已有：`src/engine/Map/Pathfinding.ts` 的 `DijkstraMap`，常量与 CE 一致
  （`PDS_OBSTRUCTION = 30000`、`PDS_FORBIDDEN = 29999`）。**复用它，不要新造。**

### P4-10 waypoint
- `setUpWaypoints()` / 单个 waypoint 的距离图 —— Architect.c:3011-3070。
  `fillGrid(rogue.wpDistance[wpIndex], 30000)`；起点置 0；`dijkstraScan(..., costMap, true)`。
- **关键性能约定**（Architect.c:3012-3013 注释）：建图时算全部 waypoint，
  **此后每回合只重算一个**。别每回合全算。
- `MAX_WAYPOINT_COUNT` 上限见 Architect.c:3049。
- 洪水/地形剧变后要 `setUpWaypoints()` 重算（Items.c:5558）。

## 验收流程（每轮照做）

1. `git status --short` + `git diff --stat` 查越界。
2. `npx vitest run --reporter=dot` 看通过数不低于上一轮；`npm run build` 绿。
3. **写独立探针**放 `src/test/zz_probe_<轮次>.test.ts`，跑完**务必删掉**（别污染套件）。
   探针挑地板格时要排除 `TerrainType.WATER_DEEP(7)` 与 `LAVA(9)`——踩过这个坑两次。
4. 通过则提交（提交信息写清病灶、CE 行号、探针证据、未实现项）；
   不通过则 `SendMessage` 打回，说清"哪条断言、期望什么、实测什么、死路在哪"。
5. 探针撞见的**本轮范围外**的 bug，记进 `dev_roadmap_2026Q3.md` 并单独提交，不要顺手改。

## 验收方自己反复踩的三个坑（探针误报的全部来源）

1. **怪物之间默认非敌对**——`willAttackTarget` 走 `monstersAreEnemies`，
   两只敌对怪物彼此不是敌人。探针要验怪物打怪物，攻击者必须 `isAlly = true`，
   或干脆拿玩家当靶子。
2. **单次攻击会因命中掷骰 miss**——按单次断言就是统计脆弱。一律改成累计 N 次
   看总量，或直接断言"命中表包含哪些目标"而不是"血量掉了没"。
3. **叫错函数**——几何攻击往往分两层（构建命中表 / 单目标结算）。
   探针要走"真实入口"，别挑一个看着顺眼的私有方法就调。

## 已知坑（别再踩）

- `Game.canMoveTo` 排除 `WATER_DEEP` 但**不排除** `LAVA`（见 P1-25）。
- `Creature.die()` **不把 hp 归零**，`Monster` 没覆盖它（见 P1-24）。
- `environment.ignite()` 只点燃草/植被/沼泽/门；要无视地形点火用 `igniteForced()`。
- `GasType.FIRE` 是个声明了但全仓无人使用、且伤害结算里没有对应分支的枚举值——别用它。
- 火焰伤害的真实来源是 `cell.isBurning`（`Game.ts` 的 fire 分支）。
- `zh_CN.json` 用**扁平点号键**（`"name.Golden Potion"`），不是嵌套。
- 伤害记法 `"XdY"` 解析为 `{min:X, max:X*Y, clumping:X}`，**不是 min-max**。
- 用 `nohup ... &` 起的进程**不是 harness 托管任务**：面板看不见、也没有完成
  通知，只能手动轮询。执行方一律用 Bash 工具的 `run_in_background` 起，
  才会有完成通知。（2026-09-16 因此让 P4-6 跑完后闲置了一段时间。）
