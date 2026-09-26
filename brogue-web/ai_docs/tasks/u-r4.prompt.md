# UR4：Game.ts 拆分——时间/环境协调（纯重构，不改行为）

> **本地执行（Windows 轨）。X-0 路线 UR 系列（UR1/UR2 已合并；UR3 生成生命周期因与 U19 回池轮冲突暂缓）。X-0 标注为"预计最大红面"。**

## 0. 规格

**`ai_docs/reports/x-0-survey.report.md` UR 表的 UR4 行是权威规格**（`153dbb5`）：

> **UR4 时间/环境协调最后拆**｜在状态合同、U03/U14/U17 稳定后抽 A12/A14；**用显式 World/Clock/Effects 端口，不把整 Game as any 传入**｜
> **验收**：p2_1/2/3/4 原客观时间/速度/动画轨迹；f/g/W 状态、死亡/下坠；**连续与动画分帧推进一致，逐客观块的事件顺序/完整状态/两流相等**｜
> **风险**：playerTurnEnded/advancementLoop/objectiveTimeBlock 等私有包装先留；Monster 生产回调改窄接口；输入锁、异常中断、回调 bind 和计时尤甚

## 1. 范围

- 从 Game.ts 抽出回合推进/客观时间块/环境更新（火、气体、晋升、地面物品、饥饿/回血/状态递减的调度）协调层，经显式 World/Clock/Effects 端口依赖注入
- Game 保留 playerTurnEnded/advancementLoop/objectiveTimeBlock 等私有包装与 `this` 语义；U17a 的 DF 端口绑定生命周期不变
- **零行为变化**：事件顺序、RNG 调用次数与顺序、tick、动画分帧一律不变
- 验收：固定种子 + U27 命令日志，覆盖行走、休息、搜索、火/气体扩散、坠落、死亡、加速/减速、动画开/关，
  重构前后逐客观块 trace（完整实体/地形状态、日志、tick、两流 RNG state/count）逐字段相等；前后 trace 录制方法同 UR2（先装回 HEAD 录旧 trace）
- 源码读取守卫指向旧位置：**迁到新实际实现，不删除、不放宽**；`u-r2-trace.json` 若因搬家以外原因变化即为回归

## 2. 约束

📌 **撞上守卫时改代码，不改守卫**；**不得改变 test:drift**；
**反查闭包含 p1_30、U24、U01/U03、U17a–f、U27、UR1/UR2、p2_*、f_*、g_*、W 系列、c_5 坠落与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 `npm test` 完整跑完**；最终复跑声明。报告 `ai_docs/reports/u-r4.report.md`（含 Game.ts 行数前后对比）。
