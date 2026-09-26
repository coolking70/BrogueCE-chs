# UR3 生成与层生命周期协调拆分报告

## 实施

按任务书 §0 指向的 X-0 UR3 行完成纯重构。`GenerationCoordinator.ts` 承接 `generateDepth` 的新层、重访、坠落入层流程，楼梯 dig/retry、机器运行时实体 adapter、蓝图延迟产物提交、人口布设和入层前环境追赶的调用顺序。`Game.ts` 保留原私有方法包装和当前层字段，按实时读写访问器及已绑定的窄回调显式注入依赖；没有把 Game 实例传给协调层。D26 护符布设留在 Game 的实际 helper 中，供原源码守卫检查，协调层在原时点调用它。缓存层的数据形状移到 `LevelState.ts`，由 Game 保持原导出路径。

事务边界维持原顺序：每次失败的楼梯几何重试重新造图；成功的 BlueprintEngine 即时实体先占层，成功后人口阶段处理延迟的机器物品／怪物及 U25 观测；随后归还层 RNG，恢复坠落物和居民，追赶环境并落位玩家。没有改生成公式、随机调用或夹具预期。

`Game.ts` 行数：**11,085 → 10,419**，减少 **666** 行。新 `GenerationCoordinator.ts` 811 行，`LevelState.ts` 30 行。所有改动的 TS 文件均为 LF，无 CRLF。

## HEAD 对照

先从 `HEAD`（`50090e5d6`）临时装回原 `Game.ts` 录制，再恢复工作树改动。夹具在 `ai_docs/reports/u-r3-trace.json.gz`，由 `src/test/u_r3_trace.test.ts` 解压逐项对比。逐深度及重访采样对完整 `toSnapshot()`、logger、两流 RNG 全状态与计数、U25 机器观测记录做 SHA-256 指纹，并保留深度、怪物／物品／观测数量供定位；坠落采样对完整快照、logger 和两流 RNG 做同样指纹。

覆盖 4 个现有 drift seed（424242、777、20260913、31337）各 D1–D26，以及 D25 重访、返回 D26、保存读回、从 D1 坠落进入 D2。重构版全部指纹与 HEAD **逐位一致**。原 `generation_baseline.json`、`test:drift` 和原有测试守卫均未修改。

## 验证

- `npx vitest run src/test/u_r3_trace.test.ts --maxWorkers=1`：1/1 通过（修正固定 seed 观测钩子的录制时序后）。
- `npm run build`：通过。
- `npm run test:drift`：1/1 通过。
- `git diff --check`：通过。
- 首轮全量 `npm test -- --maxWorkers=8 --reporter=dot`：完整结束，195 文件通过、1 文件超时；3743 测试通过、1 测试超时、8 跳过、5 待办。唯一超时为 `blueprint_center.test.ts` 的 44 seed × D1–D26 扫描，在 900 秒限时内未结束，未出现断言差异。
- 单文件 `npx vitest run src/test/blueprint_center.test.ts --maxWorkers=1 --reporter=dot`：7/7 通过，完整 1144 层、3692 台机器扫描，center 违例 0；耗时 397.38 秒。未改 900 秒超时阈值或任何守卫。
- 降低并发后的最终全量 `npm test -- --maxWorkers=4 --reporter=dot`：**196/196 文件、3744 测试通过**，8 跳过、5 待办，退出码 0，耗时 2097.80 秒。`blueprint_center` 在这次全量中通过；c/p1/V/B2、U00/U01/U03/U03b/U04c/U05a/U17/U19/U25/U27、UR1/UR2/UR4 等原有闭包均在全量范围内。
- 全量结束后再次 `npm run build`、`npm run test:drift` 和 `git diff --check`：均通过。最终 drift 为 1/1；所有改动的 TS/报告文件均无 CRLF。`generation_baseline.json` 与 `generation_baseline.test.ts` 无改动。

未提交 git。

## 验收方合并记录：trace 基准重录

UR3 以 `50090e5d` 为基准执行；合并前 main 已并入 U15b-2（`ff78ad49`，按 CE 改变戒指生成并经单变量归因重捕获滚动基线）。合并后原夹具按预期不符。验收方按同一方法重录：临时装回新 HEAD（含 U15b-2）的 `Game.ts`，以 `UR3_CAPTURE=1` 录制，再恢复 UR3 的 `Game.ts` 比对 **1/1 通过**——即 UR3 重构在新基准上仍逐位等价。夹具 SHA-256：旧 `88bf25d5…`，新 `d7d37a99…`。
