# X2k：死亡即时收口、CE 落物与复活候选

基准 `ffc750bc3d40b2a340fee1f57cd05a7c5063f4c3`；本地 Mac 轨；工作目录为仓库根，项目 `brogue-web/`。未暂存、未提交。权威为本树 CE 及 X-1 §4 N10 / §7.1。

实现与最终门禁已完成；完整全量退出 0，生成基线和黄金 trace 均未改写。

## 1. CE 核实与规格修正

任务书把 `killCreature` 定位在 Monsters.c 约 4090，并概述为立即移出列表。本树实际入口是 **Combat.c:1934–2047**。其语义为：

1. `MB_IS_DYING | MB_HAS_DIED` 防止递归重复死亡；先置 DYING。
2. 普通死亡先落携物，再死亡 DF。行政删除销毁携物；行政删除和 FALLING 不播死亡 DF。
3. DF 后清占用并置 HAS_DIED；普通非休眠死亡释放寄宿者到原格、等待 200 ticks，立即执行接触效果，然后尸体学习。
4. 最后降格领袖、维护继任。`Monsters.c:929–947` 的迭代器跳过 HAS_DIED。
5. **物理摘链和 purgatory 登记仍在 `RogueMain.c:950–982`，`Time.c:2913` 调用清扫。** 本轮遵循 CE，不把盟友过早放进复活池。

落物源为 `Monsters.c:4074–4086`，复活源为 `Monsters.c:2898–2945`，选点源为 `Grid.c:287–360`、`Monsters.c:3961–4027` 和 `Dijkstra.c:127–207`。

## 2. 实现与消费者闭包

| 范围 | 最终行为 |
|---|---|
| 即时死亡 | `Monster.die → notifyMonsterDeath → Game.killMonster`。运行期所有权及 DYING 均放在 MonsterLifecycle 模块的弱集合，名单插入/替换时绑定；生成构造、读档和寄宿释放都不新增 RNG。保留数组 API 与普通序列化形状。 |
| 重入、占用、清扫 | WeakSet 对应 DYING；`deathProcessed` 对应已完成死亡事务。落物/DF 回调期间 `getMonsterAt` 仍能查到正在死亡者，DF 完成后查不到；物理摘链/入池留到清扫。原始 HP 写入兼容入口只补处理未收口对象。 |
| 同回合后续动作 | 死亡立刻完成落物、DF、学习、继任；行动和可发生死亡的名单循环使用快照，寄宿者 prepend 不使旧行动重复。死亡者不再参与状态递减、叫醒同伴、随从/分身计数。 |
| 寄宿与休眠 | 先释放原实体，200 ticks，接触地形可再次立即死亡；内层事务在外层学习之前结束。休眠死亡清 dormant 占用，不释放寄宿者、不广播尸体学习。 |
| 行政删除 | X2g blink 被困潜没者通过同一 `killMonster(..., true)`，抑制物品、DF、寄宿、复活，仅做死亡/继任；新增行政标志进入显式存档字段表。生成事务自己的静默回滚与生成流未改。 |
| DF | 保留毒气 2000、爆炸、坑洞、地衣出口；补齐 CE `DF_BLOOD_EXPLOSION=36`（150/30）和 `DF_MUTATION_EXPLOSION=38`（350/100、爆炸 flare）。变异覆盖物种 DF；FALLING/行政删除均抑制。死亡消息按可见性，补坑膨胀怪消息及不可见盟友失落提示。 |
| 落物 | `makeMonsterDropItem` 和既有携物消费者共用 CE 距离候选：blocking=`T_DIVIDES_LEVEL`，destination=`T_OBSTRUCTS_ITEMS` 与玩家/楼梯/已有物品；其他怪物、机器不排除。物品最后的 randomMatchingLocation 回退保留。 |
| 复活 | 最高 `totalPowerCount`，平手较高 CE monsterID（原排序已正确，本轮核实保留）。blocking=`T_PATHING_BLOCKER | T_HARMFUL_TERRAIN`，只排玩家/活动怪占用，不排休眠怪。复活原对象、清死亡/坠落/不适用的燃烧和 discord、heal；按**原始目录** ENTER_SUMMONS 恢复 info/status，即使该实例已被否定。保留 mutation bookkeeping，但恢复原生 DFType；变异吸血鬼复活、读档、再死亡均为原生血迹。 |
| 外观与存档 | 活着时外观在死亡时保存，仍保留 P1-24 尸体 `%` 约定；入 purgatory、JSON 往返及复活后恢复原外观，不把 `%` 带回活体。死亡处理标志、行政删除、外观和恢复的 DFType 均由 U01/UR1 显式 codec 承接。 |

`qualifyingPathCandidates` 分开路径阻挡和落点禁区：OBSTRUCTION 才挡斜角，FORBIDDEN 不挡斜角；原点 cost 强制 1；最短正距离并列 x-major；无路径时按最近切比雪夫环回退。合法原点及单候选不消耗随机数。没有把这套运行期查询替换生成落点流程。

边界：完全没有合法复活格时保留 purgatory 并返回 false；没有复制 CE 对 INVALID_POS 下标访问的未定义行为。现有 web 死亡概率战利品仍由原战斗/毒伤出口生成，没有迁移到 CE item hopper，符合本任务“不移动生成流”的范围；本轮对齐的是携物归属、位置及死亡时序。

## 3. 原 C、专项和反事实

- [原 C 提取脚本](../../scripts/x2k-ce-path.py)直接编译 CE `getQualifyingPathLocNear`、`getQualifyingLocNear`、PDS 扫描；128 地图 × 两种掩码，**256/256** 候选集与 web 相同。包含墙角、路径不可达、危害格、占用、原点强制通行、x-major 并列。[原 C](x2k-evidence/ce-path.c)、[结果](x2k-evidence/ce-path.json)、[源码 SHA](x2k-evidence/ce-path-provenance.json)。这是选点 oracle，不声称整个 CE 游戏逐骰同构。
- 新增 `x2k_lifecycle.test.ts` **16 项**覆盖立即落物/DF、递归幂等、DYING 占用、爆炸连锁、寄宿即时致死、行政/坠落/休眠例外、血迹、读档重新绑定、复活身份/排序/形态/外观及失落消息。
- [10 个隔离故障变体](x2k-evidence/negative-summary.json)全部检出：恢复延迟处理、落物后置、提前清占用、坠落播 DF、行政死亡走普通出口、允许切墙角、选弱盟友、用实例 ENTER_SUMMONS、读档不绑定、复活未重置死亡 DF。变体只在临时副本运行，生产文件不改坏。
- 定向结果：[前提修正 93 项](x2k-evidence/premises-repaired.json)、[复核 76 项](x2k-evidence/review.json)、[最终专项与状态复验 157 项](x2k-evidence/restoration-final.json)、[实体存档 17 项](x2k-evidence/entity-final.json)。不同轮有重复，不相加虚报唯一覆盖。

## 4. 旧前提修订提案（交验收方裁决）

原文件均逐字节匹配入场 HEAD，见 [原件与 SHA](x2k-evidence/premise-provenance.json)。先跑原 HEAD 通过，再保留当前失败证据；未调低断言强度、样本数或超时。

| 文件 | 反事实 | 仅迁移的前提 |
|---|---|---|
| `p1_24_death_sink` | 与 W19 原 HEAD 合计 **66/66**；即时处理后近战原格毒气断言失败，补齐死亡 DF 后“没有火”的留痕断言失败。 | 原动作观测前提设客观门为 200 ticks，观察击杀后、气体扩散前的状态，结果断言不变。旧注明确说“内容实现之日翻红，届时改回真实内容断言”：仅将爆炸变异尚未实现的 5 个 isBurning=false 前提改为 true，保留全部载体、死亡/旗标/毒气断言。 |
| `w_19_polymorph` | 原 HEAD 通过，即时死亡后观察器晚装导致 0 次。 | 把 addGas spy 移到 takeDamage 前，所有结果断言不变。 |
| `c_4b_dungeon_feature` | 原 HEAD 目录组 **5/5**；新增 CE 两行后 **3 通过/2 失败**。 | 历史 135 行投影排除 36/38；严格闭包增加这两个实际死亡来源，集合相等及原计数不变；新增专项另钉两行原 C 参数。 |
| `u_08_terrain_bolts` | 原 HEAD 历史投影 **1/1**；首轮完整测试实测 141 ≠ 139。 | 历史投影排除新增 36/38，139 与地形/法术全部结果断言保持；[HEAD](x2k-evidence/u08-head.json)、[完整失败](x2k-evidence/full-attempt1-summary.json)、[修后 77 项](x2k-evidence/lifecycle-repaired.json)。 |
| `u_17a_df_transaction` | 原 HEAD 历史投影 **1/1**；新增两行后原 140 行历史投影失败。 | 历史投影排除新增 36/38，140 与其余断言保持。 |

证据：[HEAD](x2k-evidence/premises-head.json)、[即时处理初轮](x2k-evidence/first.json)、[目录 HEAD](x2k-evidence/catalog-head.json)、[目录失败](x2k-evidence/catalog-before.json)、[目录修订](x2k-evidence/catalog-repaired.json)、[U17a HEAD](x2k-evidence/u17-head.json)、[U17a 修前闭包](x2k-evidence/closure-targeted.json)。构建期 i18n 缺键发现修生产翻译，未放宽 P1-30。

## 5. 浏览器与 RNG/基线

使用 develop-web-game 技能的标准客户端，然后独立 headed Playwright 验证正常局里的合成可复查场景：盟友膨胀怪携钥匙并寄宿老鼠 → takeDamage 立即出气、钥匙归地、原老鼠出现/200 ticks → 真实 wait 后入 purgatory → 实际菜单保存、刷新、继续 → 真实 ArrowRight 踩 CE 重复触发地板给祭坛供电并复活同一盟友。**5 阶段，页面/console errors=0**；[脚本](../../scripts/x2k-browser.mjs)、[状态](x2k-evidence/browser.json)、[即时死亡](x2k-evidence/browser-immediate.png)、[复活](x2k-evidence/browser-resurrected.png)。完整截图已打开检查。标准客户端 canvas export 是黑图，仅其文本状态算操作证据，不算视觉通过；整页截图承担视觉验收。

初次浏览器脚本把祭坛误当踩踏触发，留下 [首轮证据](x2k-evidence/browser-first/browser.json)；核对 CE TM_IS_WIRED 后只修场景供电，产品不加自创触发。

运行期顺序按 CE 改变，但现有 **UR2/UR3/UR4 三份黄金均原样通过**，[正常比较结果](x2k-evidence/traces.json)。没有使用 CAPTURE，没有重录 trace。浅层/深层/P2 fixture、三个黄金和基线守卫 SHA 入场/交付比较均不变：[before](x2k-evidence/baseline-before.json)、[after](x2k-evidence/baseline-after.json)。初始浅层 drift 已通过，[初始结果](x2k-evidence/drift-initial-summary.json)。

## 6. 最终门禁与复跑声明

`x2k-audit.mjs` 以全部修改生产文件为种子做 TypeScript import/export 反向闭包 R，并合并生命周期语义、文件读取守卫及点名族 S；[清单](x2k-evidence/closure.json)含 **R 203、R∪S 209、源码/文件读取 67**。p1_30、U24、U01/U03、U06、U10、U11、U16、U17a、X2c/g/j/l、p1_24、p4_*、w_* 全部在验收集合。

首轮完整全量 **213 文件、3927 通过/18 失败、8 skip/5 todo**，2079.845 秒，942 输入零变化：[原始总结](x2k-evidence/full-attempt1-summary.json)、[完整结果](x2k-evidence/full-attempt1.json)。其中 17 项由 U00/U03 抓出新增 Game 自有 callback / WeakSet 无法进入可审计对象图及字段登记遗漏；修生产实现，把运行期所有者与 DYING 移到 MonsterLifecycle 模块，数组仍为 Game 可观察的自有字段，`scripts/u03-state-contract.json` 仅把原两数组的登记映射到其访问器 backing 字段，层级/快照归属不变。**U00/U03 测试未改**。另 1 项是上表 U08 历史投影。修后 U00/U03/U08/X2k **77/77**；9 个故障变体及 headed 浏览器流程再次通过。第二轮全量改用 6 workers，原超时、样本、断言不变。随后对照 `Monsters.c:2937` 的整份 info 重置，隔离证实变异吸血鬼复活后仍错用旧变异 DF：[修前失败](x2k-evidence/summoner-df-before.json)。因此在源码尚未修改时中止第二轮，942 输入零变化：[中止记录](x2k-evidence/full-attempt2-cancelled.json)。补齐 `deathDFType` 存档字段及变形/再次变异的重置，爆炸/地衣两种变异均覆盖复活→JSON→再次死亡；[修后 157 项](x2k-evidence/restoration-final.json)，10 个故障变体全部检出。随后启动第三轮完整门禁，仍用 6 workers。

第三轮完整运行中，**项目内 213 文件、3947 项断言全部通过，8 skip/5 todo**，但我新增的两份证据副本误用 `.test.ts` 后缀，被 Vitest 自动发现并发生导入失败，命令退出 1（总发现 215 个套件，其中两个无测试）。[完整原结果](x2k-evidence/full-attempt3.json)保留。证据副本已改为 `.txt`，字节内容不变；未修改任何生产源码、实际测试或 Vitest 配置。验证器补充前后实际测试发现清单及套件错误统计；清单应为 214 文件（含由 drift 单独执行的 generation_baseline）。第四轮完整复跑使用 4 workers，以降低同机并发竞争。

第四轮完整跑完 **213 文件、3946 通过/1 超时、8 skip/5 todo**，2812.959 秒；942 输入和 214 文件发现清单均零变化。唯一失败是原 `blueprint_center` 44 seeds × D1–D26 的 900 秒门限，实测套件 951.868 秒；[原始日志](x2k-evidence/full-attempt4.txt)、[总结](x2k-evidence/full-attempt4-summary.json)。该生产/测试源码与第三轮全 3947 断言通过时完全相同：[SHA 对照](x2k-evidence/attempt4-source-equivalence.json)。原门限、样本、断言均保留。同机其他 Vitest 进程结束后，使用 6 workers 启动第五轮完整门禁，最终第五轮已完整退出 0；同一蓝图用例按原 900 秒门限通过，套件 620.309 秒。

最终构建、全量、drift、独立深层由 [验证脚本](../../scripts/x2k-validate.mjs)统一冻结 **942 个输入**（源码/测试/public/scripts/config、黄金、C oracle 与 CE 源码），保留每轮前后 SHA 差异及实际退出码。探索性全量因输入仍修订而中止，不计完成门禁；[中止记录](x2k-evidence/discovery-cancelled.json)及原日志保留，未把部分绿灯称为全量通过。

| 最终命令 | 结果 |
|---|---|
| `npm run build` | 退出 0，6.326 秒；[结果](x2k-evidence/build-final-summary.json)。 |
| 完整 `npm test -- --maxWorkers=6` | **213 文件、3947 通过、0 失败、8 既有 skip/5 todo**，退出 0，1941.146 秒；[总结](x2k-evidence/full-final-summary.json)、[完整结果](x2k-evidence/full-final.json)。 |
| `npm run test:drift` | 1/1，退出 0，26.218 秒；[结果](x2k-evidence/drift-final-summary.json)。 |
| 独立 `u_26a_deep_baseline` | 1/1，退出 0，41.942 秒；[结果](x2k-evidence/deep-final-summary.json)。 |
| R∪S/点名族/源码读取覆盖、SHA/LF/diff | **209/209** 闭包、49 点名文件、67 源码/文件读取守卫，遗漏 0；942 输入相同，214 测试发现清单相同，12 个保护文件 SHA 不变；[LF 检查](x2k-evidence/crlf-check.json)：0 CRLF；`git diff --check` 通过。 |

**最终复跑声明：2026-09-27 15:26:05–15:59:41 CST（Asia/Shanghai）**，构建、完整全量、drift、独立深层全部完成且退出 0。四个最终命令使用同一组 942 个冻结输入及同一份 214 文件发现清单，每轮前后均零变化；完整全量与 drift 合计覆盖全部 214 文件，R∪S 与所有点名/源码读取守卫零遗漏。[最终核对](x2k-evidence/final-checks.json)。最终命令后仅收口报告、进度和校验元数据，未再改生产源码、实际测试或配置。

未暂存、未提交；本任务浏览器和预览服务已关闭。五处旧前提修订及其反事实证据保留，交验收方裁决。
