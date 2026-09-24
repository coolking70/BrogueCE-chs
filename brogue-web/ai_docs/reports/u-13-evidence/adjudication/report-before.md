# U13：战斗基础数学与耗骰

基准 `3d6b660`；权威为本工作树 CE 和 X-0 §4.1、§4.3 U13、§3.1 K15。实现已落地；**既有守卫中的旧规则依赖保留红灯，待验收裁决，不宣称整套回归全绿**。虚弱完整效果依赖 U14，未伪造 `weaknessAmount`。最终门禁结果见 §8。

## 1. CE attack 全路径核实

实际阅读 `BrogueCE-master/src/brogue/Combat.c:1139–1465`，并追踪 `hitProbability/attackHit`、`specialHit`、`inflictDamage`、`magicWeaponHit`、装备刷新和 Math.c 的 RNG。执行顺序如下：

1. 玩家成就检查；`MA_KAMIKAZE` 杀死攻击者后直接返回。水域限定攻击者对悬浮目标直接拒绝。均早于命中/伤害骰。
2. 设置战斗打扰；解除防守者 ENTRANCED，将 MAGICAL_FEAR 缩为 1；攻击玩家的游荡怪转为追踪。web 本轮保留已有控制状态模型，缺失项未新增。
3. `MONST_INANIMATE` 清除 sneak/asleep/paralyzed 三个**倍率标志**；否则按玩家攻击游荡非玩家目标、非玩家熟睡目标、麻痹状态取值。web 盟友是独立布尔，游荡偷袭显式排除盟友。
4. `MA_SEIZES` 首次抓取还检查相邻、对角无遮挡，再置抓取标志并返回 false。web 原抓取实现依赖调用者保证几何，本轮不改几何。
5. `sneak || asleep || paralyzed || lunge || attackHit()` 按 OR 短路；前四项不调用 `attackHit`。后者遇 STUCK / PARALYZED / CAPTIVE 也直接返回 true，否则 `rand_percent(hitProbability)`。**INANIMATE 只关倍率，不关 attackHit 的麻痹短路。** SEIZED+SEIZING 在概率函数内返回 100，仍掷命中骰。
6. 命中后先判 IMMUNE_TO_WEAPONS / INVULNERABLE：为零且**不掷伤害骰**；否则 `randClump(info.damage) * monsterDamageAdjustmentAmount / FP_FACTOR`。
7. sneak/asleep/paralyzed 命中使非玩家目标增加 `max(movementSpeed,attackSpeed)` 行动债，非盟友转追踪；免疫命中也执行。lunge 不单独造成此延迟。随后倍率只乘一次：匕首旗标 ×5，其余 ×3。
8. 护甲符文 → reaping →伤害说明 → MA_POISONS 将原伤害保存为毒持续期、接触伤害改 1 → `inflictDamage`（含护盾与吸血）→死亡或存活分支。
9. 存活：武器 stagger → `specialHit` →护甲符文消息。`specialHit` 内有腐蚀/幻觉/燃烧/偷窃，毒/虚弱具有 damage>0 等守卫，怪物 stagger 没有 damage>0 条件。死亡分支还有玩家死亡提前返回。
10. `moralAttack` →武器符文（翻倍集合只有 sneak/asleep/paralyzed）→分裂 →武器击杀鉴定 →酸腐蚀及可能的 quiverNumber 重掷。miss 只走未命中消息并返回 false。

本轮对齐第 5–7 步的基础数学/耗骰、完整 range 与玩家装备刷新；保留 W-15 护盾、W-21 强化、B-1 武器倍率/几何/攻速及 U15d 符文语义。**并非整条 specialHit/符文/表现层 RNG 的 CE 等价证明**，后续差异见 §7。

## 2. 固定点公式与编译黄金值

运行 `node scripts/u13-ce-golden.mjs`，从本地 CE 按完整函数边界提取原函数，`clang -std=c11 -Wall -Werror` 编译。包括 `strengthModifier/netEnchant`、怪物三种调整函数、`hitProbability/attackHit`、三个 PowerTables 函数、`randClump/randClumpedRange/rand_percent`、`recalculateEquipmentBonuses`。测试 harness 只供应最小 struct/global、关闭不在本轮的 slaying 类别匹配、枚举 `rand_range`；没有把 JS 公式抄进 C 作为 oracle。

证据：[原 C harness](u-13-evidence/ce-combat.c)、[黄金值与全桶分布](u-13-evidence/ce-combat.json)、[脚本](../../scripts/u13-ce-golden.mjs)。新测试比较 1,215 条命中概率、281 组准确率/伤害定点表值、711 个防御输入、168 组原装备刷新结果和 11 个范围的全部骰元组。

- 净附魔钳 [-20,50]；1.065 表使用 `trunc(E*4)+80`，不是连续 `Math.pow`。
- 防御先按 `monsterDefenseAdjusted` 钳至零，再以 `trunc(D*4/10)+80` 查防御表；查表范围也钳制。
- 玩家准确率先乘附魔表并向零截断，命中概率再乘防御表并截断，最后钳 [0,100]。无 U14 虚弱载体的怪物使用实际 accuracy。
- `playerDefense` 保留加法/内部 ×10 单位，结果存整数：32.5 → 32。没有引入护甲扣伤。
- 玩家武器**先对伤害上下界分别乘 damageFraction 并截断，下界/上界各至少 1，再按原 clump 掷骰**；不是掷完后四舍五入。徒手为 CE `{1,2,1}`。怪物零范围保持 0。

| accuracy | defense | 武器净附魔 | CE = web 命中率 |
|---:|---:|---:|---:|
| 0 | 0 | 无 | 0 |
| 75 | -1 | 无 | 75 |
| 75 | 20 | 无 | 57 |
| 100 | 10 | 无 | 87 |
| 100 | 10 | -10 | 46 |
| 100 | 12 | 2 | 99 |
| 5000 | 500 | 无 | 7 |
| 100 | 32767 | 无 | 0 |

极大值测试位于 CE 的 short 输入域；不声称对任意 JS 超界数复刻 C 整数溢出。查表比理想指数函数更早饱和是 CE 原行为。

## 3. clump 数据、生命周期与分布

`Globals.c` 的 monsterCatalog 共玩家 1 + 怪物 67 行；全部重新解析核对 name/range。怪物已有 min/max 全部正确，补入独立 `clumping`：27 种 clump>1，12 种 `{0,0,0}`。武器重新核对 CE 15 行；标枪原有 `clumping=3`，其余补齐。退池 halberd 非 CE 项，保留原状。数据逐行对照见 [catalog-ranges.json](u-13-evidence/catalog-ranges.json)。

链路：JSON → `Monster.damageClumping` / `Item.clumping` →近战消费。怪物变形换成新物种 clump，强化只改 bounds，clone 复制运行值，snapshotForm 以及 U01 显式字段 codec 保留 clump；物品生成与 JSON 存读同样保留。合成测试对象未指定 clump 时使用原骰子记法解析值；这不是旧存档迁移。未新增旧档兼容。

| range | 伤害骰调用 | 全部分布权重（从 lo 到 hi） | 元组数 |
|---|---|---|---:|
| `{3,7,2}` eel | 2×R(0,2) | 1,2,3,2,1 | 9 |
| `{9,13,2}` ogre | 2×R(0,2) | 1,2,3,2,1 | 9 |
| `{3,4,2}` spider | R(0,1),R(0,0) | 1,1 | 2 |
| `{10,15,3}` troll | R(0,2),R(0,2),R(0,1) | 1,3,5,5,3,1 | 18 |
| `{0,10,3}` | R(0,4),2×R(0,3) | 1,3,6,10,13,14,13,10,6,3,1 | 80 |
| `{3,11,3}` javelin | R(0,3),R(0,3),R(0,2) | 1,3,6,9,10,9,6,3,1 | 48 |
| `{25,50,4}` dragon | R(0,7),3×R(0,6) | 全 26 桶见 JSON，逐桶相等 | 2744 |

另验证徒手、零范围、常数范围、反向上下界。`hi<=lo` 直接返回 lo，不调用 rollFn；clump 内的 R(0,0) 调用会发生，但 CE/web 都不消耗实际随机数。蜘蛛真实近战以毒持续期观测原骰结果，接触伤害仍为 1。

玩家标枪 +10：原 `{3,11,3}` 经 CE 刷新为 `{5,20,3}`；能打出 6，旧“先掷后乘”无法满足同分布。168 个玩家装备边界在实际 attack 入口验证上下界，不只测试纯公式。

**生成流证据**：catalog 仅新增 clump 元数据，数量/顺序/权重/旧统计无变动；装载、变形和保存中的字段赋值无 RNG 调用；[boundary.json](u-13-evidence/boundary.json) 核对 30 个生成/地图/RNG/基线等受保护文件与 HEAD 的 SHA-256 相同；`test:drift` 比较 4 seed×D1–D26，基线未改、未重捕获。依 X-0 §4.1，战斗纠错改变互动实质流，**不能据此宣称互动后的未生成楼层永不受影响**；层种子隔离仍归 U02。

## 4. 基础攻击 RNG 序列

R(a,b)=rand_range(a,b)。普通无符文、无后续能力的基础攻击：

| 分支 | 严格调用顺序 |
|---|---|
| kamikaze / 水域限制拒绝 / 首次抓取 | 无命中、无伤害骰 |
| 普通 miss（包括概率 0） | R(0,99)，结束 |
| 普通 hit（包括概率 100） | R(0,99)，然后 range 的 clump 骰 |
| SEIZED+SEIZING | R(0,99)，然后 clump；不是短路 |
| sneak / sleep / paralysis / lunge | 仅 clump；不掷命中 |
| captive / 无生命目标麻痹 | 仅 clump；不增加偷袭倍率 |
| 普通免疫命中 | R(0,99)，无伤害骰 |
| 短路免疫命中 | 无骰；sneak 集仍唤醒/加行动债 |
| 非免疫、常数或零范围 | 只保留应有的命中骰，range 自身不耗骰 |

真实 RNG 计数锁定：普通 rat 2、eel 3、spider 2、troll 4、dragon 5；自动命中匕首 1；首次抓取 0，下一次 bog 咬击 2。玩家/怪物/玩家受击/怪物互击均有正反测试；sleep+paralysis+lunge 叠加只乘一次。盟友 wandering 不触发偷袭；无生命 sleep 不触发倍率。

真实 Game BE_ATTACK（centaur DISTANCE_ATTACK）观测：`R(0,99), R(0,2), R(0,2)` 为基础命中/伤害；之后既有浮字 ID `R(1,1000000)`、血迹 `R(0,99)`。“全路径同构”的声明不能覆盖这两个 web 表现调用；本轮不改表现 RNG、掉落、符文或 U06 的 BE_DAMAGE。测试明确锁定这条真实入口序列，未通过 stub 删除尾部调用。

## 5. 虚弱/隐形与任务线索结论

- CE `strengthModifier` 用 `(rogue.strength-player.weaknessAmount)-strengthRequired`。怪物并非只影响力量：Combat.c:88–108 用 `damageFraction(-1.5*weaknessAmount)` 调伤害、`accuracyFraction` 调准确率，防御减 `25*weaknessAmount` 后钳零。任务线索“影响力量”对玩家装备正确，对怪物需补这三项；玩家徒手命中仍使用 monsterAccuracyAdjusted，装备武器后才由 netEnchant 准确率覆盖，U14 也需覆盖该分支。
- web 只有 weakened 持续时间，没有 amount。**删除固定半伤，不拿持续时间推算浓度**。U14 登记：amount 的施加/刷新/衰减/治愈/消魔/保存，玩家强度及怪物三项公式消费者一起落地；本轮 weakened 尚不能实现 CE 完整减益。
- CE attack/装备刷新公式无独立隐形 ×1.5，删除该乘数。隐形可经 AI 影响 awareness，仍通过既有 sneak 标志决定倍率。Game 攻击后清隐形等既有状态语义未改，登记给 U14/U21。
- clump 缺字段已补齐并证明生成基线不变；自动命中还包括 attackHit 层麻痹/俘虏，不能只改 `randPercent(100)` 为一个笼统概率优化。
- W-21、W-15、B-1 保持语义，运行 R∪S 回归；BE_DAMAGE 保留 U06 的独立直接伤害路径，仅共享公式的投掷/详情消费者随公式量化变更，投掷算法本体未改。

## 6. R∪S 反查、两份清单与撞红处理

[反查脚本](../../scripts/u13-test-scope.mjs) 用 TS AST 解析相对 import/export/import type/dynamic import/require（Vue script 同样扫描），反向闭包从任务 R 文件和本轮实际生产改动文件出发。S 扫 `randClump|autoHit|backstab|invisible|weaknessAmount` 及公式/range/BE_ATTACK、源码读取者，范围含 src、scripts、ai_docs。没有未解析相对导入或非字面动态导入。

143 个测试文件中，R=128；S 补入 `v_2b_9b_environment`，并集 129，其中 drift 独立执行。完整逐文件理由及清单见 [closure.json](u-13-evidence/closure.json)，全仓文本命中见 [semantic-hits.txt](u-13-evidence/semantic-hits.txt)。历史文档/脚本命中为审计线索，不冒充全部运行过的测试。

### 6.1 预计改义断言（CE 依据明确）

| 文件/范围 | 改义与依据 |
|---|---|
| CombatFormulas.test | 浮点理想值/round →原查表及逐级 trunc；PowerTables.c:138–204、Combat.c:116–146。删除旧近似容差口径，以编译矩阵替代；runic 断言不改 |
| 同文件 playerDefense | 32.5→32、42.5→42，Items.c:8498–8526 的整数赋值；加法模型及钳零断言保留 |
| data/monsterDamage.test | 保留 min/max 和旧 notation 断言，增补独立 clump 精确值；Globals.c 全部 67 行 |
| 新 u_13_combat_math.test | 新增全桶分布、附魔前置、short-circuit、免疫无骰、零伤、行动债/唤醒、实际计数及生命周期；CE 路径见 §1–4 |
| DetailGenerator 消费者 | 显示的实际伤害上下界、平均伤害和最少攻击数使用截断后的区间，依据同一装备刷新；未改未知信息揭示规则 |

### 6.2 只回归、不可放宽的断言

- `b_1_weapon_specials / p4_5 / p4_6 / p4_7`：匕首 ×5、一般 ×3、突进不翻倍符文率、几何目标顺序、攻速、抓取/吸血/stagger。
- `armor_model_effect / armor_display_effect / armor_runic_effect`：护甲效果量阈值、展示命中率同源、符文效果。所有阈值原样。
- `w_15 / w_21 / w_10`：护盾吸收、强化增量、毒接触/持续量；`w_19 / w_20 / w_23 / u_01`：变形/克隆/消魔/存档身份与字段。
- `u_06 / p4_1b / w_8`：BE_DAMAGE 直接伤害、豁免、反射和效果次序；BE_ATTACK 仍走近战。
- `b_1a / ui_2 / b_2`：击杀鉴定、腐蚀/保护、投掷；若夹具借旧数学强制必中或取消 auto-hit，仅加观测，不改 seed/目标状态/阈值/期望。
- 生成、时间、AI、DF、W/V 其余反向闭包断言全部原样，逐文件状态由 §8 的最终结果表列出。

撞红处理：

1. 新测试第一次把蜘蛛接触伤害当成原骰结果、把 BE_ATTACK 后续浮字/血迹忽略，修正新测试观测；产品毒/表现逻辑没改。
2. 新 clump 默认解析使既有“damage 缺失详情不崩”测试抛错，属**真实回归**。生产构造/变形解析恢复原默认伤害口径；原测试未改。
3. B-1a 击杀鉴定夹具玩家力量不足，所谓“defense=0 必中”不成立；新耗骰位置使 totem 落空。U06 两条 BE_ATTACK miss 夹具初态 ASLEEP，旧 mock(false) 能取消 auto-hit，新 CE 短路不能。UI-2 使用 defense=-10000 强制必中，CE 实际先钳负防御为零，低附魔仍可落空。
4. 依任务书 §4，以上旧守卫只增诊断，**保留原 seed/夹具状态/期望/阈值，不加 skip/fails，不改扫描器**。曾定向将 U06 目标设 HUNTING 验证其余链路可过；最终已撤回该夹具修改，交验收方裁决。
5. [反向脚本](../../scripts/u13-negative-check.mjs) 在可销毁副本分别仅恢复“auto-hit 多掷一次”或仅移除“负防御钳零”：旧冲突守卫变绿，新 CE 合同变红。证据 [counterfactual.json](u-13-evidence/counterfactual.json) 与同目录四份 counterfactual 日志。该证明不依赖重捕获、改 seed 或改基线。

建议验收裁决（本轮未执行）：U06 miss 明确使用 HUNTING 目标，并另保留 asleep 短路正例；B-1a 将净附魔配置为 0 以满足鉴定测试的必中前提；UI-2 使用合法自动命中场景测试保护/腐蚀，而非负防御漏洞。必须保留现有保护/腐蚀/鉴定数值断言。

## 7. 边界、清单外文件与新发现登记

允许的生产面为 Combat/公式/表、Monster、Item/ItemLoader、目录；追踪生命周期追加 `EntitySnapshot.ts`，追踪显示消费者追加 `DetailGenerator.ts`。没有更改 Creature/Player 状态载体、Game、武器/护甲符文逻辑、BE_DAMAGE、Random、生成/地图实现或生成基线。新增脚本/evidence/本报告为验证产物；测试改义及诊断面见 §6。

保留事项：

- U14：weaknessAmount、STUCK/DONNING 等尚缺载体；玩家真实装甲 0 基础值的既有 truthy 守卫未扩域。不得把本轮写成“完整虚弱/穿甲完成”。
- 投掷：本轮只改近战/BE_ATTACK；`resolveThrownWeapon` 仍用骰子记法 clump，标枪独立 clump 未接该出口，且乘后 round 与 CE trunc 仍不同。共享基础公式量化会影响其命中率，已纳入回归。后续投掷专项处理。
- U15d：web 符文触发仍在扣血前，Game 还有 fallback 触发；CE 在 moralAttack 后且含存活/类别守卫。本轮不调整它们，不声称带符文攻击全序同构。
- U09/U16/U21/U24：零伤命中在 Game/Monster 某些文案仍显示 miss；MA_HIT_BURN/specialHit 完整出口、抓取几何、攻击者游荡转追踪、player clone 装备派生伤害等非本轮全链收口。CE 本身允许零伤，不能靠恢复最低 1 伤害掩盖这些缺口。
- U02/U21：浮字 ID 与血迹仍消耗当前全局随机流；与基础战斗骰分开记录。自然完整局的 CE 逐 tick/双流录像差分、本次浏览器视觉验收均未执行。

## 8. 最终门禁与 SHA-256

**这是最终状态下的运行结果，不是中途快照。** 最终执行 `node scripts/u13-final-check.mjs`；所有代码、目录、测试、验证脚本编辑完成后整套重跑，2026-09-24 18:35–18:46（Asia/Shanghai）。

| 门禁 | 最终结果 |
|---|---|
| CE 原函数编译/黄金值再生成 | 退出 0 |
| 目录/边界审计 | 退出 0；67 怪物、15 CE 武器；30 个受保护文件与 HEAD 一致 |
| 两组临时副本反向证明 | 退出 0；各自旧守卫绿、新 CE 合同红，符合预期 |
| `npm run build` | 退出 0；vue-tsc 与 Vite 成功，仅既有大 chunk 提示 |
| R∪S 回归（显式 128 个文件） | 125 文件通过、3 文件失败；2,466 通过、7 失败、8 既有 skipped、5 既有 todo；约 640 秒 |
| 新 U13 专项 | 40/40 通过，包含完整 CE 黄金矩阵与分布枚举 |
| `npm run test:drift` | 退出 0；4 seed×D1–D26，104 层零基线差异；约 14 秒 |
| 输入 SHA-256 前后比较 | 412 文件，`changed=[]` |

复用本机既有 node_modules 链接，package-lock 与依赖来源副本一致；未安装/更新依赖。最初一次最终检查因新增诊断使用项目目标库不支持的 Array.at 而构建失败，已中断并改成等价下标访问；本节引用的是此后重新执行的完整结果。

最终 7 项红灯：

| 文件 | 条数 | 原因与处置 |
|---|---:|---|
| `b_1a_identification.test.ts` | 1 | strength=12、required=14、enchantment=0、defense=0；CE 命中率 72%，无生命 totem 不享 wandering 自动命中。旧耗骰位置曾使该种子碰巧命中；保留 hp<=0 断言 |
| `u_06_monster_damage.test.ts` | 2 | DISTANCE_ATTACK / POISON_DART 的目标为 ASLEEP，accuracy=0 也短路命中，实际 damage=9、HP=91；原 mock(false) 不能取消 CE 自动命中。原 HP=100 断言保留 |
| `ui_2_protection.test.ts` | 4 | 带保护命中、-10 腐蚀边界、quiver 重掷、击杀腐蚀四个夹具靠负防御“必中”；CE 钳零后各自落空。原命中/腐蚀断言均保留 |

上述失败已有单因素反向证明；**最终整套回归退出 1，验收尚需对旧守卫夹具作裁决**。没有用修阈值、重捕获、skip 或恢复错误算法换绿。其他已运行文件通过，并不替代 §7 保留的实现缺口。

逐文件结果见 [129 文件表](u-13-evidence/final-files.md)（含独立 drift）及 [机器可读表](u-13-evidence/final-files.json)。完整结果：[回归 JSON](u-13-evidence/final-tests.json)、[回归日志](u-13-evidence/final-regression.txt)、[7 项失败详情](u-13-evidence/final-failures.json)、[drift JSON](u-13-evidence/final-drift.json)、[build 日志](u-13-evidence/final-build.txt)、[门禁命令/退出码](u-13-evidence/final-check.json)。未运行不带文件参数的全量 vitest 命令。

SHA-256 自证：[运行前](u-13-evidence/final-input-before.json) / [运行后](u-13-evidence/final-input-after.json) 覆盖全部 src、public、scripts、CE 源码、配置/lock、黄金值、任务和权威报告，412 项完全相同。运行后清单 SHA-256：`8a0d896ef7269a121cdbbdd4f4e2c65cc4dd6d568e6b5c903608099cf8ea947b`。报告/日志是输出，不参与自身输入哈希；报告自身摘要另见 [final-report.sha256](u-13-evidence/final-report.sha256)。

§3 硬约束自检：未改变生成实现/池/权重或重捕获基线；未改武器护甲符文；未改状态模型；未做旧存档兼容；未改 BE_DAMAGE；clump 保存链与显示修正均经反向闭包纳入验证。没有暂存、提交或改写 CE 源码。
