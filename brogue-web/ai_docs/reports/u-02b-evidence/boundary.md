# U02b 冻结的合同与两份清单

规格：u-02b.prompt.md，X-0 §4.1/§4.2 U02/§3.1 K04，U02a §6；CE 原文优先。

## 预计改义断言（仅这些有意修改）

1. U02a 的三个高位 seed 与低位同流、一个高低位世界相同的断言改为不同；两个 expect 表达式展开四用例。CE 提取 C 的 9 组黄金 tuple/64 位抽取/41 槽表独立负责证明新算法正确，不以“不相等”替代 CE 证明。
2. B-1b/U10/P4-3/U06/U08/W5/W7/W8/W24/W25 的零起点夹具显式 resetCounters；所有既有 expect 表达式不变。V-9c/F2a显式给合成origin/机制种子，覆盖样本保留原seed并追加连续1…32。非零计数无损恢复仍由 U02a 完整快照逐字段续跑和 U02b 混合 rand64bits 续抽负责。
3. P1-35 T9 显式重建之前恢复最初构建 waypoint 的输入 RNG；所有既有 expect 不变，包括覆盖越界 sentinel、非空和坐标相等。读档后不能用已经回切的 gameplay RNG 重新推导原层 waypoint。
4. generation_baseline 的 4 seeds × D1–D26、四字段值允许在 a/b/c/d 归因完成之后重捕一次。测试源码、字段口径与 seed 集不变。
5. 新增 U02b 专项（22项）：高/低位、两流和计数、层表/预抽拒绝采样、两种零 seed、oldSeed 回切、重访、失败回切、元数据 JSON/拒旧、不同动作/耗骰与后层地形隔离。新增正反证据脚本。

## 只回归、不可放宽

- Random.test.ts 的 1000 次黄金序列、简并区间及其他范围/概率/clump/roll/shuffle算法；CE ranval、range、消费次序。
- U02a 除上述高位旧语义之外的完整状态/续跑/录像/输入检验；U00 新局全入口同态、U01 实例所有权/字段闭包。
- P1-31/35 落位/loopMap/气味；P4-10 waypoint 的覆盖、距离、AI消费者；W-13 掘地消费。
- 所有 R∪S 的战斗、怪物、状态、时间、环境、生成连通/机器落位/唯一性等既有期望；i18n 扫描器、源码读取守卫原文不变。
- 明确文件清单与直接/间接消费者见 closure.json；原文不变与 expect AST 审计见 audit.json。

## 本轮文件边界

生产：Random.ts、Core/Game.ts、新 Core/LevelSeeds.ts、Map/WaypointMap.ts、App.vue 的存档摘要验证。测试前提文件见audit.json的15文件清单、新 u_02b_level_rng.test.ts，以及归因后的基线 JSON。其余为 scripts/u02b-*、progress.md、本报告与证据。

不扩 CE40 可玩层（web 仍 D1–D26）；不做旧档迁移、不做 U03 跨层世界/计量/队列存档。CE 41 个元数据槽真实分配和交错抽取；预抽坐标不冒充已对齐的实际楼梯位置。颜色洗牌、50/100 环境预热与完整 stair retry 生命周期留后续，详见报告逐骰差异表。

## 等待用户裁决的三处期望

C5旧生成固定11935；W13直接waypoint零消耗；C4b精确白名单缺8组合法组合。真实测试原文未改；临时草案3项验证通过。此三项不列入本轮自动授权修改期望，待任务书§5裁决。
