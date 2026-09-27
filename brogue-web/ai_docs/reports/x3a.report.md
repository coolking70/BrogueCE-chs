# X3a：完成死亡事务的对象退出活体判断

执行 `ai_docs/tasks/x3a.prompt.md`，权威规格为 X-2 §6 XN01。工作项目为 `brogue-web/`；未暂存、未提交。

已修复 XN01，并完成当前项目全部怪物名单及派生可见缓存的消费盘点。新增共享 `iterateCreatures`，按 `deathProcessed` 排除已完成死亡事务者。死亡事务内占用、落物/DF、寄宿释放、回合尾物理清扫与复活载体保持原职责；没有改生成器、TimeCoordinator、既有测试或生成基线。

## 1. CE 核实与实现

本地 CE `Monsters.c:925–949` 在初始化和前进时跳过 `MB_HAS_DIED`，不按 `currentHP` 或 `MB_IS_DYING` 过滤；`:1754` 的恐惧扫描先处理玩家再用该迭代器。`Combat.c:1934–2045` 同步处理死亡，落物/DF 期间仍保留占用，在设置 `MB_HAS_DIED` 时清格占用；`RogueMain.c:951–980` 的后续清扫直接走链表，必须能访问死者。因此没有用提前删除怪物来修 AI。

| 修改 | 结果与 CE 依据 |
|---|---|
| `Core/MonsterLifecycle.ts` | 提供不改原表、不取 RNG 的活体迭代器；HP=0 但事务未完成仍可迭代。 |
| `Combat/MonsterAI.ts` | 恐惧和队友唤醒扫描接入迭代器，保留 player-first 和原额外条件。对应 Monsters.c:1601、1754。 |
| `Combat/MonsterBlink.ts` | 最近敌人/敌图复用迭代器；走廊避让不把死随从当成队伍。CE 的领导位在 Combat.c:2044 调用 `checkForContinuedLeadership`，后者 Monsters.c:4090 排除死者。 |
| `Core/Game.ts` | 开笼救援、活跃/休眠领袖降职、DF 唤醒休眠怪过滤完成死亡者；自动探索与自动行进复核旧 visibleMonsters 缓存。对应 Monsters.c:4116/4146、Architect.c:3489、Movement.c:1851/2278 及按格救援。 |
| `components/AgentControls.vue` | 辅助 DOM 不再显示尚未摘链的完成死亡对象；其原距离策略保持。 |

[逐消费者核查表](x3a-evidence/consumer-audit.md) 给出各消费点的实际 CE 访问方式、原有保护及改/不改理由。AST 盘点记录 **26 文件、245 个表达式**，包括转发、嵌套和非活体引用；独立全文反查覆盖 `monsters`、参数别名、休眠/邻层表、可见/历史缓存。另保存 **84 个 CE 迭代/直接链表锚点**。

恐惧、寻敌、盟友选敌、气味、召唤计数、群体效果、领袖/随从、目标选择、光源、UI 均已核查。已有 `hp > 0`、可见性函数或 `getMonsterAt` 守卫的消费者保留；死亡事务、清扫、完整实体图和生成所有权记录继续读取原表。

## 2. 守卫与反向验证

新增 [x3a_live_iteration.test.ts](../../src/test/x3a_live_iteration.test.ts) **23 项**，没有修改既有守卫：

- 直接提取、编译原 CE 的三个迭代函数，比较 8 项名单的全部 **256 种死亡标记组合**，包括首/中/尾死者、全死、空输出及 HP 与标记分离；[C 源码与 SHA](x3a-evidence/ce-iterator-source.json)。这是静态名单的原 C oracle，不把它宣称为完整引擎或链表变更时序 oracle。
- seed22013 的死亡 revenant 放在表首/中/尾，真实 `takeDamage → updateMonsterState → executeCommand('wait')` 与显式清扫对照比较状态、位置、HP 及完整两流状态。
- 死亡 DF 回调期间检查原格仍占用、未完成对象仍能迭代、落物已发生；重入不得重复 DF；完成后名单保留但不占格、不参加活体判断。
- 寄宿释放存活/接触致死、爆炸连锁、purgatory JSON 往返/复活/再次死亡。
- 不可见死敌不得消耗目标 RNG；施法不得治疗尸体；召唤计数、队伍唤醒、气味方向、敌图/安全图、群体 discord/negation、光照、目标列表和侧栏均与完成死亡边界一致。
- 最后一个死亡随从不再维持走廊避让；死亡休眠随从不参与降职或 DF 唤醒；开笼不把死囚犯招为盟友；尚未刷新的可见缓存不偏转/中止自动路径。

[故障注入](x3a-evidence/negative-summary.json)在 `/tmp` 的独立源码副本进行，**11 个变体全部检出，共 19 个失败测试项**。包括去掉恐惧过滤、全局不滤死、错误用 HP 代替完成标记、提前固化过滤结果、死随从/死囚犯/死休眠激活和三个可见缓存遗漏。工作区生产代码未被故障注入改写，原守卫未放宽。完整失败输出保留在 `negative-*.txt/json`。

## 3. 浏览器与生成/录像

最终 [浏览器记录](x3a-evidence/browser.json)采用 seed22013 的明确平地夹具，调用真实死亡入口，并以实际键盘等待推进。不是自然发生率证明。

| 时点 | revenant | rat | 主 RNG 计数 |
|---|---|---|---:|
| 活体 | HP30、占格、在名单 | (12,10)、HUNTING | 2570 |
| 死亡事务完成、未清扫 | HP0、processed=true、不占格、仍在名单 | (12,10)、HUNTING | 2570 |
| 实际等待结束 | 已按原尾声摘链 | (11,10)、HUNTING | 2574 |
| 预先清扫后等待的对照 | 已摘链 | (11,10)、HUNTING | 2574 |

真实 DOM 的辅助怪物行只有存活 rat，没有 HP0 行；画面、侧栏和 `render_game_to_text` 一致。**0 页面/控制台错误**。已实际查看 [死亡未摘链](x3a-evidence/browser-dead-listed.png)、[回合结束](x3a-evidence/browser-turn.png)截图。

按 develop-web-game 技能执行标准 `web_game_playwright_client.js`，移动/等待的文本记录正常；有头运行的 canvas 单独导出仍为既有黑图问题，未把该图当作视觉通过，使用上述有头整页截图验收。技能日志的 Node 模块类型提示不属于页面错误。

额外在临时副本对楼梯位置预留集合做只读插桩，原 U26a D1–40 基线通过，**165 次生成事务中 active/dormant 的完成死亡数均为 0**。该集合包含待实现机器产物，保留原构造期预留合同；观察不推广到任意合成载荷。见 [生成名单探针](x3a-evidence/generation-roster-probe-summary.json)。

浅层 `test:drift` 与独立深层基线均通过，受保护的浅/深 fixtures、原守卫、P2 baseline 和 UR2/3/4 黄金保持原字节。UR2/3/4 的正常比较结果见最终门禁表；没有开启 CAPTURE 环境变量，也没有重录黄金。

## 4. 最终门禁与复跑声明

最终冻结门禁于 **2026-09-27 19:05:11–19:38:12（Asia/Shanghai）** 执行，四项均退出 0。全量为一次完整的 `npm test -- --maxWorkers=6`，保留默认文件并行、原样本、原断言和原超时；没有拼接局部结果。

| 门禁 | 最终结果 | 实际耗时 | 证据 |
|---|---|---:|---|
| `npm run build` | 通过，退出 0 | 6.324s | [build-final.txt](x3a-evidence/build-final.txt) |
| 完整 `npm test` | **217 文件；4006 passed / 0 failed / 8 skipped / 5 todo** | Vitest 1974.20s；含前后检查 1974.956s | [完整输出](x3a-evidence/full-final.txt)、[JSON](x3a-evidence/full-final.json) |
| `npm run test:drift` | 原浅层基线 1/1 | 48.089s | [drift-final-summary.json](x3a-evidence/drift-final-summary.json) |
| 独立 U26a 深层基线 | 1/1；全量中也通过 | 80.665s | [deep-final-summary.json](x3a-evidence/deep-final-summary.json) |
| UR2 / UR3 / UR4 原黄金 | 3/3；全量中也通过 | 103.32s | [traces-final.txt](x3a-evidence/traces-final.txt) |
| X3a 新守卫 | 23/23；含 256 组原 C oracle | 纳入完整全量 | [专项 JSON](x3a-evidence/targeted-third.json) |
| 反向验证 / 浏览器 | 11/11 故障变体检出；0 页面错误 | 见逐项记录 | [故障注入](x3a-evidence/negative-summary.json)、[浏览器](x3a-evidence/browser.json) |

8 项 skip 来自既有 P2-1/2/3 退役基线测试，5 项 todo 来自既有 CombatFormulas 与 smoke 占位；本轮没有新增或修改 skip/todo。构建仅保留现有大 chunk 提示。

反向依赖 **R=205**；S 的直接源码读取守卫 70、AI/生命周期语义守卫 89、点名清单 44；去重后 **R∪S=212，实跑覆盖 212/212**。另用 `readFile|node:fs` 反查 76 个文件，额外 6 个间接/命名空间读取者也全部在闭包中。点名的 **p1_30、U24、U12a/b、U16、X2j、X2k、X2l、ai_*、p4_*、w_*** 无遗漏。全量 217 文件加 drift 的 1 文件覆盖全部 **218** 个发现文件。见 [闭包](x3a-evidence/closure.json)、[读取者补查](x3a-evidence/reader-crosscheck.json)及 [最终核对](x3a-evidence/final-check.json)。

四项门禁使用完全相同的 **987 个冻结输入**，各轮前后输入及 218 文件发现清单变化均为 0；四份输入清单 SHA-256 均为 `66b540b158e3fce261a4d41b4353072169f99bdbf432b15216e2fb1f00e802ac`。12 个受保护文件 SHA 不变，包括浅/深基线、P2 fixtures、UR2/3/4、生成基线守卫、package 与 Vite 配置。所有既有测试原文未改，`git diff --check` 通过，变更文本 CRLF=0，暂存区为空。

**最终复跑声明：**补齐休眠激活与可见缓存守卫后，从头完整运行上述冻结版全量；最终构建、浅层 drift、独立深层、原黄金、专项及反向验证均实际执行通过。中止的 `full-interim` 不计作通过。本次完整全量结束后只补报告和派生证据，没有再改生产代码、测试、验证脚本或基线。浏览器及本任务预览服务已关闭，未暂存、未提交。

完整 `npm test` 输出尾部：

```text
 ✓ src/test/w_5_arcana_instance.test.ts (18 tests) 403054ms
     ✓ versioned JSON snapshot preserves independent E, capacity, depletion and unknown-state flags on ground / in pack  645ms
   ✓ W-5 generated results: 12 fixed seeds (W-24/W-25/W-26 coverage supplements) × D1–26 retain category coverage and obey initial per-kind values  402392ms

 Test Files  217 passed (217)
      Tests  4006 passed | 8 skipped | 5 todo (4019)
   Start at  19:05:18
   Duration  1974.20s (transform 5.43s, setup 0ms, import 130.72s, tests 11076.93s, environment 63ms)

JSON report written to /Users/coolking70/.codex/worktrees/b1a9/brogue/brogue-web/ai_docs/reports/x3a-evidence/full-final.json
```

`npm run build` 输出尾部：

```text
dist/assets/index-IrsQ0CSR.js               1,364.63 kB │ gzip: 393.34 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.70s
```

## 5. 与预设不符及保留边界

- 范围并不只含 `[player,...monsters]`：派生 `visibleMonsters` 的旧缓存与 `dormantMonsters` 激活同样会漏过死亡边界，故纳入修复与反向守卫。已有多数 HP/可见性守卫正确，不作无必要重写。
- **不能把 CE 的 purgatory 迭代机械替换到 web**：CE `RogueMain.c:968` 入 purgatory 时清掉 `MB_HAS_DIED`，所以 Monsters.c:2899 可用活体迭代器；web X2k 的快照合同保留 `deathProcessed` 到复活时才清。保留原 web purgatory 读取，并以往返/复活交叉守卫保护。不是提前清掉 active/dormant 的死亡标记。
- 新 helper 对齐活体集合和扫描顺序，并在每次访问时检查完成标记；不声称复制 C 游标预取 next 的全部内存级突变行为。DF 唤醒沿用原稳定 cohort，未改变 TimeCoordinator 的行动 cohort 或新生对象调度边界。
- 既有跨层召唤/克隆计数范围、光照近似、一般寻路及生成构造差异没有扩入本轮；新静态 oracle、平地交叉夹具和浏览器对照不构成自然全局发生率或全部 CE 逐骰同构的证明。
- 首次沙箱内 Vitest 在加载阶段因 macOS `SecItemCopyMatching failed -50` 退出 139；随后经执行权限复跑成功。首轮构建只发现新增测试对 private 方法的类型访问，已修测试装配。补查可见缓存/休眠激活后停止了一次中间全量运行，它不计最终“全量通过”；保留 `full-interim*` 日志，最终代码从头重跑完整 npm test。

## 6. 文件与复现

仓库根命令：

```sh
python3 brogue-web/scripts/x3a-ce-iterator.py
node brogue-web/scripts/x3a-inventory.mjs
node brogue-web/scripts/x3a-audit.mjs
python3 brogue-web/scripts/x3a-negative.py
node brogue-web/scripts/x3a-validate.mjs build-final
node brogue-web/scripts/x3a-validate.mjs full-final
node brogue-web/scripts/x3a-validate.mjs drift-final
node brogue-web/scripts/x3a-validate.mjs deep-final
node brogue-web/scripts/x3a-final-check.mjs
```

浏览器：在 `brogue-web` 执行 `npm run dev -- --host 127.0.0.1 --port 5199 --strictPort`，随后从仓库根执行 `node brogue-web/scripts/x3a-browser.mjs`。反向验证写入的是临时副本，不改工作区。所有最终结果均是本轮实际执行记录，未复制历史绿灯。

独立黄金复验在 `brogue-web` 执行：

```sh
npm test -- src/test/u_r2_trace.test.ts src/test/u_r3_trace.test.ts src/test/u_r4_trace.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=ai_docs/reports/x3a-evidence/traces-final.json
```

入场与最终 HEAD 均为 `dff9441cfb2587dd69a61f54704f81ab1a06336c`。新文件包括专项测试、7 个 x3a 验证脚本、本报告和证据目录；无新增产品字段、物品、翻译键或快照版本。下面的 `git diff --stat` 仅统计已跟踪文件，新文件另列在工作区状态中。

```text
 brogue-web/progress.md                         | 10 ++++++++++
 brogue-web/src/components/AgentControls.vue    |  3 ++-
 brogue-web/src/engine/Combat/MonsterAI.ts      |  5 +++--
 brogue-web/src/engine/Combat/MonsterBlink.ts   |  7 ++++---
 brogue-web/src/engine/Core/Game.ts             | 16 ++++++++--------
 brogue-web/src/engine/Core/MonsterLifecycle.ts | 12 ++++++++++++
 6 files changed, 39 insertions(+), 14 deletions(-)
```
