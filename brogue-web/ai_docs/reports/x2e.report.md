# X2e：其余六种 CE 护符

执行环境：Mac 本地；入场 HEAD `6325f2a8ded2b4fd0d1429bbd497010efedaf308`，原工作树干净。按 [任务书](../tasks/x2e.prompt.md) 和 [X-1 §4 N07 / §7.1](x-1-survey.report.md) 执行。不迁移旧存档，不暂存、不提交。

**完成：六种护符的数据、效果、附魔/充能/消魔交互、中文详情、保存及 CE 自然池已补齐。最终 build、完整全量、浅层 drift、独立深层、差异检查全部通过。** 唯一旧守卫前提修正及反事实证据见 §5，交验收方裁决。未暂存、未提交。

下列 npm 命令均在 `brogue-web/` 执行；Node 25.2.1，Vitest 4.1.11，未修改依赖清单或锁文件。

## 1. 实现与 CE 依据

核对本地 CE `variants/GlobalsBrogue.c:713–742`、`Items.c:7507–7581`、`PowerTables.c:83–96,206–217`，不是从任务中的近似行号推测。六种护符先以 `excludeFromGeneration: true` 加入数据并完成效果，再单独恢复自然池。

| 新护符 | 实际效果及复用路径 | CE 的 E1 / E2 / E5 效果量 | 冷却 E1 / E2 / E5 |
|---|---|---|---|
| levitation | 设置 `levitating` 和 `maxStatus`，清 `seized`；继续使用现有悬浮、客观时间、地形与状态显示 | 12 / 15 / 30 回合 | 531 / 352 / 122 |
| shattering | `ItemUseCoordinator → crystalizeFromPlayer`；复用 U15a 的半径、IMPREGNABLE、碎石、休眠/嵌墙处理 | 半径 5 / 6 / 9 | 1499 / 899 / 194 |
| guardian | 现有 `guardian_spirit` 数据；复用召唤搜索、盟友/绑定字段、U16/U15d 寿命与死亡路径 | 寿命 6 / 8 / 14 回合 | 507 / 360 / 135 |
| teleportation | 原传送候选及 `placeCreature` 提交；新增可选 CE `respectTerrainAvoidancePreferences` 参数，护符传 `true` | 本层随机传送 | 551 / 331 / 71 |
| recharging | 原 `rechargeStaffsAndCharms(false)`，内部仍调用 W-6 `rechargeStaffFully` | 所有包内法杖充满；魔杖与其他护符不变 | 5499 / 3024 / 503 |
| negation | 原 `negationBlastFromPlayer` 接收距离，仍处理自身、生物及地面物品 | 详情半径 4 / 7 / 16；判定距离再加 1 | 1499 / 899 / 194 |

CE 的特殊口径保留如下：

- guardian 冷却表含固定 **18** 回合，守卫寿命另为 `4 + 2E`。实体 HP=1000、命中=200、伤害 5–12/clump=2、火免/武器免疫/反射等来自现有目录；不改造成飞行刀刃。其出生延迟为 `attackSpeed + 1`，`boundToPlayer`/`doesNotTrackLeader` 为真；不掉物、不进入复活池。
- `summonGuardian` 的落点使用现有召唤搜索，新增可选回避掩码。复用现有 `avoidedFlagsForCaster` 计算守卫的免疫与禁入地形；刀刃默认掩码及行为保持原样。找不到合法落点时不放入非法实体，使用仍花费回合和冷却。
- CE `useCharm` 的传送第三参为 `true`；旧随机传送原语默认 `false`，因此扩参数而非另写选择器。距离图仍使用 forbidden flags，最终候选才使用 avoided flags。`Monsters.c:1147–1153` 的 `disentangle` 只清 `STUCK`；保留抓取标记，后续移动验证抓取者。这一点与“传送直接清抓取”的直觉不同。
- 消魔 `+1` 来自 `Items.c:7573`，不是详情或公式的取整误差；判定采用平方距离和原视线门，背包不进入地面循环。地上六种新护符都能被消魔重置为完整冷却。
- 公式继续使用既有 POW 表与 `fpPow`，补 CE `short` 返回/局部变量截断，避免高附魔的持续期溢出与 C 不同。独立 oracle 覆盖全部十二种、E0–51。

没有任务与 CE 的实质冲突；上述不直观口径均以 CE 为准。没有重写碎墙、消魔、法杖回电、传送提交或谱影生命周期。

## 2. 数据、交互、显示、保存与入池

`arcana.json` / `genCharms` 最终顺序为 health、protection、speed（CE haste）、fire immunity、invisibility、telepathy、levitation、shattering、guardian、teleportation、recharging、negation；频率为 **5,5,5,3,5,3,1,1,5,4,5,5**，合计 47。新守卫从原 C `charmTable_Brogue` 解析行序与频率，不复制产品数组当期望值。

U15c 的 `{1,2,1}` 出生附魔和 7% 尾部、U05 的种类抽签/品质流程继续使用。测试逐一验证全部十二种 category-only 机器 CHARM 请求。护符出生即鉴定；新增六种不需要未知外观。保留既有六外观槽的 shuffle 次数，避免数据阶段增加无关耗骰；不足槽的已知护符不再错误打印 Unknown 警告。

中文名称、效果、当前数值、附魔后数值和剩余冷却接入现有详情。U22 的 CE Discoveries 仍为卷轴、戒指、药水、法杖、魔杖五组；护符没有未知态，不新增一组虚构的发现概率。

所有新实例复用现有 U01 字段合同；未新增实例字段或 schema。逐种完整 Item 往返，守卫整局保存/恢复、绑定、剩余寿命、下一步到期死亡均有执行断言。附魔继续加 E 并立即解除冷却，充能卷轴仍恢复所有法杖与护符；充能护符单独限制为法杖。

## 3. 生成及黄金 trace 归因

入场先保存 [前置哈希](x2e-evidence/baseline-before.json)，浅层 drift **1/1**、深层独立基线 **1/1** 均通过，见 [浅层日志](x2e-evidence/drift-before.txt)、[深层日志](x2e-evidence/deep-before.txt)。固定四 seed（424242、777、20260913、31337），每个连续生成 D1–40。

| 单变量阶段 | D1–26 | D27–40 | 两条 RNG 流 |
|---|---|---|---|
| s0 → effects（数据、公式、效果、显示，不入池） | 全观测字段 0 变化 | 0 变化 | 0 变化 |
| effects → pool（CE 顺序/频率入池） | 7 层、14 字段变化，仅 `itemState` 与 `charms` | 0 变化 | 0 变化 |

七层为 424242/D5、777/D1,D4、20260913/D1,D2、31337/D8,D15；地形指纹、怪物数量/物种、物品数量、深层宝石位置/数量均不变。见 [生成归因](x2e-evidence/generation-attribution.json)。这只证明固定样本中的变化范围，不宣称完整 CE 同 seed 逐骰生成。

原 UR2/3/4 观测首先与 HEAD 黄金逐一相等。UR2 两阶段完全不变；UR3/4 随已知护符目录、风味映射及实际护符身份变化。UR4 的变化路径仅为已知种类数组与六条既有护符风味映射；时间、实体、RNG 不变。见 [trace 归因](x2e-evidence/trace-attribution.json)。

UR3 两阶段各 120 个原始整世界 hash 均有变化，另作分字段归因：只归一化已知护符 ID、护符风味映射及 CHARM 实例的 `identityId/name/color/cooldownTurns` 后，世界快照、RNG、日志完全一致；机器观测另有两处 item 名称替换（777 的 `Charm of Telepathy → Charm of Teleportation`，424242 的 `Charm of Health → Charm of Fire Immunity`）。逐字段验证它们都只修改机器产物 `name`，因累计观测在后续层和读档行中重复出现。三阶段拆分前的原始 hash 全部与原 UR3 观测相同，两次比较未解释差异均为 0。见 [拆分证明](x2e-evidence/trace-audit-summary.json)。归一化只用于证据分析，未用于守卫或黄金 trace。

浅层与深层分别按最终 pool 观测各写入一次，二者黄金数值均无变化，仅更新来源说明。UR3/4 分别使用原 `UR3_CAPTURE=1` / `UR4_CAPTURE=1 npx vitest run src/test/u_rN_trace.test.ts --maxWorkers=1` 入口各重录一次，结果与归因阶段候选逐字段相等。登记完成时间为 2026-09-27 **06:00:47 CST**；[重录登记](x2e-evidence/recapture.json) 含方法、写入次数和 SHA。P2 三份基线和 UR2 不改。唯一既有守卫前提修正见 §5；不修改生成、时间或 trace 的断言。

| 基线 | 入场 SHA-256 | 重录后 SHA-256 | 写入次数 |
|---|---|---|---:|
| p2_2_baseline.json | `ba5cfdab37e2bdf633714ac9da1b54c5db71318967c54cffdb47da7519f51726` | `ba5cfdab37e2bdf633714ac9da1b54c5db71318967c54cffdb47da7519f51726` | 0 |
| generation_baseline.json | `8fbfc182a1c1e6e53a0cb5a5ac49cebfd343c0cf1aa65acb7b0ce5a7cf3afc8d` | `4a6476b413be035fd07c29debd8546bdf74468b81d25b14f68a78a87e35e3eac` | 1 |
| deep_generation_baseline.json | `4349308067bc804e90cd99149f6362b0f1a00bab25d44f858ea3500b2cb0780b` | `c094786fde5f54eb6b54b630bbc6dc8f7614cf3aa8a1ef2f30267247b1f38aff` | 1 |
| p2_baseline.json | `f1690f3748c3e49c0df692cbee283fb962719d9b290131b9507282a6b504fc4b` | `f1690f3748c3e49c0df692cbee283fb962719d9b290131b9507282a6b504fc4b` | 0 |
| p2_3_baseline.json | `9b3bb0c149e968f6eccae04752e13390beaf4602c6e8216aa65426432f5ecf2e` | `9b3bb0c149e968f6eccae04752e13390beaf4602c6e8216aa65426432f5ecf2e` | 0 |
| u-r2-trace.json | `4d6b62462fc8962732dd39a58f1c1a714909c7e8e3d9b98200b7f4804ec17bb9` | `4d6b62462fc8962732dd39a58f1c1a714909c7e8e3d9b98200b7f4804ec17bb9` | 0 |
| u-r3-trace.json.gz | `3a9b0bc4de1bf4f1495c87cf7c41409ec589d4df702ae120b24dc0cfdb995382` | `776c713cbf0cc44b776d6b4c02eebb837922096c4bab0076be3b6aea3e2566e1` | 1 |
| u-r4-trace.json.gz | `45d759bfd78aaf14cb3a20413aefb5c78620aa844c3a49ff7daab2bdd683d67b` | `86609968c4a08ee469a4deb2e816741b07ad0e3c87bceda69e918380067810b2` | 1 |

## 4. 独立验证与浏览器

- [CE C oracle 脚本](../../scripts/x2e-ce-oracle.py) 直接提取原 CE 表、POW 数组、`fp_pow` 和公式函数，`cc -std=c99 -O0` 编译执行；保留 [C 源](x2e-evidence/ce-oracle.c)、[624 个黄金值及原文件 SHA](x2e-evidence/ce-oracle.json)。覆盖附魔夹取、精确舍入、高 E 的 signed-short 边界。
- [新增专项](../../src/test/x2e_charms.test.ts) 11 项：黄金公式、出生、完整字段往返、附魔零 RNG、中文详情、悬浮、碎墙、守卫落点/寿命/无位置、传送有害地形/无候选、法杖/卷轴充能、消魔边界/遮挡/背包豁免以及 CE 目录/机器请求。
- 相关定向 **6 文件 / 134 项全通过**，见 [结果](x2e-evidence/targeted.json)。第一轮自写夹具中的水地形枚举、背包容量、传送抓取假设已按事实修正；产品首次类型检查中的不存在 ALLY 枚举已修正为现有 HUNTING+isAlly 表示。已有守卫没有因这些问题被削弱。
- [15 个隔离反事实](x2e-evidence/negatives.json) 全部检测到对应断言失败；覆盖定点误差、short、时长、抓取、碎墙范围、守卫寿命/落点/绑定/到期、传送模式、充能类别、消魔 +1、冷却、附魔与退回六种池。Vite 载入变体，不改工作树产品或守卫。
- 按 develop-web-game 技能运行标准 Playwright 客户端，文本状态/移动有效。canvas 导出仍为该环境已知黑图，已打开确认，未作为视觉通过依据。使用默认动画的有头完整页面补验：[浏览器脚本](../../scripts/x2e-browser.mjs)、[状态与断言](x2e-evidence/browser.json)。六种详情/真实背包点击使用、守卫寿命显示、保存→刷新→继续、消魔消除守卫、附魔选物均通过，控制台及页面错误 0。
- 已打开检查的完整截图包括 [守卫详情](x2e-evidence/browser-detail-3.png)、[消魔详情](x2e-evidence/browser-detail-6.png)、[守卫与寿命](x2e-evidence/browser-guardian.png)、[读档恢复](x2e-evidence/browser-restored.png)。浏览器使用受控场景准备道具和地形，动作走真实 UI；不是声称这六种在一次自然开局中同时生成。

## 5. 反查、门禁、交付边界

[反查脚本](../../scripts/x2e-audit.mjs) 从所有修改消费者建立反向 import 闭包，并合并符号命中、任务点名和全部源码读取守卫。当前 R∪S **195 文件**、源码读取守卫 **64 文件**，原始清单见 [search.json](x2e-evidence/search.json)、[tests.txt](x2e-evidence/tests.txt)、[source-reading-guards.json](x2e-evidence/source-reading-guards.json)。U22 对应文件实际为 `src/engine/UI/Discoveries.test.ts`，显式登记。p1_30、U24、U01/U03、U05、U15a/c/d、U16、W-6/7/13、B-4a、W-5、invented_content_pool、UR2–4 均纳入。

完整预检已于 2026-09-27 **05:04:21–05:55:37 CST** 跑完（3075.73 秒），204 文件，3818 passed、6 failed、8 既有 skipped、5 既有 todo。见 [原始全量结果](x2e-evidence/regression-discovery.json)、[日志](x2e-evidence/regression-discovery.txt)、[失败归类](x2e-evidence/discovery-summary.json)。六条红灯为 UR3/4 黄金各一条、W-5 超时一条、旧外观守卫三条；没有以未结束进程或定向结果代替全量。

W-5 的默认报告明确记录 `Test timed out in 900000ms`（同步长用例返回时已耗时约 1201 秒）；当时机器存在另一份全量运行。未改超时、样本或断言，同一原测试独立复核 **18/18** 通过、总耗时 **473.59 秒**，见 [复核结果](x2e-evidence/w5-recheck.json)。终验仍会再次运行完整原测试。

**交验收方裁决的旧前提修正：仅 `src/engine/Items/itemFlavors.test.ts`。** 原守卫要求护符和五类未知物品一样，每种都有双射的随机未知外观；CE `Items.c:364–373` 却明确令护符出生即 `ITEM_IDENTIFIED`，`itemName` 的 CHARM 分支直接显示种类名。增加六种护符后，旧守卫把“不需要未知外观”的已知护符视作漏配。

- 按任务书先反事实：[原守卫在 s0 为 5/5，effects 和 pool 均恰有相同 3 条失败](x2e-evidence/flavor-premises-before.json)，保存 [HEAD 原文](x2e-evidence/itemFlavors-original.test.ts.txt)。effects 尚未入池也失败，因此不是自然池采样不足。
- 只把未知外观资格限定为 CE 的药水、卷轴、魔杖、法杖、戒指五类。原覆盖数、同类双射、中文、跨 seed 和多 seed 检查完整保留；既有六条护符兼容词表的无重复检查也保留。新增护符专门断言：删除其外观映射后，每种仍出生已鉴定、种类已知、名称非空且为中文。
- [修正后 6/6 通过，故意将出生鉴定改错时新增断言翻红](x2e-evidence/flavor-premises-after.json)。隔离载入变体，不改产品源码；不靠补虚构护符外观或增加无关 shuffle 耗骰满足旧假设。执行脚本为 [x2e-flavor-premises.mjs](../../scripts/x2e-flavor-premises.mjs)。此变更遵循任务书的“先反事实证明、只修前提、交验收方裁决”例外；除本文件外既有测试代码无改动。

**最终复跑声明：**在最终代码、外观守卫前提修正及一次基线重录完成后，于 2026-09-27 **06:00:47–06:41:38 CST** 冻结复跑。冻结范围包含产品、测试、脚本、配置、CE 原始源码及测试读取的外置黄金数据，共 **917 个输入**。期间不修改这些输入；[前置 SHA](x2e-evidence/frozen-inputs-before.json) 与 [后置 SHA](x2e-evidence/frozen-inputs-after.json) 全部相同，[差异为 0](x2e-evidence/frozen-input-differences.json)。之后仅收口报告、进度记录和交付核对证据。

| 最终命令 | 结果 | 日志 |
|---|---|---|
| `npm run build` | 退出 0；仅既有 bundle 大于 500 kB 提示 | [build](x2e-evidence/build-final.txt) |
| `npm test -- --maxWorkers=4`（附加 default/JSON reporter） | **204 文件全通过；3825 passed、0 failed、8 skipped、5 todo**；完整跑完 2276.20 秒 | [全量日志](x2e-evidence/regression-final.txt)、[JSON](x2e-evidence/regression-final.json) |
| `npm run test:drift -- --maxWorkers=1` | **1/1 通过** | [浅层](x2e-evidence/drift-final.txt) |
| `npx vitest run src/test/u_26a_deep_baseline.test.ts --maxWorkers=1` | **1/1 通过** | [独立深层](x2e-evidence/deep-final.txt) |
| `git diff --check` | 退出 0 | [差异检查](x2e-evidence/diff-check-final.txt) |

终验 [汇总](x2e-evidence/final-summary.json) 与 [命令/起止时间](x2e-evidence/final-gates.json) 已保存。W-5 在最终全量中 **18/18** 通过（355.56 秒），UR2/3/4、U16、U01/U03、全部 i18n 门禁与 X2e 新增 **11/11** 均通过。

- 全源码树测试 **204/204**，R∪S **195/195**，源码读取守卫 **64/64**，任务点名守卫零遗漏。见 [全树覆盖](x2e-evidence/complete-suite-proof.json)、[闭包覆盖](x2e-evidence/closure-coverage.json)、[点名映射](x2e-evidence/named-guard-coverage.json)、[逐文件结果](x2e-evidence/final-results.md)。
- 8 skipped、5 todo 均为既有条目，未新增跳过；[逐项登记](x2e-evidence/existing-deferred-tests.json)。只更正 §5 的一个旧前提文件，其他既有测试代码不变。
- [最终基线 SHA](x2e-evidence/baseline-after.json) 与 §3 重录登记相符，未出现额外写入；P2 三份及 UR2 与入场相同。CRLF 检查为 **0**，HEAD 与入场相同，暂存区为空。
- [交付核对](x2e-evidence/delivery-check.json) 补查报告链接及全部新增/修改文本的 LF，并再次比对冻结输入。浏览器及本轮开发服务器已关闭；没有提交。

沿用现有原语已登记的边界：召唤落点的 web 搜索/回退及构造耗骰不是完整 CE 逐骰 oracle；消魔复用实时 LOS 门；光波/渐显等表现沿既有渲染能力，本轮不宣称完整 CE 视觉同构。没有旧存档迁移或无关生成规则修改。
