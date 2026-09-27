# X2l：玩家直接 bolt 反射致死

## CE 对照与范围

- 权威入口：`x-1-survey.report.md` §4 N10、§7.1。复核 `BrogueCE-master/src/brogue/Items.c:5131–5219`：`BE_DAMAGE` 在 `inflictDamage` 杀死玩家后，玩家施法者使用 `Killed by a reflected %s`，随即设置 `terminateBolt` 并返回；死亡格的火焰/电击、幸存者效果及后续穿透目标都不再处理。`%s` 取 CE bolt 目录名，FIRE 为 `flame`、LIGHTNING 为 `lightning`，不是物品名称。
- 怪物法伤由原施法怪物归因，即使路径发生反射也不归给反射者。毒法杖的反射接触仅施加中毒，后续毒伤死亡仍按毒伤归因；投掷药水的爆炸由地形瞬时伤害入口处理，不伪装成反射 bolt。
- 玩家即时法伤经过 `Game.applyDirectBoltDamage`（火、闪电，包括既有法杖/魔杖入口）；怪物法伤经过 `Game.applyMonsterBoltHit`。两者现在调用同一 `finishLethalBoltHit`，立即完成死因和结局结算。玩家逐格 travel 回调在死亡时返回 `false`，并跳过死亡格地形及后续目标；怪物回调复用同一停止判据。玩家物品动作及 `playerTurnEnded` 不再于已经结局后继续推进。
- 新死因中文使用本地化的“火焰/闪电”，英文保持 CE 的 `Killed by a reflected flame/lightning`。`triggerGameOver` 统一负责录像结局 checkpoint、高分描述和 U26b 分数。

## 反查与验证

- 新增 `src/test/x2l_reflected_death.test.ts`：保证反射、实际玩家命中、死亡格停止、穿透线后方怪物无伤、死亡格草不着火、CE 英文死因、立即结局与分数。两种法杖分别覆盖非穿透火与穿透闪电。
- 直接回归：`x2l_reflected_death`、`u_06_monster_damage`、`u24_hardcoded_text` 共 3 文件、42 项通过。全量集合包含 `p1_30_i18n_gate`、`p1_24_death_sink`、`u_26b_endgame`、`u_27_recording`、`u_r2_trace`、`u_r3_trace`、`w_2…w_26` 的 bolt/反射关联文件及全部读源码守卫。
- 最终 `npm run build` 退出 0；`npm run test:drift` 1/1 通过。未改 drift/深层基线与黄金 trace；本次没有重录。改动的 TS/JSON/Markdown 文件 CRLF 数为 0，`git diff --check` 无报错。
- 完整 `npm test -- --maxWorkers=8 --reporter=dot` 退出 0：**211/211 文件通过，3893 项通过、8 skipped、5 todo**，耗时 1603.77 秒。只限制并发和报告器，未筛选正常测试文件；既有 `generation_baseline` 由原 `test:drift` 单独执行。

## 最终复跑声明

最终源码及新测试固定后，于 2026-09-27 11:46:36–12:13:20 CST 完整执行上述 `npm test`，没有中止、筛选测试文件或修改测试排除规则。随后只补写本报告的验收统计，未改产品源码、测试或基线。`build`、`test:drift` 均针对同一最终源码通过；未提交 git。
