# X2f 投掷伤害数学按 CE

## 规格与 CE 核对

依据 `ai_docs/reports/x-1-survey.report.md` §4 N08、§7.1。逐行核对 `../BrogueCE-master/src/brogue/Items.c:6771-6862`、`Combat.c:116-157`、`Math.c:34-59`、`Items.c:8498-8512`：

- 投掷走 `attackHit`：STUCK、PARALYZED、CAPTIVE 真短路，不耗命中骰；slaying 对应类别与 seized/seizing 是命中率 100，仍耗一次 `rand_percent`。睡眠和游荡不构成投掷自动命中或偷袭倍率。命中前解除 entrancement、调整追踪状态。
- 命中后，免疫武器或无敌先将伤害置 0，不调用 `randClump`。否则用投掷物实例 `damage.lowerBound/upperBound/clumpFactor` 掷骰，再计算 `randClump * damageFraction(netEnchant(item)) / 65536`，C 整数除法向零截断。投掷不复用近战的“先缩放上下界再掷骰”顺序，也没有近战 ×3/×5 偷袭倍率。
- CE 只在受害者是玩家时以 `melee=false` 调护甲符文；web 目前只有玩家投掷武器的运行时入口，此分支不在该入口触发。护甲符文现有 `Game.tryTriggerArmorRunic(..., false, false)` 语义与测试保持原样。命中后先伤害，幸存目标才进入武器符文分支。

## 修改

- `src/engine/Combat/Combat.ts`：投掷伤害使用保存的 `item.clumping`，旧实例缺失时回退解析值；改为 CE 截断；slaying 类别及 seized/seizing 命中率 100 仍掷命中骰。近战端点和投掷伤害共同调用 `enchantedDamage`，分别保持各自 CE 计算次序。
- `src/engine/Combat/CombatFormulas.ts`：新增唯一的整数附魔伤害缩放函数，避免近战与投掷复制取整公式。
- `src/test/x2f_thrown_math.test.ts`：实战路径逐组合检查投掷伤害分布、每次骰子参数和调用次数；另测 miss、自动命中、免疫/无敌和 slaying 的短路耗骰。

## CE 黄金值

`ai_docs/reports/x2f-evidence/compile-original.py` 从 CE `Items.c` 原样抽取完整 `hitMonsterWithProjectileWeapon`，连同 U13 已编译核对的 CE `randClump`、`damageFraction`、`netEnchant`、`attackHit` 等原函数，使用最小 UI/世界副作用桩编译执行。生成的 C 翻译单元为 `ce-thrown-original.c`，运行输出为 `original-output.txt`。7 组武器区间、实例 clump、附魔、力量组合的全部离散分布与 `ce-thrown.json` 黄金值一致（包括每组合的 RNG 骰数）；JS 实战测试逐组合复核该 JSON。实例 `3..11/clump=3/enchant=10/strength=12` 的 48 种骰面组合分布为 `5:1, 7:3, 9:6, 11:9, 13:10, 15:9, 16:6, 18:3, 20:1`，每次恰好 3 个伤害骰；同区间 clump=1 只耗 1 骰。常量 `7..7` 不耗伤害骰。C 桩隔离的是 UI/世界副作用，保留原命中和伤害分支。

## 反查与门禁

反查闭包含 `p1_30_i18n_gate`、`u24_hardcoded_text`、`u_13_combat_math`、`u_15d_weapon_runic`、`u_15d2_armor_runic`、`b_2_throwing`、`u_r2_trace`、`CombatFormulas`，并由全量 `npm test` 收集其他源码守卫。未改 `test:drift`、深层基线或既有守卫。生成侧和 trace 录制文件未改；UR2 若通过则无需重录。

- C 原函数夹具：7/7 分布一致。
- 定向 `x2f_thrown_math`、`u_13_combat_math`：通过。
- `npm run build`：通过。
- `npm run test:drift -- --reporter=dot`：1/1 通过。
- 全量 `npm test -- --reporter=dot --silent` 最终复跑：205/205 文件通过，3856 通过、8 跳过、5 待办、0 失败；完整运行 1101.59 秒。日志见 `x2f-evidence/final-npm-test.txt`。

最终复跑声明：所有代码和测试编辑完成后，依次重跑 C 原函数夹具（7/7）、定向 X2f（9/9）、生产 build、test:drift（1/1）及完整 npm test（205/205 文件）；没有用定向结果拼接全量统计。未重录 UR2 trace，原 trace 在全量套件中通过。未提交 git。新增文本文件与改动源码均为 LF。
