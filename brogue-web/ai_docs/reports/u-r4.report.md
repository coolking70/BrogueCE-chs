# UR4 时间与环境协调拆分报告

## 规格与范围

按任务书 §0 所引 X-0 勘察报告 UR4 行实施纯重构。`Game.ts` 保留 `playerTurnEnded`、`advancementLoop`、`objectiveTimeBlock`、`updateEnvironment` 和 `finishTurnEpilogue` 的私有包装；协调实现在 `src/engine/Core/TimeCoordinator.ts`。Game 每次进入协调层时注入显式 `WorldPort`、`ClockPort`、`EffectsPort`，端口的读写访问器保持实时状态，回调闭包保留原 `this`。Monster 行动通过 `monsterTakeTurn(monster, stealthRange)` 窄回调返回 Game 执行，未把 Game 实例或 `Game as any` 传进协调层。动画生成器仍由 Game 持有，输入锁、超时、异常收束和 DF 绑定生命周期未改。

协调层保留原顺序：主观回合准备与搜索、按最早事件推进、每 100 tick 客观块、环境坠落／气体两轮／晋升／火／地面物品、状态与营养递减，以及回合尾声回血／饥饿伤害／死亡结算。公式、RNG 调用位置和动画暂停条件均原样迁移。

## 行数与轨迹

- `Game.ts`：11,221 → 10,917 行，减少 304 行；新 `TimeCoordinator.ts` 510 行。
- 先临时装回 `HEAD:brogue-web/src/engine/Core/Game.ts`，运行 `UR4_CAPTURE=1` 的 `u_r4_trace.test.ts` 录制旧实现，再恢复工作树改动；基线在 `ai_docs/reports/u-r4-trace.json.gz`。夹具用 gzip 存储完整 JSON，测试逐字段解压比较。
- 固定种子 27027、U27 玩家命令日志，连续与动画分帧分别执行减速加火／毒气、加速、坠落、死亡四种场景；场景内有等待、搜索和行走。减速场景各 8 个客观块，加速场景各 2 个，死亡场景各 1 个，另保存各场景最终状态。每块保存完整游戏快照（实体、地形和运行状态）、日志事件序列、tick、两流 RNG 全状态及计数、命令日志。两种模式各自与 HEAD 基线逐字段相等；排除录制命令在同步／分帧路径中既有的块内写入时机后，两模式客观块完整状态逐块相等。
- HEAD 原有差异：死亡后的最终快照中，连续路径的 `player.ticksUntilTurn` 为 100，动画路径为 0；死亡发生的客观块状态相等。本轮保持此行为，未借重构修正。坠落场景在客观块前转层，因此以最终快照对照 HEAD。其余 f/g/W 状态路径由原有测试闭包承担。

## 验证

- `npx vitest run src/test/u_r4_trace.test.ts src/test/p2_1_tick_architecture.test.ts src/test/p2_2_real_speed.test.ts src/test/p2_3_objective_time.test.ts src/test/p2_4_animation_cadence.test.ts`：5 文件通过，53 通过、8 跳过。
- 火／气体目标测试：6 文件通过，80 通过、8 跳过。
- `npm run build`：通过。
- `npm run test:drift`：通过，1 文件 1 测试。
- `git diff --check`：通过；改动的 TS 文件无 CRLF。
- 最终全量 `npm test -- --maxWorkers=8 --reporter=verbose`：完整跑完，188 文件通过，3630 测试通过、8 跳过、5 待办，退出码 0（Vitest 报告耗时 1370.77 秒）。这是原 `npm test` 脚本的全量集合，仅限制 worker 数并打开详细输出，未改变测试排除规则。
- 全量测试结束后又复跑 `npm run build`、原样 `npm run test:drift` 和 `git diff --check`，均通过。所有源码读取守卫随全量测试通过，无需修改守卫或 `test:drift`。

未提交 git。
