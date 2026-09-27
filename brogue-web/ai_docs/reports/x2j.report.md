# X2j：偷窃搬物、永久逃跑、普通怪状态转换与 blink 缓存

任务：`ai_docs/tasks/x2j.prompt.md`，权威边界为 X-1 §4 N10、§7.1；事实来源为仓库内 `BrogueCE-master/src/brogue`。入场 HEAD `ea568b5a8b1d100042b52b8cc122759205a2a544`，工作树干净。本轮只处理 AI 单元及其携物出口，不把 X2 的死亡时序、玩家自反射致死等其他单元宣称为已完成。未暂存、未提交。

实现与终验已完成，全部门禁通过。五处旧守卫前提修订附反事实证据，留验收方裁决，详见 §3。

## 1. CE 核对与实现

| CE 事实 | 本轮实现与边界 |
|---|---|
| `Combat.c:456–524 specialHit`：存活玩家受击；攻击者无携物、背包非空、未混乱、没有对应免疫护甲，然后另做一次 `attackHit`。伤害为 0 也可偷。 | 新 `MonsterTheft.ts`，由 `CombatSystem.attack` 的成功且双方存活分支统一调用。几何近战也经过同一出口，删除两处仅改状态和输出假偷窃消息的分支。二次命中使用既有命中公式，麻痹/纠缠短路与抓取 100% 口径沿用 CE。 |
| 从未装备的包内条目等概率选物，按条目而非数量加权。武器堆 ≤3 全偷，>3 偷 `(q+1)/2` 向下取整；其他品类只偷 1。 | 同时排除武器、护甲、左右戒指引用和 `ITEM_EQUIPPED`。完整搬走原实例；拆堆复制全部 Item 合同字段、保留新实例 ID，原堆扣量。CE 拆堆先调用 `generateItem(ALL_ITEMS,-1)`，本轮通过 web 既有分类权重/种类和实例分配器执行运行期分配，再覆盖字段；包括 GOLD，不调用楼层物品分配器。 |
| 清除 `ITEM_PLAYER_AVOIDS`，设置 `carriedItem`、`MODE_PERM_FLEEING`、`MONSTER_FLEEING`；消息指向实际偷到的物品，停止自动探索。 | 实际背包 → 怪物所有权转移；消息含真实数量和名称，调度出口中止 `autoPath`/鼠标寻路。web 没有 CE `rogue.swappedIn/swappedOut`，没有新增无消费者的占位字段。 |
| `Monsters.c:4074 makeMonsterDropItem`；`Combat.c:1959` 死亡、`Monsters.c:3353` 俘虏、`:1940–1946` 盟友 discord 消退等出口。 | 提取 `Game.makeMonsterDropItem`，复用已有合格近邻落点与最终物品落点回退；死亡、俘虏、归顺和盟友 discord 消退接入同一出口，清携物指针并触发落物地形晋升。死亡仍由现有收口时点负责，不声称改成完整 CE 即时死亡时序。 |
| `Monsters.c:1591–1827` 的 alert/wake/update，及 `:2956 monsterFleesFrom`。 | 新 `MonsterAI.ts` 保留原分支次序；在睡眠/施法/普通移动前更新状态；唤醒消耗该次行动，队友仅 NORMAL 模式参与，醒后再计算队友状态。补入最后见到玩家的位置及向最近 waypoint 游荡。恐惧来源检查敌我攻击意愿、距离、可通行路径及射线遮挡。 |
| `Items.c:5193/6793` 的永久逃跑排除。 | 玩家/怪物两条伤害 bolt 路径及投掷武器前置激怒均排除 PERM。投掷 miss 不通过被排除的激怒分支缩短恐惧；投掷命中后的存活 `moralAttack` 语义仍缩短恐惧，bolt 存活受击也保留该效果。 |

### 状态转换按 CE 的真实优先级

`ALWAYS_HUNTING` 首先强制追踪并返回；非盟友 immobile 随感知在睡眠/追踪间切换。它们优先于 PERM 转换，不能把“永久逃跑”解释为压过所有 CE 特殊分支。普通 PERM 的 WANDERING/HUNTING 转 FLEEING；随后计算最近可攻击自己的恐惧对象。

游荡且感知到玩家则 alert；睡眠感知用已有 `awareOfTarget` 的 25% 掷骰唤醒；追踪失去感知则游荡到最后见到玩家处；追踪且恐惧对象距离 <3 则逃跑。`MONST_FLEES_NEAR_DEATH` 在 HP ≤ floor(maxHP/4) 进入逃跑，已经逃跑时在 HP ≤ floor(3×maxHP/4) 保持。100 HP 的边界为 25 进入、75 保持、76 才可恢复，不能只照抄末尾一个 `>=75%` 分支而忽略前面的保留分支。

NORMAL 逃跑在没有魔法恐惧、最近恐惧对象距离 ≥3 时恢复；永久偷窃怪只有无携物且无魔法恐惧时才进入对应 mode 恢复分支，仍受前面分支优先级约束。盟友在 web 以 `isAlly` 独立存储，映射回现有 U12a/b 流程。`monsterFleesFrom` 包括移动的武器免疫/无敌敌人、盟友祭品目标、保持距离、kamikaze 和已中足量致命毒的目标；攻击意愿按 CE 原次序处理 entrancement、俘虏、discord 和 confusion。

**视野外没有 CE“猴子消失/自动逃离楼层”的分支。** 偷窃后的猴子继续在当前怪物集合里行动、携物和逃跑；本轮没有添加离屏删除。失去物品后恢复 mode 是另一条件，不能拿离屏替代。楼层生成、怪物初始状态与数量、自然池、waypoint 生成算法均未改。

### 缓存与存档

`Monsters.c:2108–2117` 的 `target.mapToMe` 属于目标，首次建立；只有目标当前位置在旧图中的距离 >3 才重建。地形变化或另一个追逐者不会立即使其失效，本轮保留这项历史性。`mapToMe` 加入 Creature 快照，克隆清空，离层清空当前怪物的该图（`RogueMain.c:630–635`）。

安全地形图和盟友安全图共用 `Game.monsterPathCache`，blink 和已有逃离危险地形消费者共用惰性缓存。**CE `Time.c:2616–2618` 在每个玩家行动开始重置，不是每个 100 tick 客观块重置。** 换层、新局也清空。缓存及 `lastSeenPlayerAt` 加入已有 U01/U03 序列化合同，保存后继续使用原图；旧档缺字段时取空值。U10 已实现的学习/吸收入口继续使用既有流程，本轮补的是缓存边界，没有另造学习渠道。

本轮没有扩展成整个移动 AI、`monsterAvoids` 或生成 RNG 的全量 CE 同构移植；感知继续使用既有 ScentMap，路径准入复用 MonsterBlink/PlayerTravel 的现有地形合同。新状态分支的 CE oracle 将这些依赖作为受控输入，另有遮挡、感知、缓存和真实行动测试，不能把该 oracle 说成完整引擎逐骰一致。

## 2. 新验证与故障注入

`src/test/x2j_monster_ai.test.ts` 增加 38 项：六种拆堆边界、装备排除、二次命中与零伤害、混乱/携物/死亡/免疫等拒绝、真实下一步存读一致、死亡/俘虏/归顺/discord 落物并拾取、唤醒耗时和队友、状态优先级、25/75% 阈值、最后位置、恐惧路径、自动寻路中止、视野外 PERM、两种共享缓存及目标缓存、投掷和两个 bolt 出口。

`scripts/x2j-ce-oracle.py` 直接提取并编译原 CE `updateMonsterState` 函数，函数体未改；状态×mode×标志×恐惧×偷窃能力×携物×感知×HP×恐惧距离共 **10,240** 组合。比较 state、mode、最后看见位置和 tick。依赖的感知、恐惧路径、wake helper 在 C harness 中控制，范围写在 [ce-oracle.json](x2j-evidence/ce-oracle.json)，原函数 SHA-256 为 `a613e1590503a7632478df9b4c604fa6dd4ab3fa121f7ca67500a0b91cd778ca`。不是用 TS 重写一遍同一算法当 oracle。

[故障注入汇总](x2j-evidence/negative-summary.json)：14 个变体全部被检出，共 25 个失败断言。包括禁偷、允许偷装备、拆量错误、省略二次命中、忘记 PERM、错误恢复逃跑、漏存最后位置、每次重建目标/安全缓存、两个受击门缺 PERM，以及删除感知/气味导航、记住 waypoint 时错误提前消耗初始化 RNG。故障只通过 Vitest transform 注入，不改工作树生产文件；脚本 `x2j-negative.mjs` 可复跑。

## 3. 旧守卫前提提案，留验收方裁决

先用入场 HEAD 的独立源码副本运行原 P4-8/P4-9/U07：**75/75**；原 W18 唤醒项 **1/1**。候选撞红后先修生产代码中裸 Game 夹具缺缓存初始化的问题，再处理以下确实依赖旧规则的前提。原文件保存在 evidence 的 `.test.ts.txt` 中，不会被 Vitest 再收集。

| 文件 | 旧前提与反事实 | 仅修改的前提 |
|---|---|---|
| P4-9 | 半血普通 rat 被手写 FLEEING，旧逻辑持续逃跑；CE NORMAL、无恐惧、无近敌，应立即恢复。 | 逃跑夹具补 `MONST_FLEES_NEAR_DEATH`，使半血满足 CE 的既有逃跑保留条件。 |
| U07 | 若干 imp 夹具同时设 ALWAYS_HUNTING 和逃跑/游荡；旧实现晚更新状态，测试会进入本不该进入的 blink 分支。 | 对专测逃跑/游荡的夹具删除 ALWAYS_HUNTING；逃跑加入实际魔法恐惧。30% gate 夹具明确不可见，排除额外感知掷骰。 |
| P4-8 T5 | 旧 40 seed 成功率校准没有“最后见到位置 → waypoint”的方向信息；新增记忆后 27/40，超出旧 ≤16 的断言。 | 将玩家终点在所有 waypoint 图中的值设为 30000，明确该点没有可选近 waypoint，隔离旧气味/游荡样本；没有改 seed、次数、上下界或性质断言。新的记忆追踪另由 X2j 守卫覆盖。 |
| W18 唤醒 | 旧入口直接令队友 HUNTING；CE wakeUp 会调用 updateMonsterState，原 `(15,8)` 的队友在当前潜行环境下已超硬感知范围，因此醒后 WANDERING。 | 队友移动到 `(6,6)`，在感知范围内且不拦截玩家到主目标的 bolt；其余状态、tick 和盟友断言原样。 |

另外，完整门禁发现 U19f CE55 的旧操作路线结束时仍留下一只地虫（ID 343，HP 80，WANDERING，`lastSeenPlayerAt=null`）；原 HEAD 同文件 **3/3** 通过。CE 的游荡感知不保证旧路线能吸引全部地虫，因此“取宝并返回入口”不等于原守卫要求的“原住怪全清”。先以原夹具执行再追加 **155 条真实追击/攻击操作**，该虫死亡、剩余原住怪为 0，见 [追击诊断](x2j-evidence/u19f-pursuit.json)和 [HEAD 结果](x2j-evidence/u19f-head.json)。只在 `fixtures/u19f-machine-actions.ts` 中补了有上限的清怪操作及返回入口，没有改生成规则、怪物属性、伤害公式或 `u_19f_machines.test.ts` 的任何断言。新增正常操作会按原逻辑消耗 RNG，未直接改写 RNG 状态。该**第五处前提提案**同样留验收方裁决；原 helper 留存为 `original-u19f-machine-actions.ts.txt`。

[原 HEAD 结果](x2j-evidence/premises-head.json)、[原 W18 结果](x2j-evidence/w18-head.json)、[候选失败](x2j-evidence/first-targeted.json)、[W18 候选失败](x2j-evidence/second-targeted.json)、[最终 P4-8 前提](x2j-evidence/scent-unreachable-premise.json)、[最终 W18 前提](x2j-evidence/w18-premise.json)。中间的 waypoint 重建/清空及每步清记忆尝试未保留；其日志不计最终门禁。

用 TypeScript AST 比对四文件所有 expect 调用链：[premise-assertions.json](x2j-evidence/premise-assertions.json) 为 **63+42+107+185 = 397 个表达式完全相同**。新增 run 字段在 `u03-state-contract.json` 登记，既有字段条目未改。

限制如实登记：P4-8 T5 单独不能杀死“`stepDirection` 恒返回 null”的变体；同文件未改的 T6 拐角追踪会失败，最终故障检查包含 T5/T6。T5 不能单独被称为气味导航充分性证明；它的概率上下界也不是完整新 AI 的自然追击成功率。没有为了故障注入结果修改原断言。

## 4. 自然交互与菜单存读档

自然种子 **20260927 / normal**，从 D1 新局开始，共 **117** 条正常操作到 D2；没有改地图、怪物、HP、背包或 RNG，仅关闭动画以便逐步核对。探索时遇到的 D1 俘虏猴子不算偷窃证据。完整操作在 [natural-actions.json](x2j-evidence/natural-actions.json)，浏览器复放与逐步校验在 [browser.json](x2j-evidence/browser.json)。

| 阶段（操作索引从 0 起） | 观察 |
|---|---|
| 107，偷窃 | 猴子从 15 支飞镖拆走 8 支，新实例 ID 54；背包剩 7，猴子 FLEEING/PERM，HP 12，玩家 HP 21/30。 |
| 108–110，追杀 | 猴子持续退走到 `(17,21)`，玩家追赶近战，猴子 HP 降到 5。 |
| 110 后，保存/刷新/继续 | 点击真实菜单保存；刷新页面并点继续。比较玩家、怪物、携物、背包和地面状态完全一致，然后继续原操作序列。 |
| 111–112，击杀 | 使用现有飞镖的投掷 UI 命令及地图落点，两次投掷击杀猴子。携带的 8 支飞镖落在 `(18,21)`。 |
| 113–116，取回 | 移动到落点并按拾取；背包合并为 13 支（原 15 减投出的 2），地面无重复遗留、怪物携物不重复。 |

移动/等待/上下楼/拾取使用实际键盘；投掷使用产品 `executeItemCommand('throw', item)` 加地图 `handleMouseTravel`，没有直接调用伤害或搬物函数。复放脚本 `scripts/x2j-browser.mjs` 在有头 Chromium 中执行，**0 页面/控制台错误**。已实际查看 [偷窃](x2j-evidence/browser-stolen.png)、[逃跑](x2j-evidence/browser-fleeing.png)、[读档](x2j-evidence/browser-restored.png)、[落物](x2j-evidence/browser-dropped.png)、[拾取](x2j-evidence/browser-recovered.png)和[背包](x2j-evidence/browser-inventory.png)截图。

按 develop-web-game 技能运行了标准 `web_game_playwright_client.js`，输出状态正常、记录两次输入；其 canvas 导出仍为已有黑图问题，未拿黑图当视觉通过，采用上述有头整页截图核验。浏览器脚本和本地服务只用于本任务。

## 5. 生成与黄金 trace

浅/深生成 fixture、三份 P2 baseline、生成守卫、package/vite 配置和 UR2 原字节不变，入场 SHA 见 [baseline-before.json](x2j-evidence/baseline-before.json)。运行期状态字段不在生成路径消耗 RNG；没有重新捕获浅层或深层基线。

`scripts/x2j-traces.mjs` 在三个条件下运行原 UR2/3/4 捕获逻辑：入场 HEAD、候选原样、候选仅在快照计算 hash/比较前投影掉新增 `mapToMe` / `lastSeenPlayerAt` / `monsterPathCache`。HEAD 三项均重现旧黄金；候选 UR2 差异 0，UR3 120 处 hash，UR4 60 处新增字段；**投影后全部差异 0**。仅移除新增序列化字段，保留候选的所有状态转换、RNG 和运行代码，未覆盖全局 `toSnapshot` 方法。见 `ur2/3/4-{head,projected,current}-diff.json` 与 [traces.txt](x2j-evidence/traces.txt)。

据此按原测试捕获入口 `UR3_CAPTURE=1`、`UR4_CAPTURE=1` 重录，两次均 1/1 通过；没有改 trace 测试或断言。UR2 未重录。[recapture.json](x2j-evidence/recapture.json) 登记完整命令和 SHA-256：

| 黄金文件 | 入场 SHA-256 | 本轮 SHA-256 |
|---|---|---|
| UR3 | `8a081c57d5ef8639f94ec3e74cb70f837205313a1c0c09bc955c53de7e5f184e` | `7560d9aa5ebd8eb96dd06dbc411ad354196fb37830b35031b55cf83246f33ffb` |
| UR4 | `06f44e788c9d91ba51a8ecbce632921a9a8b93fd4490a87c4930052aa663b06f` | `9b2232aee7c97a9945fc32d62442f465d98408407a471ae708f93b8c0bb44e8c` |

## 6. 最终门禁与复跑声明

**最终完整运行通过：2026-09-27 04:06:16–04:34:46 UTC（12:06:16–12:34:46 CST），209 文件、3924 通过、0 失败、8 既有跳过、5 既有 todo，1710.199 秒，退出码 0。** 见 [完整结果](x2j-evidence/full-clean-summary.json)及[完整日志](x2j-evidence/full-clean.txt)。

| 最终命令／检查 | 结果 |
|---|---|
| `npm run build` | 通过，18.551 秒 |
| `npm test -- --maxWorkers=6` | 完整跑完，209 文件、3924 通过、0 失败；记录保留 default/json 报告器参数 |
| `npm run test:drift -- --maxWorkers=1` | 1/1，通过，113.554 秒 |
| `npm test -- src/test/u_26a_deep_baseline.test.ts --maxWorkers=6` | 1/1，通过，174.262 秒；最终全量内也再次通过 |
| R∪S 与源码读取守卫 | 202/202 文件覆盖，66 个源码读取守卫零遗漏 |
| 冻结输入、受保护基线、LF、diff | 906 输入变化 0，基线变化 0，CRLF 0，`git diff --check` 通过 |

`x2j-audit.mjs` 反查生产修改种子的 TypeScript import/export 依赖：R 199 文件；S 包含 66 个源码读取守卫、106 个语义命中文件、26 个点名族文件；**R∪S 202 文件**。包含 p1_30、U24、U01/U03、U07、U10、U12a/b、U14a、U16、X2c、ai_*、p4_*、w_16/18/23。完整清单见 [closure.json](x2j-evidence/closure.json)；全量 npm test 与单独 drift 的逐文件结果共同核验零遗漏。

`x2j-validate.mjs` 固定 **906** 个输入（src/public/scripts、依赖与 Vite 配置、UR2/3/4 黄金、C oracle 数据）。构建、drift、独立深层与最终全量均使用这组相同输入，各自前后变化 0。第二轮与第三轮的输入清单逐项完全相同。最终原始记录为 `full-clean*`，`full-final*` 是它们的同字节交付别名，映射及 SHA 见 [delivery-records.json](x2j-evidence/delivery-records.json)。[最终交付检查](x2j-evidence/final-check.json)保留四项门禁的真实结果，退出码 0。

### 发现轮与修复归因

探索性全量运行发生在修改过程中，已主动取消，不计“全量跑完”。首次完整冻结门禁实际跑完：209 文件，3917 通过、6 失败、8 跳过、5 todo，1784.019 秒；905 输入变化 0。见 [首次完整结果](x2j-evidence/first-complete-full-final-summary.json)。其中三类问题修生产代码、原守卫不动：

- P1-30：旧 `combat.monkey_steals` 不再被引用，移入 `zh_CN.legacy.json`。
- AI-1 B1：`wanderToward` 原本应零骰，候选却提前做了 40 次 waypoint 惰性初始化。现只记录目标及已存在数组的访问标记；在真正开始游荡时沿用原初始化边界，再标记该目标未访问。没有把这 40 次骰移回生成期，也没有修改 AI-1 的零骰/零位移断言。新守卫检查记忆到首次游荡的完整链。
- W16 三项：裸 `Object.create(Game.prototype)` 缺 ScentMap，状态入口按真实尺寸惰性补齐；W16 夹具和断言原样。

剩余 U19f 一项按 §3 提供 HEAD/候选反事实后只补操作前提。随后 AI-1、P4-8/P4-10、W16、P1-30、U19f、X2j 共 **128/128** 通过，见 [settled-targeted.json](x2j-evidence/settled-targeted.json)。原守卫字节不变证明见 [unchanged-failure-guards.json](x2j-evidence/unchanged-failure-guards.json)，五份前提原件与 HEAD 一致证明见 [premise-originals.json](x2j-evidence/premise-originals.json)。最终完整运行也全部通过这些文件。

第二次冻结完整运行自行结束：209 文件、3922 通过、2 超时、8 跳过、5 todo，2898.845 秒，原始退出码 1，906 输入变化 0；见 [第二次完整结果](x2j-evidence/second-complete-full-final-summary.json)。[默认报告器日志](x2j-evidence/second-complete-full-final.txt)明确给出两条 `Test timed out in 900000ms`；Vitest JSON 的 `failureMessages` 只保留 `STACK_TRACE_ERROR` 调用栈，超时分类以默认报告器为准。

两项分别为 W5 的 12 种子 × D1–26 扫描（约 990 秒）和 blueprint-center 的 44 种子 × D1–26 扫描（约 1065 秒），均超过既有 900 秒门限；blueprint-center 的实际扫描已输出违例 0 条。本段时间观察到同机另有 9 个 Vitest worker，本任务 6 个 worker 各约 65% CPU；其他工作区运行结束后恢复到各约 100%，见 [负载观察](x2j-evidence/resource-contention.json)。没有终止或调整其他工作区进程。

保留原断言、原 900 秒门限，以 `--maxWorkers=2` 独立复跑两文件：**25/25，通过，426.423 秒，906 输入与第二轮一致且前后变化 0**；两文件分别约 385/425 秒，见 [复验结果](x2j-evidence/timeout-retry-summary.json)。最终完整运行里，两文件也分别约 502/531 秒通过。结合负载观察与相同输入复验，将第二轮超时归因为环境竞争。前两轮完整失败记录均保留，未改超时门限或合并测试结果。

### 最终复跑声明

最终代码上已重跑 38 项专项（含 10,240 组原 C oracle）、14 个故障变体、128 项相关守卫、UR2/3/4 的正常黄金比较，以及自然种子 20260927 的 117 条命令、菜单存读与物品取回。浏览器仍为 0 错误，最终截图已查看；最后的完整 npm test 再次覆盖全部 209 文件。生成基线未重捕获，UR3/4 仅按 §5 的归因各重录一次，最终复跑未再次捕获黄金。

906 输入冻结后仅补充报告与派生证据。最终交付检查确认输入、基线、闭包、LF、diff 均通过；HEAD 保持 `ea568b5a8b1d100042b52b8cc122759205a2a544`，暂存区为空。浏览器上下文及本任务 5196 开发服务已关闭。五处旧前提提案留验收方裁决。**未暂存、未提交。**

## 验收方合并记录

本轮入场（`ea568b5a`）早于 X2i/X2l。合并处置：
- `Monster.ts`：删除两处"偷窃只改 FLEEING"的旧捷径（取本轮，真实盗窃在 Combat 出口）；三处近战取本轮 `{ grid, itemGenerationDepth }` 调用并保留 X2i 的 MA_HIT_BURN 点火。
- X2i 因当时无盗窃出口而改写的描述恢复 CE 声称：`MA_HIT_STEAL_FLEE: 攻击会偷取物品并逃跑`、猴子/恶魔说明原文；x2i 专项断言改为须声称。
- UR3/UR4 trace：夹具置回 HEAD，合并后代码不符；将本次合并全部 12 个生产文件撤回 HEAD → HEAD 夹具 2/2 通过（单变量：本次合并）；恢复后以 `UR3_CAPTURE=1 UR4_CAPTURE=1` 重录并复验。相关 10 文件 189/189。
