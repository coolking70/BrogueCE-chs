# X2i：发现概率与详情语义

基准：2026-09-27，按任务书 §0 指向的 X-1 §4 N06、§3 K12/K26/K41、§7.1，权威对照为本工作树 `BrogueCE-master`。本轮未提交 git，未改变 `test:drift` 或深层基线。

## 实施与 CE 对照

| 可见声称或公式 | CE / 实际出口 | 本轮结果与断言 |
|---|---|---|
| 发现屏未知种类概率 | CE `IO.c printDiscoveries` 用未知种类频率作每类分母；本项目地面普通抽取与机器无 ID 抽取均读取 `ItemLoader.genPotions` | `consumables.json` 对地衣药水标记 `excludeFromGeneration`，移除 `Game.ts` 两处分散的 D2 过滤。发现屏沿用同一 `genPotions`，分子、分母和列表都排除该种。`x2i_discovery_text` 逐项核对集合及 `floor(100 × frequency / denominator)`。CE 原生 `POTION_LICHEN` 频率 7，但 web 地衣效果仍为 stub；继续退池是已登记的 CE 偏差，回池须先实现载体。显式指定 ID 的机器物品不属于随机种类概率公式。 |
| `MA_HIT_BURN` 点燃 | CE `Combat.c:450–454,1403` 命中且目标存活时 `exposeCreatureToFire`；web 已有该火焰入口 | 将五个真实怪物近战出口接入既有火焰函数，保留火免、灭火地形和燃烧计时。新测试以真实 `takeTurn` 命中验证点火与免疫，详情声称保留。 |
| `MA_HIT_STEAL_FLEE` 偷物 | CE `Combat.c:456–510` 搬出非装备物品、赋予携带物并永久逃跑；web 只在造成伤害时设置 `FLEEING` | 详情改为“攻击造成伤害后会逃跑”，移除虚假的抢物日志；猴子和恶魔的说明也不再声称已经偷走物品。没有在缺少完整搬物/堆叠/携带链时伪造 CE 盗窃。新测试检查可见详情。 |
| `MONST_SUBMERGES` 潜水 | CE 有 `MB_SUBMERGED` 状态和对应时序；web 未实现该载体 | 详情不再宣称可以潜入水中，保留数据旗标以供后续原生效果任务使用。新测试检查其不出现在详情。 |
| 回放 OOS | `Game.failReplayEvent` 的拼接英文原样送日志和回放控件 | `replayError` 保持诊断字段，以免改变既有记录守卫；新增经 i18n 的 `replayErrorDisplay`，日志和控件只显示该中文。状态、终局、其他失败分别用中文原因。新测试制造真实 checkpoint 不同步，核对日志和 UI 字段无英文字母。 |
| 动态英文门 | 原 `findHardcodedLogStrings` 仅识别 `logger.log` 首参的直接字面量 | 扩展为追踪近处 `const` 字符串模板到 `logger.log(variable)`；仍跳过 `i18next.t` 的结果。新测试用 OOS 模板反例与已翻译变量正例。扫描范围有意限制在局部不可变赋值，避免跨函数同名变量误报。 |

`DetailGenerator` 的其余能力声明已逐项反查执行口：命中状态/腐蚀/吸血与战斗、几何攻击与 `Monster`、召唤/寄宿与 `Game`、反射/免疫与法术/伤害、移动与 `Monster`/寻路、否定/变形与对应效果模块。装备符文、戒指和护符公式沿用现有 `Combat`、`RingBonuses`、`CharmModel`、`ItemUseCoordinator` 消费路径；本轮没有为了文本修改其数值模型。上述核对不宣称 web 已实现完整 CE 盗窃、潜水或逐骰生成。

## 旧断言裁决记录

首次定向测试在原断言下显示 `Discoveries.test.ts` 只差药水行数：旧预期 15，实际合格池 14。反事实原因可由数据直接验证：`potion_of_creeping_death` 原先仅在 `Game.ts` 两处分散过滤，而发现屏仍包含它。该旧计数只覆盖旧规则；本轮只把预期 15 改为 14，保留其余分类、命名、已知状态与百分比断言，并另加“发现集合 = 实际生成池集合”的断言。全量运行又在 `invented_content_pool.test.ts` 暴露同一旧前提：`CE_PENDING_POTIONS` 只列黑暗药水，按旧清单计算池大小。仅将地衣药水列入清单，保留逐项标记、池排除和大小公式守卫。两项前提更新提交验收方裁决。首次定向测试另一失败是删除虚假抢物消息后的死 i18n 键，已按原 i18n 守卫要求归档至 `zh_CN.legacy.json`，未改守卫。

## 回归与交付

- 反查包含 `p1_30_i18n_gate`、`p1_37_machine_flag_i18n`、`u24_hardcoded_text`、`Discoveries.test`、`DetailGenerator.test`、`ui_*`、`i18n_scan` 及读源码测试；完整 `npm test` 是 R∪S 的超集（漂移单独运行）。
- 黄金 `u_r3_trace` 曾翻红。单变量反事实：只将 `monsters.json` 的猴子、恶魔两条说明暂时恢复旧文本，其他 X2i 改动不变，原 fixture 比对 1/1 通过。恢复最终说明后，用原测试 `UR3_CAPTURE=1` 方法重录 `u-r3-trace.json.gz`；旧 SHA-256 `776c713c…e2566e1`，新 SHA-256 `9a2a552f…0585f54`。普通比对复跑 1/1 通过。变动是快照保存的说明文本，不以此宣称生成机制漂移；`generation_baseline` 未修改。
- 定向测试：X2i 两文件、发现屏、i18n 门与命中归属已通过。最终完整复跑 `npm test -- --maxWorkers=4 --reporter=dot` 退出 0：**209/209 文件通过，3874 项通过、8 跳过、5 待办**，耗时 2433.13 秒；含 `u_r3_trace`、`u_26a_deep_baseline`、`u24_hardcoded_text` 与全部源码守卫。随后复跑 `npm run build` 退出 0，`npm run test:drift` 1/1 通过（32.81 秒），均针对最终代码与 trace 夹具。
- `git diff --check` 通过；变更文本无 CRLF；未修改深层基线，未提交 git。
\n
## 验收方合并记录

本轮入场（`9ebe9cab`）早于 X2g（`4ab80204`）。X2g 已闭合地衣链与 MB_SUBMERGED，并按 CE 将 creeping_death/darkness 回池。合并时凡 X2g 已实现者以 X2g 为准：
- `consumables.json` 不加 creeping_death 的 `excludeFromGeneration`；`Discoveries.test` 药水 16 种、`invented_content_pool` 待补清单为空（取 X2g）。
- `DetailGenerator` 恢复 `MONST_SUBMERGES: 可以潜入水中`（有 X2g 执行出口）；x2i 专项对应断言改为"须出现"，lichen 入池断言翻正；"发现集合 = 生成池集合"核心断言保留。
- `Monster.ts` 三处近战：保留 X2g 的 `{ grid }` 参数并接入本轮 MA_HIT_BURN 点火；`exposeCreatureToFire` 改 public 并保留 X2g 的潜没豁免。
- 偷窃详情暂保留本轮"攻击造成伤害后会逃跑"，待 X2j 实现完整 CE 盗窃后恢复声称。
- UR3 trace：夹具置回 HEAD，合并后代码不符；仅撤回 `monsters.json` 两条说明 → HEAD 夹具通过（单变量）；以 `UR3_CAPTURE=1` 重录并复验。相关 7 文件 51/51。
