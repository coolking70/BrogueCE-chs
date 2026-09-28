# X-3：交互与自动行动层 CE 对照勘察（只读）

> 执行环境：Claude Code 云端会话。仓库 `https://github.com/coolking70/BrogueCE-chs`，基线 `main`。
> **只读勘察：不修改 `brogue-web/src/`、`brogue-web/scripts/` 下任何文件。** 只新增报告文件；在分支 `survey/x-3` 上提交并推送，**不要推送 main、不要打标签、不要动 gh-pages**。

## 0. 背景

brogue-web（`brogue-web/`，TypeScript/Vue）是 Brogue CE（C 源码在 `BrogueCE-master/src/brogue/`）的网页移植。规则层（战斗、生成、物品、怪物 AI）已经过 X-0/X-1/X-1b/X-2 四轮勘察与约 4000 项测试守护（结论见 `brogue-web/ai_docs/reports/x-*-survey.report.md`，勘察时可参考其格式）。
但用户试玩接连发现**交互/自动行动/消息层**的偏差，这一层从未被系统对照：
- 自动探索按整条旧路径走、揭示新墙即报"此路不通"（X4a 已修）；
- DF 地形描述（`flavorMessage`）被写进行动日志刷屏（X4b 修复中）；
- 探索中遇敌连续攻击缺少 CE `startFighting`（`Movement.c`）的停止条件：`player.currentHP > expectedDamage` 保命刹车、`rogue.disturbed`（`IO.c:3464` 任何 `message()` 都置位）打断；web 没有这段逻辑（**已知，列入清单即可，不必深挖**）。

项目裁决（勿列为差异）：不追求同种子逐骰一致；不兼容 CE `.broguerec`；不做旧存档迁移；不做无障碍。

## 1. 勘察范围（逐项对照 CE → web，给出 CE 文件:行 与 web 文件:行）

**A. 按键命令表**：以 CE `executeKeystroke`（`IO.c`/`Movement.c`/`Items.c` 的命令分派）为清单，逐个命令对照：移动/奔跑（shift/`travel` 方向）、`x` 探索、`z`/`Z` 休息与搜索（含 `searchTurns`、`autoRest`）、`s` 搜索 5 回合、`>`/`<` 旅行到楼梯、点击旅行（`travel`/`travelRoute`/`travelMap`）、拾取、投掷、使用/喝/读/装备/卸下/丢弃/重命名、`\`/发现屏、`i` 背包、消息历史、`Z` 长休息、自动下楼等。每项记录：触发条件、耗时（回合/速度）、停止条件、确认提示、失败文案，web 是否一致。

**B. 自动行动打断**：枚举 CE 全部 `rogue.disturbed = true`、`rogue.automationActive`、`pauseAnimation` 返回值、`isDisturbed()`、`MB_ALREADY_SEEN` 相关位置，逐一查 web 等价实现（`Game.ts` 的 `stepAutoPathInner`、休息/搜索循环等），列出缺失或语义不同之处。

**C. 消息去向**：CE `message()`（及 `REQUIRE_ACKNOWLEDGMENT`、`REFRESH_SIDEBAR` 等标志）、`messageWithColor`、`combatMessage`/`displayCombatText`（`blockCombatText`）、`flavorMessage`、`temporaryMessage`、`confirmMessages`、`updateFlavorText` 的每类用途，对照 web `logger.log` 等调用；列出应进位置描述行却进了日志、应需确认却没有、应合并却刷屏等差异。可按调用点抽样+全量 grep 统计结合，给出覆盖说明。

**D. 确认与防呆**：CE 所有 `confirm(...)` 调用（走进岩浆/火/深水/陷阱、丢弃或投掷已装备物品、读未知卷轴时的限制、下楼时有盟友/物品等）与"Not while you're confused/trapped"类拒绝，对照 web 是否存在。

**E. 其它交互层**（发现即记）：光标/悬停描述、`describeLocation`、侧栏实体列表排序、`playerTurnEnded` 中对玩家可见的提示时机、自动拾取与"你看到了…"的时机。

## 2. 方法要求

- **以 CE 源码为准**，每条差异必须有 CE 出处（文件:行）与 web 出处（文件:行）；只凭推测的条目标为"待证"。
- 能用测试或脚本证实的，写最小复现（可在报告附录给出 vitest 片段或 `node` 脚本，但**不要提交到 src/**）。云端跑测试只允许 `npx vitest run <单个文件>` 规模，**不要跑完整 `npm test`**。
- 不修改任何生产或测试代码。

## 3. 交付

- 报告 `brogue-web/ai_docs/reports/x-3-survey.report.md`：
  1. 总表：编号（X3-A01…）、类别、严重度（S1 影响游玩决策/安全，S2 明显体验偏差，S3 细节）、CE 出处、web 出处、现象、建议修法、建议门禁档位（轻/中/全量，定义见下）。
  2. 按 A–E 分节的详细说明。
  3. 建议的修复单元分组（每组可独立执行、互不冲突，注明涉及文件）。
  4. 覆盖声明：每类枚举了多少 CE 位置、核对了多少、未核对的原因。
- 门禁档位定义：轻＝纯前端；中＝引擎非规则（消息/显示/自动行动流程）；全量＝规则/生成/RNG/存档。
- 在分支 `survey/x-3` 提交报告并推送；最后回复报告路径、差异条数（按严重度）与修复单元分组摘要。
