# UR1：Game.ts 拆分第一步——实体编解码与数据投影（纯重构，不改行为）

> **本地执行（Windows 轨）。X-0 路线 UR 系列第一轮。Game.ts 当前约 11.4k 行。**

## 0. 规格

**`ai_docs/reports/x-0-survey.report.md` UR 表的 UR1 行是权威规格**（`153dbb5`）：

> **UR1 编解码和明确数据投影**｜U01 后从 A13 抽 Item/Monster codecs 与 DTO，Game 保留当前方法包装；先把所需种类信息/构造函数/ID 分配显式注入｜
> **验收**：同一输入新旧 codec 逐字段等价；toSnapshot 去掉 savedAt 后深比较；旧 fixture、普通/特例/休眠/关系循环；构造前后两流 state/count 相同｜
> **风险**：现有 serializeMonster 等入口保持签名和 this 语义；snapshotQuantity、b_1b、p1_31_35、W-16…23；**不得以"序列化本应如此"为由顺便改字段**

## 1. 范围

- 把 Game.ts 中整局/层/实体快照的编解码（toSnapshot/loadSnapshot 及其 Item/Monster/Player/Level 投影、DTO 类型）抽到独立模块
  （可与既有 `EntitySnapshot.ts`、`LevelSnapshot.ts` 合并/扩展），依赖（种类表、构造函数、ID 分配、RNG）显式注入，不传整个 Game
- Game 保留原公开/私有方法作薄包装，签名与 `this` 语义不变
- **零行为变化**：字段集合、顺序、默认值、错误信息一律不改；U01/U03 字段合同 json 不改
- 验收：新旧 codec 在一组覆盖夹具（普通局、多层已访问、休眠怪、携物怪、盟友关系、机器钥匙、坠落队列、U27 录像态）上逐字段等价；
  toSnapshot（去 savedAt）深比较相等；编解码前后两条 RNG 流 state/count 不变
- 源码读取守卫若指向旧位置：**迁到新实际实现，不删除、不放宽**

## 2. 约束

📌 **撞上守卫时改代码，不改守卫**；守卫前提若仅因"代码搬家"失效，先反事实证明再迁移前提、交验收方裁决；
**不得改变 test:drift**；**反查闭包含 p1_30、U24、U00/U01/U03/U03b、U27、snapshotQuantity、b_1b、p1_31_35、W-16…23 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；最终复跑声明。报告 `ai_docs/reports/u-r1.report.md`（含 Game.ts 行数前后对比）。
