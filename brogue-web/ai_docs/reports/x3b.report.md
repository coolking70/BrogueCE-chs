# X3b：共同命令边界归一化与力量需求 0 的详情

2026-09-27，Windows / Asia/Shanghai。工作树基准 `dff9441cfb2587dd69a61f54704f81ab1a06336c`。**XN02、XN03 已修复，最终完整全量、R∪S、build 和 test:drift 均通过。** 规格采用任务书 §0 实际引用的 [X-2 §6 XN02、XN03](x-2-survey.report.md)，承接 [X-0](x-0-survey.report.md) 的 K16（显示/逻辑隔离）、K26（详情须与实际模型一致）。本轮没有修改生成流程、战斗规则、既有守卫或黄金基线。

## 1. 实现

### XN02：录制、回放和自动步进共用归一化入口

`Game.applyCommand` 在任何命令分派前调用 `finishTransientDisplay()`。实时输入、物品命令的可选回调、`replayStep`、自动回放及 `replaySeek` 都经过这里；系统来源的动作也接到该入口。原先 `executeCommand` 和 `performPlayerAction` 内的清理已移出，避免物品命令绕过后者。

公开 `stepAutoPath` 原有独立录制逻辑改为 `executeCommand('auto_step')`；其动作部分保留在 `performAutoPathStep`，由同一分派器执行。这样自动步进也先归一化，再检查目标和可见内容，并沿用命令完成后的 checkpoint 提交流程。推进中的系统调用保留原有 `!isAdvancing` 限制，不在回合中途清理动画。

`completeReplayEvent` 的时间、深度、位置、回合、两流 RNG、确认决策数量和结局比较逐字未改。flare 的采样流、队列预采样、知识揭示和生成流程也未改。

### XN03：实际需求与战斗伤害函数

`DetailGenerator` 对武器和护甲改用 `strengthRequired ?? 0`。0 保持有效；字段缺失才使用战斗侧的 0 回退，不能再默认成 12。力量需求 0 本身也显示在详情行。

武器实际伤害复用战斗已有的 `netEnchant` 和 `enchantedDamage`，并使用相同的端点下限 `Math.max(1, ...)`。附魔为 0 但力量有盈余/不足时仍显示已鉴定实例的实际伤害；颜色按净附魔方向。基础伤害解析继续复用 `CombatSystem.parseDamageString`。护甲保留既定的 `armor + netEnchant` 显示口径，仅修正需求输入。

所有实际数值仍受 `knowledge.instanceKnown` 约束，符文仍受原知识门约束。未鉴定实例只给基础种类信息和力量需求，不泄露附魔、实际伤害/防御或未知符文。

CE 对照：`Combat.c:66–83` 按真实需求计算力量修正及净附魔；`Items.c:7841–7850` 将武器/护甲力量需求下限设为 0。本轮复用既有战斗实现，没有让战斗迎合错误显示。

## 2. 新守卫与可复现证据

新增 [显示/录像守卫](../../src/test/x3b_display_recording.test.ts) 4 项、[详情守卫](../../src/test/x3b_item_details.test.ts) 13 项，共 17 项。

| 场景 | 实际验证 |
|---|---|
| X-2 最小镜像 | 黑暗玩家 `(10,10)`、rat `(14,10)`，真实 `quaff → flare → use → confirm`。flare 确实暂时照亮 rat；命令入口后默认 cursor 为玩家，确认不发射，魔杖仍为 10 发。 |
| 显示间隔 | 不插帧、10ms 单帧、9×1ms、20×10ms、1000ms 跳帧及混合间隔；同时调用真实 flare、地形动态色和 lightMap 展示入口，比较目标、物品资源、怪物状态、时间、两流 RNG 和结局。 |
| 物品交叉与结局 | 镜像夹具通过真实命令读附魔/鉴定卷轴、选目标、拒绝再接受已知黑暗药水、法器选点/确认、投掷飞镖，最后携护符从楼梯逃出，确实进入胜利状态。六种显示间隔的动画单步回放逐条状态相等。 |
| 回调与自动步进 | 可选 `perform` 回调观察到基础可见性；公开 `stepAutoPath` 生成唯一 `auto_step` 记录并真实移动。 |
| 自然新局录像 | seed **25**、公开 **wizard 模式**、自然 D1→D2，**252 条事件 / 241 回合**。不注入地图、位置、物品、怪物或 RNG；经移动拾取魔杖、卷轴、力量药水，附魔选物、喝药发光、法器选点/确认、投掷、背包/帮助、自动行走和真实下楼。 |
| 自动回放 / seek | 上述自然记录在无帧录制与 10ms 帧录制时逐事件及逐状态完全相同；同步、动画自动回放和不同显示间隔均一致。向 flare 后、向前及向末尾 seek 后状态与原录制对应点相同。 |
| 真坏记录 | 分别只损坏 `tick`、`turn`、`depth`、玩家位置、主 RNG、cosmetic RNG、确认决策、结局；每条记录均保持结构合法并准确停在首个坏命令，报告对应 `OOS at command N`，不放宽比较。 |
| 详情 | 需求 0、10、12、15、缺失；未鉴定 0/正需求/缺失；附魔 0 与 12 的真实近战端点；护甲的 0/正需求/缺失与未知边界。力量 12、匕首 3–4、E12、需求 0 显示 **7–10**，不再是 6–8。 |

[可直接导入的完整自然录像](x3b-evidence/public-recording.json) 保留 seed、mode 和全部 checkpoint，`recordedAt` 仅规范为 0。该录像是自然生成地图上的 wizard 局，不冒充 normal 难度、完整深层通关或浏览器实测；最小故障与胜利测试是明确的镜像内存夹具。

逐命令观测直接读取状态，不调用自带瞬态清理的 `toSnapshot()`，也不替换被测命令/帧函数，避免观测工具先清理显示而掩盖故障。

改前仅新增最小守卫、未改生产代码时，9 项中 **3 失败 / 6 通过**：[改前结果](x3b-evidence/before.json)。失败分别为插帧后回放默认目标变成 rat、0 需求伤害、缺失需求回退；正需求和未知信息门通过。修复及扩展后 **17/17 通过**：[专项结果](x3b-evidence/complete-targeted.json)。现有守卫没有改写前提或断言，不需要旧规则反事实裁决。

## 3. 反查与门禁

[反查清单](x3b-evidence/rs-closure.json)：R 为两个修改模块的 TypeScript 传递反向依赖加显式语义守卫，S 保守纳入所有测试中的 `readFile` / `readFileSync`（含 fixture 读取）。R **208** 文件，S **69** 文件，并集 **209** 文件。覆盖 p1_30、U24、U27、X2a、X2m、X2d、UR2/UR4、DetailGenerator.test、ui_*、鉴定知识门、调度、存档与深层基线。源码守卫本身也执行，不调整扫描白名单。

| 门禁 | 结果 | 证据 |
|---|---|---|
| 新增守卫 | 17 passed，0 failed | [专项](x3b-evidence/complete-targeted.json) |
| 既有重点首轮回归 | 通过；包含 X2a、U27、X2m、UR2/UR4、DetailGenerator、护甲详情 | [首轮回归](x3b-evidence/initial-targeted.json) |
| `npm run build` | 退出 0，19.267 秒，含 vue-tsc 与 Vite | [摘要](x3b-evidence/build-summary.json)、[日志](x3b-evidence/build.txt) |
| `npm run test:drift -- --maxWorkers=1` | 1 文件 / 1 项通过，退出 0，46.137 秒 | [摘要](x3b-evidence/drift-summary.json)、[完整结果](x3b-evidence/drift.json) |
| 全量 `npm test` | **218 文件，4000 passed，0 failed，8 skipped，5 todo**，4013 项总计；退出 0，1796.966 秒 | [摘要](x3b-evidence/full-summary.json)、[完整结果](x3b-evidence/full.json)、[日志](x3b-evidence/full.txt) |
| R∪S | **209 文件，3882 passed，0 failed，8 skipped，1 todo**；没有漏跑文件 | [逐文件/断言结果](x3b-evidence/rs-results.json)、[交付审计](x3b-evidence/delivery-check.json) |
| 深层与黄金 trace | `u_26a_deep_baseline` 1 项、`u_26a_deep_levels` 16 项、UR2/UR4 各 1 项在最终全量中通过，原文件未变 | [完整结果](x3b-evidence/full.json)、[保护文件哈希](x3b-evidence/baseline-after.json) |

最终完整全量从 **2026-09-27 20:25:40 到 20:55:36（UTC+08:00）**，约 **29 分 57 秒**，没有中途停止。13 个 skipped/todo 都来自未改动的既有测试（P2-1/2/3 的 8 个退役相位守卫、smoke 的 1 个占位、CombatFormulas 的 4 个占位）；本轮新增 17 项全部执行并通过，没有新增跳过项。R∪S 结果取自这次完整全量加独立漂移门禁，不以专项子集替代全量。

执行器为 [x3b-validate.mjs](../../scripts/x3b-validate.mjs)，从 `brogue-web` 目录运行 `node scripts/x3b-validate.mjs full` / `build` / `drift`。`full` 实际调用 `npm test -- --maxWorkers=8 --reporter=json --outputFile=ai_docs/reports/x3b-evidence/full.json`，仅控制并发和报告器，保留 package.json 原脚本及测试配置，另外独立执行 `test:drift`。

第一轮全量使用 2 worker，于 19:10:53 启动；确认本机有 16 个逻辑核心后，为纠正过低的并发，于 20:25:12 主动中止并改用 8 worker 从头运行。该轮耗时 4459.071 秒、进程退出 1，未产出完整测试结果；[中止摘要](x3b-evidence/interrupted-full-summary.json)、[日志](x3b-evidence/interrupted-full.txt) 明确保留，**不计为测试失败归因，也不计为门禁通过或完整执行**。没有因此调整用例、超时、生成配置或基线，最终结论只采用完整结束的一轮。

本机受限沙箱阻止 Node 启动 esbuild / git 子进程（`EPERM`），验证使用获准的沙箱外子进程执行；没有修改依赖或测试配置绕过错误。

## 4. 基线、范围与交付

UR2/UR4 首轮及最终全量均与原黄金 trace 相等，无需重录。`test:drift`、深层基线文件、黄金 trace、package.json 和 vite.config.ts 共 17 个保护文件的 SHA-256 见 [门禁前](x3b-evidence/baseline-before.json)、[门禁后](x3b-evidence/baseline-after.json)，**17/17 相等**。最终交付审计由 [x3b-audit.mjs](../../scripts/x3b-audit.mjs) 输出 [delivery-check](x3b-evidence/delivery-check.json)：保护文件变化、CRLF、`git diff --check` 输出、暂存内容均为空；并记录最终源码/新增测试哈希。

自然录像路径准备时观察到公开 test 展陈模式的楼梯无法按普通移动进入；没有为此更改玩法，改用自然生成的 wizard 新局。该旁支不属于 XN02/XN03 的修复声明。

没有更改战斗数学、生成采样、两流分工、checkpoint 比较或既有测试。没有操作浏览器；不声明 CE 二进制录像兼容、normal 全深层通关、全部数值详情或一般生成逐骰对齐。

**最终复跑声明：** 上述完整轮在最终生产代码和测试上运行完成；最终轮之后只补充本报告及只读审计结果，未再修改生产代码、测试、配置或基线。既有跟踪文件仅 `Game.ts`、`DetailGenerator.ts` 有代码差异；新增内容为两份 X3b 测试、两份验证/审计脚本、本报告和 `x3b-evidence/`。HEAD 保持 `dff9441cfb2587dd69a61f54704f81ab1a06336c`，未暂存、未提交 git。
