# UR3：Game.ts 拆分——生成/层生命周期协调（纯重构，不改行为）

> **本地执行（Windows 轨）。X-0 路线 UR 系列（UR1/UR2/UR4 已合并）。U19 回池轮已全部结束。**

## 0. 规格

**`ai_docs/reports/x-0-survey.report.md` UR 表的 UR3 行是权威规格**（`153dbb5`）：

> **UR3 生成/层生命周期协调**｜U04/U05 稳定后抽 A1/A2 生成协调与 LevelState，**明确 BlueprintEngine 指令产物到实体的事务**；Game 只接管当前层｜
> **验收**：同一 seed 逐深度生成的地形/机器/物品/怪物/两流 state 指纹**逐位相等**；**原 generation_baseline 不重采**；c/p1/V/B2 全生成安全守卫；重访/保存夹具等价｜
> **风险**：generateDepth/populate 相关 harness、machineCells 白名单、全局初始化易红；**高撞红面，不与任何回池轮同时进行**

## 1. 范围

- 从 Game.ts 抽出 generateDepth / populateLevel / 层切换（新层、重访、坠落入层）/ U19c 实体 adapter 与机器实体事务 / 楼梯落位 / 环境预热 的协调层，
  显式依赖注入（不传整个 Game）；Game 保留原方法包装与 `this` 语义
- **零行为变化**：同 seed 逐深度指纹、完整实体图、两流 RNG state/count、U25 观测记录逐位相等
- 验收：重构前后（先装回 HEAD 录制，方法同 UR2/UR4）对 4 个 drift seed × D1–26 及若干重访/存读/坠落夹具做完整状态 trace 对比；`generation_baseline.json` 不改
- 源码读取守卫指向旧位置：**迁到新实际实现，不删除、不放宽**；machineCells 白名单同理

## 2. 约束

📌 **撞上守卫时改代码，不改守卫**；**不得改变 test:drift 与 generation_baseline**；
**反查闭包含 p1_30、U24、U00/U01/U03/U03b、U04c、U05a、U17a–f、U19a–f、U25、U27、UR1/UR2/UR4、c_*、p1_*、V 系列、b2、blueprint_center 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/u-r3.report.md`（含 Game.ts 行数前后对比）。
