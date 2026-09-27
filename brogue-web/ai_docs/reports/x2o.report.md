# X2o：horde 成员 clump 与风味蓝图深度

基准 `ea2851e6522333a402997468c2477265d032d332`；本地 Mac 轨；仓库根下 `brogue-web/`。按任务书及 X-1b §4 XB02/XB03 执行，以本树 CE 为准。未暂存、未提交。

已完成实现、独立 oracle、单变量归因、一次重捕获及浏览器检查。最终构建、完整 npm test、浅层 drift、独立深层基线全部通过：215 个全量文件、3973 项通过、0 失败；R∪S 和全部 216 个发现文件均无遗漏。

## 1. CE 核实与实现

- CE `Monsters.c:707–769` 的 `spawnMinions` 在每个物种开始时调用 `randClump(memberCount[iSpecies])`（718），普通/俘虏/机器 horde 由 `spawnHorde:908` 进入，召唤由 `summonMinions:1003` 进入。领袖固定生成一只（865），俘虏 HP 调整不掷数量骰。所有入口均已核对，不能只修深层两行。
- `extract_hordes.cjs` 原先已解析第三分量，但在产出成员和最终 JSON 时丢弃。现保留必填 `clumpFactor`；原有 `minCount/maxCount` 分别就是 CE `lowerBound/upperBound`，未重复保存两套上下界。重新从 CE 生成 **175 条 horde、91 个成员三元组**。89 个成员的 clump 为 1；仅 D30–39 GOLEM/KRAKEN 两个成员为 2。
- `Game.spawnHordeAt` 与 `Game.summonMinionsFor` 两处均改用现有 `rng.randClumpedRange(minCount,maxCount,clumpFactor)`。每物种一次调用，位置仍在成员放置之前。`Random.ts` 原算法已符合 CE，无须改写；常量区间零 RNG、clump≤1 一次非退化均匀抽样、其余按余数先大骰后小骰。
- 其他抽样核对：`pickHordeType` 的 `1..Σfrequency`、OOD 的 10% 与 `1..min(5,floor(depth/2))`、populate 的基础数量及重复 60% 都按 CE 保留。机器 feature 的 **instanceCountRange** 在 CE `Architect.c:1393` 本来就是 `rand_range`，Web `BlueprintEngine` 同样使用 `randRange`，没有误换成 clump。召唤表当前第三分量虽均为 1，入口仍消费完整三元组，避免以后目录变化再次丢参数。[调用点及源码 SHA](x2o-evidence/ce-callsite-audit.json)。
- 按 CE `GlobalsBrogue.c:558–618` 修正 **10 个**风味蓝图：58–64、66、71 为 1–40；65 为 1–39。逐行核对其他 CE 映射蓝图没有深度差异。零 frequency、强制编号绕过资格门、26 层奖励保底等既有语义不改。[数据差异](x2o-evidence/blueprint-changes.json)。

本轮结论限于 horde 数量分布/耗骰及蓝图深度字段；不把数量骰相同扩称整个 CE 地图生成、落点重试或怪物初始化过程逐骰同构。任务书与本树 CE 的本轮数值规格无冲突。

## 2. 独立黄金表与原 C oracle

[独立 Python 解析器](../../scripts/x2o-ce-oracle.py)只读 CE C/H，未导入生产提取器、Web JSON 或运行时代码。按 horde 表顺序、monsterTypes/monsterCatalog 名字映射解析所有成员；按蓝图表顺序解析深度及 CE 常量表达式。输出 [CE 黄金表](../../src/test/fixtures/x2o-ce-catalog.json)，并保存四份原 C/H 的 SHA。`python3 scripts/x2o-ce-oracle.py --check` 已通过。

同脚本截取 `Math.c` 的原始 `randClump`/`randClumpedRange`，交 `cc -std=c99 -O0 -Wall -Wextra` 编译。测试 stub 在需要一个新 `rand_range` 返回值时分支穷举，保留每条 C 路径的参数、返回值、调用顺序和最终数量。**14 个目录独特区间 + 3 个边界区间，共 17 个区间、54 条穷举路径**。[原 C](x2o-evidence/ce-oracle.c)、[来源](x2o-evidence/ce-oracle-provenance.json)、[输出](../../src/test/fixtures/x2o-clump-oracle.json)。

`{5,10,2}` 的原 C 结果为 `5 + U(0,3) + U(0,2)`：12 条等概率路径，数量 5–10 的重数依次 **1、2、3、3、2、1**，每条两次非退化随机调用。Web 对每条路径逐项比对，并在 17 区间 × 16 种子 × 2 RNG 流上比对数量及完整 RNG 状态（544 个有种子比较）。这使用相同底层 Web RNG 按 C 给出的调用序列复演；不声称 stub 是完整 CE RNG 引擎。

新增 [x2o_horde_clump.test.ts](../../src/test/x2o_horde_clump.test.ts) 8 项，包含：

- 175 行/91 个成员三元组、CE 源码来源哈希逐一相等。
- **全部 70 条 CE 映射 Web 蓝图**的上下界相等，并测试下界前/下界/上界/上界后资格；11 条无 CE 来源的历史自创蓝图必须仍在退役集合；CE48 在 CE 自身的 frequency=0 且名字注明 `DISABLED (Not fun enough.)`，Web 原本未纳入；显式锁住这项排除，不虚报 71 行 Web 均存在。
- 全表 horde 的成员骰顺序与参数、领袖/俘虏路径；真实开阔地/深水落下 GOLEM/KRAKEN 全部抽中成员，验证唯一占位和领袖引用；全部召唤行实际消费者。
- 原 C 全分支和两条真实 RNG 流；常量、反向区间、clump=0、clump 大于区间等边界。

专项加现有 horde 目录测试 **33/33**：[结果](x2o-evidence/targeted.json)。5 个隔离故障变体（普通路径恢复均匀、召唤恢复均匀、目录丢 clump、CE65 最大深度错为 40、余数骰错误）全部被实际断言检出：[结果](x2o-evidence/negatives.json)。变体只由专用 Vite 配置加载，不改坏工作树文件。

## 3. 原守卫前提修订（交验收方裁决）

`src/data/hordes.test.ts` 的 7 项严格对象比较原来只允许两个数量分量，新增 clump 字段会使它们翻红。先跑原文件及 UR2–4 **28/28**，再保留改数据后的 **7 项失败**，确认失败仅为多出 CE 字段。原文件字节与 HEAD 一致，SHA 与失败名称见 [来源记录](x2o-evidence/premise-provenance.json)，[原文件](x2o-evidence/hordes-test-before.txt)、[原先通过](x2o-evidence/premises-head.json)、[修改后失败](x2o-evidence/first.json)。

仅给这些成员对象增加独立 CE 表确认的 `clumpFactor`（KRAKEN=2，其余被抽查成员=1）及测试接口字段。原上下界、物种、行号、全表计数、频率、深度与严格相等断言均保留，没有改为部分匹配、删断言、减样本或放宽超时。新全表守卫另做独立三元组相等。该旧形状前提的修订作为提案交验收方裁决。

其余既有守卫未修改。新测试开发首轮另有两个夹具问题：GOLEM 名称误写成 STONE_GOLEM，以及资格检查未传 category 隐含的 required flag，均修在新测试本身；未据此更改生产行为。

## 4. 生成流与一次重捕获

先运行原 shallow drift 与独立 deep baseline，均 1/1 通过：[浅层](x2o-evidence/drift-initial-summary.json)、[深层](x2o-evidence/deep-initial-summary.json)。当时生产源码、原测试和基线未变；记录中的输入变化仅为并行编写的新 oracle/归因辅助文件，未将这两次入场检查称为最终冻结门禁。

[归因脚本](../../scripts/x2o-attribution.mjs)以独立 esbuild bundle 隔离三阶段，原阶段从 HEAD 读三个生产文件，后续只开启指定变化；每阶段沿原 `u26a-observe.ts` 方法做相同 4 种子 × D1–40，并按原 UR2/UR3/UR4 捕获方法输出到证据目录。没有在归因阶段改黄金文件。[阶段源代码](x2o-evidence/sources-depth.json)、[归因结果](x2o-evidence/attribution.json)。

| 单变量 | D1–26 | D27–40 | UR2 / UR3 / UR4 |
|---|---:|---:|---|
| 原规则 → 完整 horde clump | 104 层，所有观测字段零差异 | 42 层、232 个观测字段变化（包括 RNG、完整实体等） | 全部零差异 |
| clump → 再加蓝图深度修正 | 零差异 | 零差异 | 全部零差异 |

实际滚动基线字段口径为 fp/n/species/items；深层另含 gems。深层 **27/56 层、73 个字段**变化：n 21、species 25、gems 18、fp 7、items 2。种子 777/424242/20260913 首次基线差异 D30，31337 首次 D31；RNG 在成员骰变化后传到后续生成属于已归因的预期变化。蓝图范围调整没有带来额外地图变化，与 CE/Web 强制编号 bypass 的语义相符。

[一次重捕获脚本](../../scripts/x2o-recapture.mjs)在独立守卫和故障变体通过后，先校验全部保护文件仍为入场 SHA、原阶段能重现旧浅/深基线、生产源仍等于已归因版本，再各写浅/深文件一次。浅层维持原元数据及相同字节；深层单独更新，未把它合并进浅层。三份黄金 trace 候选全等原件，因此 **writes=0**，无需重录。[登记与全部字段差异](x2o-evidence/recapture.json)。

| 文件 | 入场 SHA-256 | 交付 SHA-256 |
|---|---|---|
| shallow generation baseline | `8de4bb7a4f3fa40f72bd2f5b511699dff771b846131c65d72f4c3e6788ec8580` | 相同 |
| independent deep baseline | `88292abc0246369d5f4fcf5291a3e102ab44c40ed19accf1f28032de87716155` | `1360215b7bb2ab69528831f9b9b8f989ef9fa334af127b037598fbbed36b4a60` |

P2 历史 fixture、两个基线守卫、UR2/3/4 黄金、package/config 均保持原 SHA，完整列表见 [before](x2o-evidence/baseline-before.json) / [after](x2o-evidence/baseline-after.json)。

## 5. 浏览器

使用 develop-web-game 标准 Playwright 客户端运行开始游戏和移动操作，取得 `render_game_to_text`；其 canvas 导出黑图，只计操作/文本证据，**不计视觉通过**。另用 [headed 浏览器脚本](../../scripts/x2o-browser.mjs)在真实 D30 生成后的明确合成场景验证：GOLEM 领袖+6 成员、KRAKEN 领袖+8 成员，两次都是 `{5,10,2}` / 两个随机数；真实 `.` 等待后，完整 JSON 快照往返成功且结构差异为 0。

页面/console errors=0；[结构化状态](x2o-evidence/browser.json)、[魔像截图](x2o-evidence/browser-golem.png)、[克拉肯截图](x2o-evidence/browser-kraken.png)均已打开检查。克拉肯自然潜没，夹具使用正确的 `telepathy` 状态显示其位置，不修改怪物潜没规则。

探索浏览器最初直接改 depth 而未执行生成，存档校验器正确拒绝（currentLevelDepth/visited 不一致）；后来又纠正夹具状态名 `telepathic` → `telepathy`。两项均只修浏览器辅助脚本，未改存档或显示生产逻辑。原失败记录保留在 `browser-first/` 与 `browser-diagnostic.txt`。为冻结验证输入，两次刚启动的门禁已中止并归档，不计完成全量；见 [第一次中止](x2o-evidence/full-attempt1-cancelled.json)、[第二次中止](x2o-evidence/attempt2-cancelled.json)。

## 6. 最终门禁与复跑声明

[反向依赖与语义闭包](x2o-evidence/closure.json)以 Game、hordes、blueprints 为种子，沿 TypeScript 导入关系反查得到 **R=205** 个测试文件；S 另并入语义匹配、任务书点名的 **57** 个文件和 **69** 个源码/文件读取守卫，最终 **R∪S=212**。包含 p1_30、U24、U01/U03、U18a*、U19*、U26a、V、horde_*、monster_*、c_* 与 UR2–4；完整发现清单共 216 个文件，其中浅层 generation_baseline 按原配置由 test:drift 单独运行，其余 215 个由 npm test 运行。最终以实际通过文件核对，**212/212 闭包文件、216/216 发现文件全部通过，无遗漏**。

第一轮完整全量（归档 attempt3）已于 2026-09-27 17:23 CST 结束：**215 文件、3970 通过 / 3 失败、8 既有 skip / 5 todo**，3545.648 秒，退出 1。三个失败均为原 **900000ms 超时**：B2 普查、blueprint_center 全局扫描、W5 生成普查；无断言值错配。966 输入及 216 文件发现清单零变化。[完整原日志](x2o-evidence/full-attempt3.txt)、[完整 JSON](x2o-evidence/full-attempt3.json)、[总结](x2o-evidence/full-attempt3-summary.json)、[错误分类](x2o-evidence/attempt3-timeouts.json)。Vitest JSON 把异常正文记成 STACK_TRACE_ERROR，具体超时原因以原文本日志为准。

只读进程检查观察到同机另有 9 个 Vitest worker，竞争负载与耗时增长相符；这项环境归因随后由相同输入、原门限的完整复跑通过得到支持。原源码、测试、样本数和超时全部保留。等其他 worker 连续三次（间隔30秒）为0后，已完整执行 build → npm test → drift → independent deep。负载记录见 [retry-load-checks.json](x2o-evidence/retry-load-checks.json)。

**最终复跑声明：2026-09-27 17:38:10–18:07:39 CST（09:38:10–10:07:39 UTC），以下四条命令在同一份冻结输入上顺序完整结束，全部退出 0。** 表中省略只影响证据输出的 reporter/outputFile 参数；完整 argv、起始时间、文件计数和每次前后输入 SHA 见各总结。

| 门禁 | 最终实际结果 | 耗时 |
|---|---|---:|
| `npm run build` | 通过 | 6.141 秒 |
| `npm test -- --maxWorkers=6` | **215 文件、3973 通过、0 失败**；8 既有 skip、5 todo | 1696.043 秒 |
| `npm run test:drift -- --maxWorkers=1` | 独立浅层 1/1 通过 | 25.339 秒 |
| `npm test -- src/test/u_26a_deep_baseline.test.ts --maxWorkers=6` | 独立深层 1/1 通过 | 40.567 秒 |

[构建总结](x2o-evidence/build-final-summary.json)、[完整全量总结](x2o-evidence/full-final-summary.json)、[全量原日志](x2o-evidence/full-final.txt)、[浅层总结](x2o-evidence/drift-final-summary.json)、[深层总结](x2o-evidence/deep-final-summary.json)。此前三个超时用例在原 900000ms 门限内通过：B2 普查 **411.591 秒**、blueprint_center 全局扫描 **514.307 秒**、W5 生成普查 **463.141 秒**。与首轮完整全量的 **966 个输入逐项相同**，无调整样本、断言或门限：[输入一致性](x2o-evidence/retry-input-equivalence.json)。

最终 [机器核验](x2o-evidence/final-checks.json)确认四次门禁的 966 项输入 SHA 和 216 项发现清单彼此相同、运行前后均零变化，当前文件也仍与冻结输入相同；R=205、R∪S=212、点名57、源码/文件读取69均覆盖。12 个保护文件中仅已登记的深层基线变化，浅层与 UR2/3/4 保持原 SHA；独立 CE 黄金表的来源文件哈希仍一致。全部新增/修改文本无 CRLF，`git diff --check` 通过。最终门禁之后仅补报告、进度和证据结果，未修改源码、测试、配置或黄金输入。浏览器与开发预览服务已关闭，未暂存、未提交。

