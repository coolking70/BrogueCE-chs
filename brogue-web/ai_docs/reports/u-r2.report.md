# UR2：物品使用与魔法效果协调拆分

## 实施

- 新增 `src/engine/Items/ItemUseCoordinator.ts`。调用方显式传入 Player、Item、Monster 列表及必要的效果回调；模块不持有 Game 实例，也不在导入时构造实体或掷骰。
- 将药水/卷轴背包消耗、物品行动结算、投掷堆叠分离、魔杖/法杖效果后扣充能与自动鉴定、射线目标上下文、鉴定/附魔选物资格及附魔提交、护符效果与冷却协调迁入该模块。投掷物克隆仍分配一个新实体 ID；行动 tick 仍在效果之后按当时的 movementSpeed 计算。
- `Game` 保留原公开入口与私有 `boltWorld` 包装及其 `this` 语义；药水/卷轴的各类专属效果和射线地形/生物效果仍由 Game 的现有方法执行。`applyBoltEffect` 等私有调用入口未改名、未放宽可见性。
- `Game.ts` 按 LF 实际行数从 **11,310** 行变为 **11,221** 行，减少 **89** 行。新协调模块为 **158** 行。

## 前后等价证据

- `scripts/ur2-capture-baseline.py` 暂时装入 `HEAD` 版 Game.ts，运行固定种子 27027 的 U27 命令序列，`finally` 恢复工作树；旧版 trace 保存在 `ai_docs/reports/u-r2-trace.json`。新 `src/test/u_r2_trace.test.ts` 对每步逐字段比较。
- 序列覆盖药水成功、卷轴鉴定、魔杖选目标/取消/确认、护符使用与冷却拒绝、堆叠投掷、恶意药水确认拒绝、空魔杖失败、反射法杖。逐步比较背包资源、落地物位置、玩家/怪物位置与 HP、状态、日志、行动 tick、U27 命令日志及两流 RNG 完整 state/count。旧版捕获和新版比较各 1/1 通过。
- 既有读源码守卫未删除或放宽；本轮被迁走的资源与目标实现没有触发旧位置扫描前提的失效。`test:drift`、既有测试及生成基线均未改动。

## 门禁

| 门禁 | 结果 |
|---|---|
| `npm run build` | 通过；Vite 852 modules，仅原有大 chunk warning |
| `npm test -- src/test/u_r2_trace.test.ts src/test/w_2_arcana_submission.test.ts src/test/b_2_throwing.test.ts src/test/scroll_effects.test.ts` | 4 文件、67 测试通过 |
| `npm run test:drift` | 初次和最终复跑均为 1 文件、1 测试通过 |
| `npm test` | 初次完整运行：187 文件通过，3,629 通过、8 跳过、5 todo；耗时 1,240 秒。最终复跑见下 |

全量测试覆盖 R∪S、p1_30、U24、U01/U03、U27、UR1、W-2…26、b_*、scroll_effects、投掷及读源码守卫；漂移测试单独运行。未重捕生成基线。`git diff --check` 通过；新增/修改文件均为 LF，无 CRLF。未暂存或提交。

## 最终复跑

最终生产代码及扩展 trace 固定后再次运行：`npm run build` 退出 0；`npm run test:drift` 1/1 通过；完整 `npm test` **187/187 文件通过、3,629 测试通过、8 跳过、5 todo**，退出 0，耗时 1,197.16 秒。全程未中止。

## 验收方备注

`u-r2-trace.json` 是重构前 Game 的逐步状态快照，属黄金夹具。**后续轮次若按 CE 正当改变物品/魔法行为使其翻红，应单变量归因后用 `scripts/ur2-capture-baseline.py` 的同法重录，并在报告登记；不得视作 UR2 回归而回退行为。**
