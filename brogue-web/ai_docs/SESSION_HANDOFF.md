# 会话交接（滚动更新，读这一份即可接手）

> **本文取代 `night_plan_2026-09-15.md`**（那份已定格为历史记录，勿参照）。
> 最后更新：**2026-09-18 01:00**。F/G/C 链全部完成；B 链做到 B-3。
> **B-4a（生成什么）跑中；B-4b（落在哪/多少）任务书已就绪待投。**
> **每次验收通过并提交后，必须回来更新「当前状态」与「队列」两节。**

---

## 🚦 门禁分组（2026-09-22 用户裁决：方案 A）

`generation_baseline` 已**移出默认门禁**。理由：它同时承担两种相反含义——
对交互期改动是「不该移动生成流」的强哨兵，对合法生成改动则**必然先红**、
待归因后重采；混在一起时红灯无法区分「意外回归 / 预期漂移待审核 / 已批准重采」
（实证：V-2a 的 60 处偏离、V-2b-1 的 98/104 层）。

| 命令 | 含不含漂移哨兵 | 谁用 |
|---|---|---|
| `npm test` | **不含**（`--exclude`） | 执行方、CI 的默认门禁 |
| `npm run test:drift` | 只有它 | 改生成的轮次必须单独跑 |
| `npx vitest run` | **含**（未加 exclude） | **验收方的全量门禁** |

⚠️ **这个不对称是有意的**：默认门禁给执行方/CI 用，信号干净；
而验收方用裸 `npx vitest run`，**仍然会跑到漂移哨兵**——这样即便任务书漏写
`test:drift`，验收这一关也兜得住。报告里提示的「移出后可能被漏跑」风险
由此闭环。

**任务书要求**：凡改动 `src/engine/Generator/`、`src/engine/Map/`、
`src/data/blueprints.json` 的轮次，必须显式要求跑 `npm run test:drift`。

---

## ⚠️ 仓库结构（2026-09-21 查清，避免踩坑）

**四个分支互不相干，`main` 才是我们的工作分支：**

| 分支 | 是什么 | 与 main 的关系 |
|---|---|---|
| `main` | **TS 移植工作区**（顶层只有 `BrogueCE-master/` + `brogue-web/` + `brogueweb/`） | — |
| `master` | fork 来的**上游 Brogue CE 的 C 项目历史**（Makefile / brogue/ / bin/） | **无共同祖先**，933 领先 / 268 落后 |
| `gh-pages` | **`brogueweb/`（emscripten 编译的 C 版）** 的部署，2026-03-06 | 与 TS 移植无关，**不要动** |
| `claude/github-online-compilation-dUodh` | 旧分支，gh-pages 的来源 | 历史遗留 |

🪤 **PR 目标陷阱**：`git status` 报的「Main branch (you will usually use this for PRs): master」
是 fork 的默认分支，**不是我们的**。若开 PR 必须显式 `--base main`，
否则会对着上游 C 项目的独立历史开，差异 268 个提交。

🪤 **目录名陷阱**：`brogue-web/`（TS/Vue 移植，我们的工作）与 `brogueweb/`
（emscripten 编译的 C 版，gh-pages 部署它）只差一个连字符，是**两条独立产品线**。

---

## ★ 夜间接班（新上下文从这里开始读）

### ⛔ 派发通道：只有一条，且只能由用户发起（2026-09-19 定稿）

**不要再花时间尝试自动派发。** 这不是故障，是既定条件：

> 用户的 BigModel 订阅已到期，没有可用密钥；剩下的免费额度**只能从 ZCode
> 客户端跑**。凡是走 CLI + API key 的路子，前提都不存在。

因此 **CLI 通道永久停用**（`ai_docs/tasks/zrun.sh` 顶部已加停用标记）。
下列路子都已实测走不通，**不要重试**：

| 尝试 | 结果 |
|---|---|
| `zrun.sh` / 内核直调 | `Model creation failed` —— 无有效密钥，无解 |
| `--surface desktop` | 只改呈现，不改凭据源，同样失败 |
| `source ~/.zcode-env` | CLI 不吃 `ANTHROPIC_*`，走自己的 provider 配置 |
| 桌面级 computer-use | **本会话根本不存在该工具**（连接器只有 Claude Docs /
  visualize / scheduled-tasks；能搜到的 `computer` 全是浏览器作用域）。
  不是掉线，没有可重连的对象 |
| AppleScript 驱动 GUI | `osascript 不允许辅助访问 (-1719)`。授予「辅助功能」
  属系统安全设置，验收方不改；且该权限范围是控制本机**任意**应用，不是只给
  ZCode。用户如要开，须自行权衡 |

**唯一有效的分工**：用户在 ZCode 桌面端手动发起轮次，验收方负责验收合并。
**验收侧完全不受影响** —— 读文件、跑门禁、合并、推送全走命令行，照常工作。

发起时粘这个模板（换轮次名即可）：

```
请先 cd 到 wt-<轮次>/brogue-web（git worktree，分支 round/<轮次>），
本轮全部工作限定在该目录内，不得改动仓库根目录或 main 分支上的任何文件。
先通读 ai_docs/project_conventions.md，然后严格按
ai_docs/tasks/<轮次>.prompt.md 执行，并按其最后一节的格式输出报告。
门禁用 `npx vitest run`（不带文件参数、不要加 --fileParallelism=false），
外加 `npm run build`。
```

**监控脚本的口径（2026-09-20 修）**：`abwait2.py` 原先写死 `tool=="ZCode"`，
换执行方后恒数出 0、一启动就误报「跑完了」。已改为「除 Claude Code（验收方
自己）之外的任何工具」——执行方换谁都不用再改。**当前执行方是 WorkBuddy，
agentboard 认得它。**

**客户端通道是串行的**：内核的凭据租约（`leaseUntil` / `lease-held` 控制文件）
一次只允许一个会话持有，第二个会话会以
`Account request credential is unavailable` 失败——而且是在**读了十几分钟源码
之后**才失败，所以「它跑起来了就没事」这个判断不成立。
**一次只投一轮**，上一轮验收完再投下一轮。

**保留的仍然有效的认知**（订阅若恢复可从这三条接着走）：
① mode 白名单（传错 mode 的 PARSE_FAIL 与配额耗尽同字符串）；
② 版本锚定闸门；③ provider 配置定位垫片 `~/.zcode-cli-shim/`
（内核写死的相对推导与 app 布局对不上，与密钥无关，这一层是真修好了）。

### 0. 夜间连续工作的当前配置（2026-09-19 01:30）

**派发通道**：ZCode **桌面端 GUI**（CLI 自 2026-09-18 的 provider 迁移后无法创建模型，
见「第四种 PARSE_FAIL」）。流程见下方「用 GUI 发起轮次的要点」。

**监控**：agentboard 的 HTTP 接口。

```bash
python3 ai_docs/tasks/abstat.py          # 看所有会话的状态/时长/最近动态
python3 ai_docs/tasks/abwait2.py 1       # 后台跑：等 ZCode 运行中会话降到 ≤1 就唤醒
python3 ai_docs/tasks/abwait2.py 0       # 等全部跑完
```

⚠️ **并行多轮时用 `abwait2.py`，不要用 `abwait.py`** ——
后者只看**第一个** ZCode 会话，两轮并行时会认错轮次。

**Qoder CN：不纳入派发通道。** 2026-09-19 实测它的输入框**发不出去**：
右下角绿色按钮是「实时语音」不是发送（底部只有话筒与语音两个控件、**没有发送按钮**），
`Return` 只换行、`⌘+Return` 会清空输入框但不启动任务。
后台注入的键盘事件驱动不了它。要用只能接管整个屏幕或由用户手动发送。
**结论：除非用户明确要求，不要再尝试驱动 Qoder。**

### ⛔ GUI 通道**一次只能跑一轮**（2026-09-19 实测）

试过 V-2a ∥ UI-2 并行，**UI-2 失败**，ZCode 报：

```
Account request credential is unavailable: account:bigmodel-individual-coding-plan/...
```

agentboard 侧显示 `status: error` / `unknown_error`，工作树零改动。

**机理**：内核有一套 `leaseUntil` / `lease-held` 的凭据租约控制文件
（见「第四种 PARSE_FAIL」一节查到的那段代码），**同一账户的凭据同一时刻
只能被一个会话持有**。先启动的 V-2a 握住租约，UI-2 读了一阵源码、
真要发请求时拿不到，于是报错。

注意它**不是立刻失败**——UI-2 先做了十几分钟的源码核对才崩，
所以「起来了就没事」这个直觉是错的，要等它真正开始写码才算稳。

**结论：GUI 通道上串行派发，一次一轮。** 失败的轮次原样重投即可
（任务书与工作树都还在，产物零改动、无残留）。

**这也意味着并行配对策略在本通道失效** —— 此前「最多 2 并发」的约定
是基于 CLI 时代（`zrun.sh` 各自独立进程）。CLI 修好之前，
**执行与验收都是串行的**，吞吐减半，排轮次时按此规划。

**这条经验的一般化**：「驱动第三方 GUI 发起任务」**不是通用能力**。
ZCode 能成是因为它的输入框接受后台输入；Qoder 不行。
遇到新工具先花两分钟验证「能不能发出去」，再决定要不要投入。

### 1. 现在在跑什么

| 轮次 | 工作树 | 分支 | 输出 |
|---|---|---|---|
| **V-2a** 前厅与守卫机器回归（独占生成流） | `brogue/wt-v-2a` | `round/v-2a` | GUI 派发，agentboard 监控 |
| **UI-2** `isProtected` 其余三个消费点（交互期） | `brogue/wt-ui-2` | `round/ui-2` | GUI 派发，agentboard 监控 |

⚠️ 工作树现在建在**项目目录内**（`brogue/wt-*`，已加进 `.gitignore`），
不再放 `/private/tmp` —— 这样 ZCode 的任务能直接 `cd` 进去。

查活口（**不要写 `until` 轮询循环**，历史上留下过 11 个僵尸等待进程）：

```bash
# ① 包装进程
pgrep -f zrun.sh >/dev/null && echo 跑中 || echo 已退出
# ② 真正可靠的两条：文件 mtime 在推进 + 有高 CPU 的 node
cd <工作树>/brogue-web && ls -lat $(git status --short | awk '{print $2}') | head -5
ps aux | grep node | grep -v grep | awk '$3>50 {print $2, $3"%"}'
```

### ★ GUI 驱动的轮次怎么监控（2026-09-18 起，CLI 坏掉后的备用路径）

ZCode 的 CLI 入口在 2026-09-18 的 provider 运行时迁移后无法创建模型
（见下方第四种 PARSE_FAIL），备用路径是**直接驱动 ZCode 桌面端**发起轮次。
此时没有后台任务的完成通知，改用 **agentboard 的 HTTP 接口**监控：

```bash
python3 ai_docs/tasks/abstat.py
```

它读 `https://localhost:8443/api/state`（自签证书，脚本内已关校验），
输出每个会话的 **状态 / 已跑时长 / 静默时长 / 标题 / 模型 / 最近动态**。
agentboard **自动发现** ZCode 会话（`source: discovered`，无需配 hook），
连它用的账户与模型都能看到，例如
`account:bigmodel-individual-coding-plan/GLM-5.3-Flash` ——
这一条还能**顺带确认计费走的是 coding plan 而不是按量**。

注意：自动发现的会话**不写进** `~/.agentboard/state.json`（那里只有 hook 上报的
Claude Code / Codex），只在服务端内存里，**必须走 HTTP 接口读**。

判完成看两处：`status` 变 `done`，以及工作树里报告文件出现、`git status` 稳定。

**★ 自动推进：用有界等待器恢复「跑完自动唤醒」**

GUI 驱动最大的退步是**没有完成通知**——验收方只在用户说话时才会去看一眼，
不再像 `zrun.sh` 那样跑完自动叫醒。补法是后台跑一个**有界**等待器：

```bash
# 用 Bash 工具的 run_in_background: true 启动，结束时会自动通知
python3 ai_docs/tasks/abwait.py
```

它每 30 秒查一次 agentboard，`status` 不再是 `running` 就打印结果并退出。

**为什么这次可以写等待循环**（此前的规矩是"不要写 `until` 轮询循环"）：
那条规矩针对的是**无界、条件写错**的循环——历史上留下过 11 个僵尸等待进程，
起因是等的字符串被 `| head -20` 截掉了、永远等不到。本等待器有三道闸：
① 120 分钟硬上限；② 接口连续 6 次不可达自行退出；③ 退出条件读的是结构化
JSON 字段而非文本匹配。**规矩的本意是"别留下永不退出的东西"，不是"禁止等待"。**

### ★ 用 GUI 发起轮次的要点

1. **项目不用换**：让任务自己 `cd <worktree>/brogue-web`，ZCode 任务有完整 shell 权限；
2. **任务书不用传**：它已在工作树磁盘上，提示词只需一句
   「按 `ai_docs/tasks/<轮次>.prompt.md` 执行」——
   验收方一开始试图把 4000 字粘进去，撞上"后台模式下剪贴板不可用"，
   绕了很久才想明白**应该让应用自己去磁盘上取，而不是把东西送进应用**；
3. 文件选择面板在后台模式下**不接受导航输入**（双击/回车/展开三角都无效），
   要突破得接管整个屏幕——所以别走"把工作树加成新项目"那条路。

⚠️ **三个会让你误判成"进程死了"的陷阱（2026-09-18 各踩过一次）：**

1. **`pgrep -f "zcode.cjs"` 查不到内核 ≠ 内核已死。** 内核的命令行是
   `node --experimental-import-meta-resolve --require .../… `，
   `zcode.cjs` 未必落在 pgrep 匹配到的那段里。**本晚两次误报。**
2. **输出文件是空的 ≠ 失败。** 投轮命令常套 `| tail -N`，管道**缓冲到结束**才输出；
   运行中期看永远是空。
3. **`$ZRUN_OUT` 是 0 字节 ≠ 失败。** 内核只在**最后**吐 JSON，
   重定向在开始时就把文件建好了，中途一直是 0 字节。

**判据只看两条**：工作树文件 mtime 是否在推进；有没有高 CPU 的 node 进程。
（执行方自测时跑的是 vitest，也会是一个 100% CPU 的 node——那同样是健康信号。）

后台任务完成时会**自动通知**，不需要主动等。

### 2. 验收固定七步（每轮都一样）

1. 读执行方报告的七个小节，**先看 `## 对任务书的反驳`** —— 它常常是对的；
2. **独立复核反驳里的要害事实**（打开 CE 源码自己看，别信报告）；
3. 核对 `git status --short` 的改动文件**是否全在授权清单内**；
4. 读 `## 需要追加授权的测试` —— 那是**验收方自己的漏项**，
   由验收方补修，**守卫要顺延不要放宽**（见「第四种形态」一节）；
5. 跑**全量门禁**（`npx vitest run` —— ⚠️ **2026-09-18 起不要再加
   `--fileParallelism=false`**：实测并行 411s vs 串行 1432s，**快 3.5 倍且同样零红**，
   而强制串行正是跨文件泄漏的病因，见 `project_conventions.md` 的「门禁跑法更正」）
   **外加 `npm run build`**——
   ⚠️ **不要用 `npx tsc --noEmit` 当类型门禁**，它解析的是根 `tsconfig.json`，
   而项目真正的严格度（`noUnusedLocals` / `noUnusedParameters`）写在
   `tsconfig.app.json` 里，**只有 `npm run build`（`vue-tsc -b`）才会应用**。
   2026-09-18 实证：B-3 合并时 `tsc --noEmit` 零输出，但 `npm run build`
   报 `scroll_effects.test.ts(20,60) TS6133`——一个未使用的导入被放进了 main，
   直到 B-4a 的执行方报告里提到"原树就存在"才暴露。**这是验收方的门禁漏洞，
   不是执行方的错**；
6. 工作树 `git add -A && git commit` 快照 → 主库 `git merge --squash round/<名>` → 提交 → `git push origin main`；
   ⚠️ **squash-merge 之后若还补修了文件，必须 `git add` 再 commit。**
   `git merge --squash` 只把合并内容放进**索引**，你随后手改的文件是**未暂存**的，
   `git commit`（不带 -a）**不会带上它们**。2026-09-18 因此把一个红测试推上了 main
   （门禁跑在工作树上是绿的，工作树有修复而 HEAD 没有——**门禁结果与被提交的状态不对应**）。
   **提交前先 `git status --short` 确认没有 ` M` 残留；门禁前确认工作树与索引一致。**
7. `git worktree remove <路径> --force`，更新本文的「队列」节。

### 3. 下一步队列（按顺序，**B-4a / B-4b 都是独占轮，不可并行**）

1. ~~B-4a~~ ✅ 已合 `92e4419`（82 文件 1032 绿 + build 绿）
2. ~~B-4b~~ ✅ 已合 `769649c`（83 文件 1047 绿 + build 绿）。**P1-50 收口**
3. ~~AI-1~~ ✅ 已合 `f822bbd`（84 文件 1052 绿 + build 绿）。
   **P1-52 结案：不是缺陷，是 CE 的休息甩尾机制**；顺带修掉门回弹与派生位残留
4. ~~T-1~~ ✅ 已合 `d66ed04` ∥ ~~R-1~~ ✅ 已合 `44e73b1`。
   合并态全量门禁 **86 文件 / 1103 绿 + build 绿**
5. ~~V-0 勘察~~ ✅ 已合 `683abc9`（推翻了验收方的两分法，改三轮）
6. ~~C-8~~ ✅ 已合 `bd3d123` —— 连通性否决补上移动图口径，坏层发生率 0.13% → 0
   （3000 层实测）。**零 RNG 消耗**，故 V-1a 基线未失效
7. ~~V-1a~~ ✅ 已合 `51bdd3c` —— 附魔卷轴 25.9→**14.9**、life 药水 18.7→**6.3**，
   双双进入 CE 量级。合并态全量门禁 **88 文件 / 1117 绿 + build 绿**
8. ~~UI-1~~ ✅ 已合 `1a8cfbe` —— 七条落地六条（火焰三态/探魔符号/两种气体/
   explosion_immunity 不显示/onConfirmRequest 接线/CE 三通道光照），
   第 2 条燃烧发光按 CE 结构登记 deferral（属引擎侧玩法光，非渲染层属性）。
   **合并态全量门禁 89 文件 / 1152 绿 + build 绿**
9. ~~V-1b~~ ✅ 已合 `705226d` —— **范围经补勘察后缩小**：只实现
   `MF_ALTERNATIVE`(+`_2`)（V-2 的硬前置，否则基座大奖会双份发放）。
   顺带产出蓝图旗标审计表（见路线图）
10. ~~V-1c~~ ✅ 已合 `6997b86`（92 文件 / 1179 绿 + build 绿）。
    机器数 **1518(3.89/层) → 87(0.22/层)，-94%**，落回 CE「约每 4 层 1 间」；
    C-8 连通性广度断言绿（30 seed × D1-D25 坏层 = 0）。
    ⚠️ **中间态**：vestibule / key_guard / thematic 三类机器暂不出现
    （锁门 1022→35）——CE 里它们由奖励房经 `MF_BUILD_VESTIBULE` /
    `MF_OUTSOURCE_ITEM_TO_MACHINE` **递归**建立，递归机制本轮已建成并被测试钉住，
    **内容回归归 V-2 数据轮**。这是还原 CE 结构的必经阶段，不是功能丢失。
11. ~~V-2a~~ ✅ 已合 `9bb6a76`（**93 文件 / 1182 绿 / 0 失败** + build 绿，墙钟 23 分钟）。
    前厅与守卫机器经递归在生产数据里建起来，V-1c 的中间态收口。
    前厅按 CE 锚点语义豁免 center≠door（窄口径）；验收方补做超时线校准
    （全局 300s→900s、blueprint_center 180s→900s、armor_model_effect
    1500s→2400s）——V-2a 后每局生成期抽取 30 万→70-80 万，同码两跑差 40%。
12. **V-2b-0 勘察轮（下一轮，任务书已就绪 `ai_docs/tasks/v-2b-0.prompt.md`）**：
    原计划的「V-2b 一轮扩表」**投不下去**——验收方粗测：CE 蓝图引用的地形/怪物
    web 大面积无载体，71 条里只有约 6 条能用现有载体落地，缺口符号 88 个
    （`ALTAR_SWITCH` 解锁 14 条、`STATUE_INERT` 13 条、`ALTAR_INERT` 10 条、
    `CARPET` 9 条…）。**该粗测有系统性误差**（web 的通用 `ALTAR`/`SACRED_GLYPH`/
    `PRESSURE_PLATE` 使部分"缺口"实为命名差异），分清真缺口与别名正是勘察轮的活。
    勘察轮不实现、不跑门禁，产出载体映射表 + 逐蓝图可落地判定 + 拆轮建议。
13. ~~V-2b-1~~ ✅ 已合 `a677846`（**93 文件 / 1183 绿 / 0 失败** + build 绿）。
    六件事全落地；蓝图 20→22（CE 16/17/27 逐字）；基线偏离 98/104 层，
    执行方用 2×2 受控单变量实验归因（personalSpace 边际 71-75 层、
    NEAR_ORIGIN 单独 0 层、三条新蓝图 98 层，逐层占比如实声明不可分）。
    **门禁墙钟 23 分钟 → 9 分钟**（落位收紧减少重试，意外收获）。
    ⚠️ **验收查出一处「报告称已做、实际没做」**：第 6 件（三个自创旗标清除）
    因执行方申报的 `git checkout -- blueprints.json` 恢复后重做脚本漏了该步而
    丢失，报告却记为完成（还列了 16 个行号）。验收方独立枚举旗标读取点确认
    三者零消费后补完。**教训：报告里带具体行号的「已完成」也要抽验落地。**
14. ~~V-2b-2a~~ ✅ 已合 `2a41438`（**1210 绿 / 0 失败** + build 绿，墙钟 9 分钟）。
    CE `cellIsFeatureCandidate` 七步判定整函数移植 + 其余放置/物品资格旗标。
    零数据改动。基线偏离仅 4/104 层，单变量归因全部来自 `MF_PERMIT_BLOCKING`
    （机理：否决落在**无** PERMIT 的 5 条阻断地形 feature 上，带 PERMIT 的
    7 个载体反而旁路）。9 种零载体旗标以 27 合成用例 + 故障注入反向验证。
    **采纳一条授权反驳**：阻断否决改两查并列（CE :1451 实为单查
    `levelIsDisconnectedWithBlockingMap`，验收方任务书点错成 web 变体）。
    有意加严、只多否决不多放行，与 C-8 在 `DungeonFeature.ts:740-742` 的
    同类守卫先例一致。
    ⚠️ **第 8 起漏授权**（扫描器钉模块符号引用形态）：`c_4b_dungeon_feature.test.ts`
    的 F1 白名单未列入清单，执行方如实报红并申报边界冲突、未越界自行修改；
    验收方补扩白名单（该用例头注本就预告「C-4d 接线机器时再扩清单」，
    属留痕前提转假→扩清单而非删断言）。
    📌 **执行方登记、待后续轮接的两项**：① Q 族过滤的真实消费点在
    `Game.spawnBlueprintItem`（Game.ts:863 起），本轮只完成指令侧下传，
    过滤循环本体需 Game.ts 改动、未授权未做；② `MF_IMPREGNABLE` 以引擎级
    格键集合承载（web Cell 无该位），`Game.ts:4918` 一带那句「该位恒 0」的
    注释自本轮起已过时，接线归隧道轮。
15. ~~V-2b-2b~~ ✅ 已合（**1235 绿 / 0 失败** + build 绿，墙钟 9 分钟）。
    六个 BP_* 旗标 + 6 新地形（FUNGUS_FOREST 以 FOLIAGE 别名）+ CE 逐字落
    3/4/5/19/20/23，reward_pedestals 按 CE 拆回两条。**蓝图 22→27**（CE 71）。
    基线偏离 76/104 层。19 号取方案 2（只留焚化药水），偏差钉进测试防回流。
    ⚠️ **清单外改动 7 处**（验收方四段 grep 只预判到 c_4a/invented 两处，
    穷举表分布远不止那里）——全部申报，两类：结构性穷举表（c_7/r_1/c_4b
    不加成员连 build 都过不了）、留痕/合同反转（p1_42/p1_33/c_4b F3/g_2/
    v_2b_2a P1）。**下次写清单必须把 Record<TerrainType> 类穷举表全 grep 出来。**
    📌 **待后续轮接**：① `Game.discoverSecretAt` 仍是 SECRET_DOOR 特判，
    TRAP_DOOR_HIDDEN 搜索显形不工作（踩上坠落正常）→ 陷阱/搜索轮；
    ② feature 的 CE `itemFlags` 列 web FeatureDef 无载体，4/5 号基座大奖
    出厂不预鉴定 → 物品轮；③ 飞镖点燃三件事（DF_DART_EXPLOSION / 投掷落点
    点燃 / spawnBlueprintItem 的 WEAPON+id 支持）→ 投掷轮，接线后回补 19 号
    的两条 ALTERNATIVE 载体。
    ⚠️ **验收方登记的防御项**：`MF_REPEAT_UNTIL_NO_PROGRESS` 的 do-while
    （`BlueprintEngine.ts:1193`）**无迭代上界**。已核 CE 全部 10 条 REPEAT
    feature 的 reqSpace 均为 1、无病态数据载体（CE 结构同构），但后面 44 条
    蓝图陆续落地时一个 reqSpace 打错就会静默挂死。**下一轮任务书要求加
    failsafe 计数 + 显式报错**（纯防御，可达路径零行为变化）。
16. ~~原 V-2b-2b 条目~~：BP_* 内部改造 +
    7 个地形载体 + CE 逐字落 6 条蓝图（3/4/5/19/20/23）+ 基座蓝图拆分。
    必答风险：19 号 barricade 的点火物二选一，web 飞镖投掷不点火 → 一半不可解。
16. ~~V-2b-3~~ ✅ 已合（**1264 绿 / 0 失败** + build 绿）。wired 触发网络
    （activateMachine / circuitBreakers / promoteTile 的 wired 分支 / IS_POWERED）
    + 9 地形 + CE 逐字落 18/22/24/25/67/68，**蓝图 27→33**（CE 71）。
    REPEAT do-while 已加 failsafe（上界 1000 + 显式抛错）。
    ⚙️ **过程**：ZCode 分两段跑（中途 unknown_error）后订阅到期，由第三个工具
    接手补完；验收方补修一处笔误（`missingDf` 在 DeferredPromotion 上）并做了
    WIP 提交保护产物。
    🔍 **C 类两条真诊断，结论均为「实现无缺陷、断言前提过期」**（验收方已回 CE 复核）：
    · `TM_IS_WIRED` 豁免——CE 顺序 `:1238 剪线 → :1327 feature 落位 → :1690 摘标记`，
      旧夹具把载体预置在剪线之前，测的根本不是 `:1694`。改断言但保留两半事实。
    · 存档往返——断言拿「网格派生集」比「∪mr.cells」，而 CE 自己就让两者不等
      （`:1486` 标记 interior 外 feature、`BP_NO_INTERIOR_FLAG` 又清非 wired）；
      实测 31 个有机器的层里 **25 层不等、双向都差**。属**「挑 seed 的测试」**，
      本轮 RNG 流移动只是把走运的骰子挪开。**这类假信心值得再全库排查一轮。**
    💡 **执行方的一个好习惯值得沿用**：断言是串行的，第一条红会遮蔽后面的——
    它没有只改报错那一行，而是重新普查整张旗标载体表，抓到失败清单里根本
    没显示的 `MF_FAR_FROM_ORIGIN` 从零载体出列。
17. ~~V-2b-4~~ ✅ 已合（**1301 绿 / 0 失败** + build 绿）。自创祭坛组子系统
    按用户裁决拆除（取物塌陷 / MF_ALTAR_GROUP / Cell.altarGroupId /
    Architect.altars 死数组），由新测试 D1/D2 扫描器钉住零残留。
    CE 逐字落 1/2/6/7/15/26/28，**蓝图 33→39**（CE 71）。
    🔍 **执行方驳回了验收方的倾向并且对了**：15 号护符双轨，结论是**直投不退位**。
    CE 的护符房不是抽签建成而是 `Architect.c:1747-1754` 的强制
    `buildAMachine(MT_AMULET_AREA)`，且 15 号 `frequency=0` 永不被抽中；
    web 无此强制调用 ⇒ 实测 66 seed 建成 **0 台**，且 `spawnBlueprintItem`
    **无 AMULET 分支**（即便建成也发不出）。退位 = 0 护符 = 致命。
    📌 **两个缺口待补（"机器接管"要成立的前提）**：① web `buildAMachine` 没有
    CE 的 `bp` 形参（永远走 chooseBP），且 15 号无 `BP_ROOM`、走 CE 的**区域机器
    选址分支**（`Architect.c:1145-1219`），web 只有 `findGateRoom` 一条路——独立一轮；
    ② `spawnBlueprintItem` 的 `AMULET` 类别分支。
    🐛 **顺带修了一个真缺陷**：首层上行梯硬编码在地图正中且不查机器格
    （`Game.ts` D1 分支），本轮新数据（1 号 `BP_OPEN_INTERIOR` 长成 645 格）
    把它暴露。新增 `vestibuleStairPos`：正中非机器格保持旧行为、落进机器才
    环序外扩。CE 依据 `placeStairs` 的禁止掩码含 `IS_IN_MACHINE`。
    ⚠️ **守卫力量下降一处（已登记不粉饰）**：`p1_37` AD3 的 `A−B` pin 因池变化
    顺延为 `[]`，该层逐格循环空转。查清是**断言前提从来就过强**（把"机器布点"
    窄化成"item/monster 布点"，而 CE `:1484-1486` 对**一切** feature 生效，
    地形类 feature 合法地没有布点指令）。要非空转需 `MachineResult` 暴露
    feature 落点 → 归 V-2b-7。
18. ~~UI-2~~ ✅ 已合（**1312 绿 / 0 失败** + build 绿）。`isProtected` 的其余三个
    CE 消费点（武器降级豁免 / 物品栏闭括号 `}` / 详情行「不会被酸液腐蚀。」）。
    ⚠️ **这轮差点被误删**：它是 2026-09-19 的交付，因注意力被 V-2a 线带走而
    一直没验收；验收方凭过期记忆（"零改动、凭据租约冲突失败"）准备删掉
    `wt-ui-2`，**删前核了一下才发现里面有完整产物**。
    **教训：删任何工作树前必须先 `git status` + `git log main..<branch>` 实看，
    不能凭记忆。**
    采纳两条授权反驳（均为验收方任务书写错）：CE 降级下界是 `enchant1 >= -10`
    **含等号**（−10 仍降到 −11）、`MONST_DEFEND_DEGRADE_WEAPON` 是 9 处不是 15 处。
19. ~~V-2b-5~~ ✅ 已合（合并态 main 门禁 **1330 绿 / 0 失败** + build 绿）。
    休眠唤醒子系统（CE :1655 落位置休眠 / toggleMonsterDormancy 双向含占格
    重选址 / :3487 唤醒的 `atOrigin || builtCells` 或条件）+ MF_GENERATE_HORDE
    + 7 地形，**蓝图 39→47**。顺带更正 V-2b-4 把 STATUE_INSTACRACK 的
    discoverType/promoteType 抄反的数据缺陷。
    🔍 **反向验证做得硬**：注入砍掉 blockingMap 半句 → C1 红而 C2 保持绿，
    证明两条断言各守半句、互相独立。
    ⚠️ **一处度量重定义（接受但需留意）**：`p1_26` 可走格占比的分子分母同步
    剔除机器格。理由成立（CE `BP_PURGE_INTERIOR` 把 interior 全部格含墙改铺
    FLOOR，大机器抬高占比是 CE 字面行为；机器地形由 p1_33/p1_37 另行把守），
    **阈值 0.55 未动**（验收方查 diff 确认无数值放宽）。但**机器覆盖面若在
    后续轮次继续扩大，这条守卫的度量人群会持续缩小**，届时要重估。
    📌 **如实登记的两处成色不足**：八条里 **69/70 不可达**（CE 走
    autoGeneratorCatalog 的 MT_* 列，web 该列是 C-6 起的缺口），freq 0 退池
    留形且有测试钉住；端到端「雕像 burst 出怪」被 **RUBBLE 缺 tile** 堵住——
    唤醒子系统本身已接线并经对抗性测试行使，但要等 RUBBLE 落地那一轮才通。
20. ~~V-2b-6~~ ✅ 已合 `70ba985`（**1349 绿 / 0 失败** + build 绿）。钥匙系统真实化
    （`keyMatchesLocation` 含 originDepth 判据 + 两键匹配、`disposableHere` 第三维、
    `keyInPackFor`/`keyOnTileAt`、`MF_SKELETON_KEY`）+ 怪物 `carriedItem`。
    **「任意钥匙开任意锁」的解锁分支已删除。**
    蓝图账：新增 1 条（35 号）、既有 2 条按 CE 重写（10/40 号）、8 与 16 号语义收口，
    **47→48**。
    🐛 **修掉一个此前就存在的真死局**：`key_rat_trap` 是 web 自创形态（旗标只有
    `BP_ROOM`，既无 `BP_ADOPT_ITEM` 也无 `MF_ADOPT_ITEM` feature），被抽中当领养
    机器时静默丢弃父机器钥匙 → 锁无钥匙（seed424242/D3 实测 2 锁 0-1 钥匙）。
    这正是 §6「可解性证明」这条强制项设出来要抓的东西。
    🔍 **执行方再次驳回验收方预设并且对了**：`ALTAR_INERT` **不**独立成 TerrainType
    ——CE 没有「独立的普通祭坛 tile」，`Globals.c:362` 的 `ALTAR_INERT` 就是通用祭坛
    本体，web `ALTAR` 的注释自 V-2b-4 起已指向它；独立反而造出两个逐字段相同的枚举。
    📌 **待后续轮**：`disposableHere=false` 数据面结构性空集（CE 现有 KEY feature
    全带 `MF_KEY_DISPOSABLE`），引擎侧已收口；怪物携带形态无数据载体
    （CE 11 号 Vampire lair 未入池），激活轮需复跑 F 组可解性证明。
21. ~~V-2b-7~~ ✅ 已合（**1372 绿 / 0 失败** + build 绿，墙钟 16 分钟）。
    DF 目录扩充（含闭包链展开）+ 19 条新地形 + 十三条蓝图，**48→61**（CE 71）。
    🐛 **第二个真死局**（§6 可解性证明连续两轮抓到东西）：47 号的领养 feature
    `SACRIFICE_CAGE_DORMANT` 带 `T_OBSTRUCTS_PASSABILITY`；CE 靠献祭机制升笼取钥匙，
    web 无该机制 + `populateLevel` 的 P1-43 闸会丢弃 pathing-blocker 上的物品
    ⇒ 父机器钥匙凭空消失（复现 seed3/D7、seed777/D23）。按同类数据不变量退池留形。
    ✅ **空转四轮的断言真正复活**：A−B 非空（六格）且全部命中 featureSpawns，
    **并新增非空性哨兵**——将来 A−B 再变空会红，不会重演静默空转。
    反向验证 RV-A：注释掉记录点 → 哨兵与 D1 双红，而 `generation_baseline` **保持绿**
    （证明记录是纯观测、不移流）。
    📌 登记：33 号因 web `Monster` 无 `MODE_PERM_FLEEING` 维度而退化为
    「带物品、先逃跑后可能回头」（`Monster.ts` 不在该轮清单）。
22. ~~V-2b-8~~ ✅ 已合 `016eced` + 补完轮。~~V-2b-9a~~ ✅ 已合 `90c0a5a`
    （**103 文件 / 1376 绿 / 0 失败** + build 绿，墙钟 757s）。
    **9a 的拆分前提得证**：12 个新地形 + 8 条 DF 未被任何蓝图引用，
    `generation_baseline` 全程未重捕获且始终绿 —— 纯载体轮确实不移动生成流。
    这条经验可复用：**只加目录、不接线的轮次不必重捕获基线**。
    ⚠️ 两条验收方错误经执行方反驳后复核成立：
      ① RUBBLE 早在 **V-2b-7（`90bf32b`）** 就落地，不是 V-2b-5 未平的堵点
         ⇒ 9a 实际新增 **12** 个地形而非 13（103+12=115）；
      ② DF#159 是 `DF_SHALLOW_WATER` 不是 `DF_PARALYSIS_GAS_CLOUD_POTION`
         （CE 枚举自 `DF_GRANITE_COLUMN = 1` 起数）。`g_2` 旧注误标为气体。
    📌 **V-2b-9 余下部分再拆三轮**（依勘察报告自留的切开点）：
      **9b** = E 族（涨水/塌方/岩浆退缩/显桥）+ BP_TREAT_AS_BLOCKING 激活，
      蓝图 31/34/36/37/38/39/44/65/66（9 条）；
      **9c** = L 闪电 promote + 暗 黑暗生产者 + 泥潭，蓝图 32/51/52/54；
      **9d** = R dungeonProfile + BP_MAXIMIZE/REDESIGN_INTERIOR，蓝图 13/14。
      E 族不再拆——四种效果共用 `promoteTile` 的 bulk 分支。
      **9b 同时是 `fillVestibuleInterior` 那笔留痕账的激活轮**：65/66 带
      `BP_TREAT_AS_BLOCKING`，正是占位注释预告的"载体"。
    做完蓝图 **71 / 71**。
23. **审计欠账（已有清单，见 `ai_docs/reports/audit-seedluck.report.md`）**：
    9 条「挑 seed 的测试」风险项。其中 `p1_37` 的那条**已由 V-2b-7 修掉**；
    余下 8 条（高 3 / 中 4 / 低 1）待安排一轮修复。
24. **原 V-2b-7 条目**（按勘察报告 §2.3）：休眠唤醒 + horde 接线轮等，解锁 7/4/13/8/15 条。
19. ~~原 V-2b-4 条目~~：
    ✅ **用户已拍板（2026-09-20）：让 CE 祭坛接管**——拆除 web 自创的「取物塌陷」
    语义（`Game.ts:3232-3245`：从祭坛取物 → 同组祭坛塌成 CHARRED_FLOOR 并销毁其上
    物品；CE 无此机制）。这与既定裁决一「全量对齐、不留宽松度」同向：自创玩法属
    偏离，不是设计。拆除会移动内容落位，当轮重捕获基线；`altarGroupId` 若在拆除后
    无消费者则一并清理，有则写明留它的理由。
18. ~~原 V-2b-3 条目~~：
    **起点比勘察报告说的高**——`promoteTile` 已由 C-4c 完整实现，只差
    `TM_IS_WIRED` 一个分支且留了 `wiredBranchHit` 占位（本轮性质是留痕反转）。
17. ~~原 V-2b-1 条目~~：
    九轮里唯一不解锁新机制的一轮——把落位语义与历史垃圾清干净，让后八轮的
    CE 数据能按 CE 口径落。六件事：personalSpace 边长 2r+1→2r-1、
    MF_NEAR_ORIGIN 基准 center→origin、死代码清除（trapVaults/cages 两数组 +
    Game.ts:1228/:1260 两死循环，**删前必须先补「无人往 center 投物」断言**）、
    三个自创旗标删除（实测 16 处非勘察报告说的 9 处，且引擎零消费）、
    minimumInstanceCount 全表显式化、CE 逐字落 16/17/27。移动生成流，
    基线最后一步重捕获。
14. **V-2b-2 及其后**（按勘察报告 §2.3 的九轮拆法）：解锁 6/7/7/7/4/13/8/15 条。

### 验收方在写 v-2b-1 时实测发现（勘察报告未载）

- **CE 堵门型前厅 roomSize 是 `{1,1}`，web 凭空放大 6–20 倍**：CE 十条前厅
  五条 `{1,1}`（内部就是门格本身一格），web 四条全是自创大区间
  （locked [6,20] / flammable [8,18] / guardian [10,25] / pit_traps [8,20]，
  对应 CE 的 {1,1} / {1,1} / {25,25} / {30,60}）。
  **这印证了 V-2a 的前厅 center==door 豁免是对的**——`{1,1}` 前厅只有一格，
  center 必然等于 door，是 CE 半数前厅的常态而非边缘情形。
- **风险 1 在 V-2b-1 就会撞上**：27 号 Secret room 用 web `ALTAR` 作
  `ALTAR_INERT` 替身，而 web ALTAR 带自创塌陷语义（`Game.ts:3232-3245`）。
  已列为该轮必答题。实测 CE
    `blueprintCatalog_Brogue` **71 条**、web **20 条**（reward 5 / key_guard 7 /
    vestibule 4 / thematic 4），差 51 条，分 REWARD ROOMS / AMULET HOLDER /
    VESTIBULES / KEY HOLDERS / FLAVOR MACHINES 五节。三个 web 自创旗标
    （`MF_SCATTER`/`MF_RING`/`MF_FILL_DOORWAY`）整体替换。
    **投前必读**：V-2a 报告 §9 的六条遗留（尤其 CE 16 条 BP_ADOPT_ITEM
    蓝图全带 `MF_ADOPT_ITEM` 消费 feature，web 7 条 key_guard 全无）。
13. **V-2a 登记、待 V-2b 连读的两处偏差**：
    a) `findFeaturePosition` 的 MF_NEAR_ORIGIN 以 `center` 为基准，CE 以
    `originX/originY`（Architect.c:1337-1348）——对**全部 BP_ROOM 机器**都是
    偏差，前厅恰好重合所以一直没暴露；
    b) `Architect.trapVaults` **只声明、从未 push**，`Game.ts:1228` 的宝藏循环
    是死代码。**前厅 center 豁免掉"可通行"检查的安全性正建立在这条死代码上**
    ——谁接上 trapVaults，前厅 center（LOCKED_DOOR 格）就成宝藏坟墓。
14. **原 V-2 条目**（数据全量还原）：`blueprints.json` 按 CE 全表重写，
    给 reward 蓝图接上 `MF_OUTSOURCE_ITEM_TO_MACHINE` / `MF_BUILD_VESTIBULE`
    feature，前厅与守卫机器随之回归；三个 web 自创旗标
    （`MF_SCATTER`/`MF_RING`/`MF_FILL_DOORWAY`）整体替换（见「蓝图旗标审计表」）。
    **V-2 是少数可以拆成两半并行的大轮。**
12. 其后：钥匙轮（`MF_KEY_DISPOSABLE` + keyLoc 扩 kind 维）、M-1 戒指目录、
    P1-25 战斗机制勘察轮、`_random_good_` 之外的 P1 尾账
— 原 V-1c 条目（已完成）：抽签资格过滤 + 奖励房配额
    + 递归外包/领养 + 失败回滚。
    **这四件相互耦合，不能再拆**——资格过滤没有递归就会让 vestibule/key_guard
    蓝图一个都建不起来；配额没有资格过滤就会把所有机器一起砍。
    CE 依据：`blueprintQualifies`（`Architect.c:455-468`）、
    配额公式 `(rewardRoomsGenerated + count) * 4 + 2 < depth`（`:1757-1775`，
    常量 `GlobalsBrogue.c:1026-1029`，跨层计数器在 `RogueMain.c:292` 清零）、
    递归与回滚（`:1543-1575`，10 次重试 + 子机器产物回传父机器）。
    **投前先走第三方 CE 事实预检。**
10. **V-2** `blueprints.json` 按 CE 全表重写（含把解题工具补回那 10 台机器）
11. 小轮可凑：戒指目录缺 `light`/`reaping`（web 6 / CE 8）、i18n 扫描器模板字符串盲区、
    P1-25 击退落点判据、`BlueprintEngine.ts:454` 注释残留 `_random_good_`
7. **UI-1**（七条渲染欠账）—— R-1 已落地，落点已备；事实清单见路线图「UI-1 事实清单」（经 MiMo 三方核对）
8. 小轮：`DF_CRYSTAL_WALL` 入目录 + `AutoGenerator.ts` 两条缺口接线（**移动生成流，独占**）
5. 渲染纯重构轮（把 cell→appearance 抽成纯函数）→ 之后才谈 UI 轮
6. 中小 P1 合并轮（P1-39 / P1-41 / C-4a-1 / i18n 模板字符串盲区）

### 4. 投一轮的完整命令（照抄改名即可）

```bash
cd "/Users/coolking70/Documents/同步空间/brogue/brogue-web"
R=b-4b   # ← 改这里
WT=/private/tmp/claude-501/-Users-coolking70-Documents------brogue/8ee12a9f-9b98-4460-8396-dd8dbcd34c7b/wt-$R
git worktree add -b round/$R "$WT" HEAD
ln -s "$PWD/node_modules" "$WT/brogue-web/node_modules"     # 不软链则 vitest 不可用
ZRUN_OUT=/tmp/zrun-$R.json bash ai_docs/tasks/zrun.sh   "$WT/brogue-web/ai_docs/tasks/$R.prompt.md" "$WT/brogue-web" yolo
```

四条铁律：
- **先提交任务书，再建工作树**（否则工作树里没有任务书）；
- **每轮独立 `ZRUN_OUT`**（共用 `/tmp/zrun-last.json` 会互相覆盖 → `Extra data` 报错）；
- **mode 只能是 `build`/`edit`/`plan`/`yolo`**（已加白名单闸门，退出码 92）；
- 用 `run_in_background` 启动才有完成通知。

### ★ 4.5 用户已预先裁决的四条（2026-09-18 01:30，**不要再问**）

新上下文接手时，下列情形**已有决定**，直接执行、不必停下来请示：

| 情形 | 裁决 | 依据 |
|---|---|---|
| **对齐 CE 后手感变苛刻**（life 药水 10-15→约 6、附魔卷轴受计量表限流、dart 不再随机生成、金币按 CE 产量表） | **全量对齐，不留宽松度** | 这是复刻项目，偏离 CE 的"宽松"本质是 bug 不是设计；一旦开始局部放宽，后续每轮都要重新判断该不该放宽，判据会失控 |
| **B-4a/B-4b 撞断既有哨兵** | **按数量分流**：**≤ 5 个**当轮改成「消耗增量 / 隔离场景 / 性质断言」三种形态之一直接修掉；**> 5 个**照 S-1 先例撤下改动、单开还债轮。走了哪条要在验收报告里写明 | C-6 撞断 13 个时硬补数值不可行，S-1 那轮证明了先还债再落地是更快的路 |
| **轮次被 5 小时上限打断**（典型症状：产物完好，死在"写最终报告"那一步） | **写补完任务书继续推进**，用免费窗口外的额度。补完任务书必须明写「产物完好、验收方已代验、不要推倒重来」 | B-2 / C-7 用此法救回 2315 行；用户明确说过"即使来不及也会有额外的额度可以用" |
| **免费期 9/20 结束前队列跑不完** | **按现有顺序推进，不因截止日调整优先级** | 用户原话：「担心随便调整顺序可能会影响任务连续一致性、反而会降低总体开发效率，还是把一个一个问题都妥善解决了再去尝试下一个」 |

**仍然要停下来问用户的**（不在上表内的都算）：
- 队列**顺序**的改动（插队、跳过、合并轮次）——上表第四条已排除"因截止日调整"，
  但若是**技术原因**必须改序（例如 B-4b 依赖一个尚未做的前置），仍要先说；
- 删除任何 web 自创内容（默认一律**退池**不删除，见 `invented_content_pool.test.ts`）；
- 新建仓库 / 改动推送目标（当前：继续推 `origin/main`，整体完工后再议）。

### 5. 时间窗

- GLM **23:00–09:00 免费不限量**；免费夜间时段**到 9 月 20 日结束**。
- 另有一条**5 小时滚动上限**，与免费窗口无关，撞上会 `PARSE_FAIL`。
- 撞限额时**活可能已经干完了** —— 先读工作树产物判断完整度，再决定重跑。
  历史上 B-2 / C-7 都是被杀在「写最终报告」那一步，产物完好，
  用「补完任务书」（明写"产物完好、不要推倒重来"）救回了 2315 行。

### 6. 三种 `PARSE_FAIL` 的分辨（**第一件事永远是直连内核看 stderr**）

| 报错 | 原因 |
|---|---|
| `Expecting value: line 1 column 1` | 内核没吐 JSON：**配额耗尽 或 mode 非法** |
| `Extra data: line N column 1` | 两轮并行写了同一个 `ZRUN_OUT` |

**第四种成因（2026-09-18 首次遇到）：内核找不到 provider 配置 / 模型创建失败。**
直连内核时 stderr 会明说，例如：

```
无法定位 CLI ZCode Built-in Provider Config：
  /Applications/ZCode.app/Contents/Resources/glm/provider/zcode-builtin.json
Error: Model creation failed (traceId: …)
```

要点：
- 配置**实际在** `Resources/config/provider/zcode-builtin.json`
  （注意是 `config/` 不是 `glm/`）。内核独立调用时按相对路径找错了目录，
  可用 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=<绝对路径>` 显式指定绕开。
- 但若绕开后变成 **`Model creation failed`**，那是**凭据/会话层的问题**，
  不是路径问题 —— 典型诱因是用户在 ZCode 界面里动过登录或订阅设置
  （实测 `~/.zcode/v2/` 的 `credentials.json` / `provider_config.json` /
  `setting.json` 会同时被改动）。
- **处置：请用户在 ZCode 里重新登录。验收方不碰 `credentials.json`** ——
  凭据操作始终是用户的范围。

探针（注意用内核认的 mode，否则探针自己也踩坑）：

```bash
node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs   --prompt "reply OK" --cwd /tmp --mode plan --json 2>&1 | head -c 400
```

---

## 角色与工具

- **执行方**：本机 zcode 调用 GLM-5.3-Flash。**23:00–09:00 免费不限量**。
- **验收方**：Claude。写任务书、独立探针验收、裁决、提交、合并。
- 调用：`bash ai_docs/tasks/zrun.sh <任务书> <cwd> yolo`
  （自动前置注入 `ai_docs/project_conventions.md`；内核版本锚定 `0.16.5`）。
- **必须用 Bash 工具的 `run_in_background` 启动**，才有完成通知。
- **配额**：耗尽表现为 HTTP 429 → `zrun.sh` 报 `PARSE_FAIL`、退出码 1。
  诊断方法：绕过 `zrun.sh` 的 stderr 过滤直连内核跑一句 `--prompt "回复：OK"`。
  工作日 14:00–18:00 是高峰时段，积分全额扣。

---

## 当前状态（2026-09-17 凌晨）

- 测试：**79 文件 / 949 passed 零红**，build 绿（S-1 + C-6 后串行读数）。
  （G-1 后由验收方跑过二级串行全量，与执行方读数一致——两级门禁体系首次完整验证。）
  （串行读数 `npx vitest run --fileParallelism=false`——并行跑重型测试会集体假红。）
- **Phase D 全部完成**（P4-1 ~ P4-10）。
- **Phase C**：C-0 环路、C-1 房间剖面、C-2 湖泊、C-3 墙面与门、
  **C-4 链全部完成**（4a-0 四层模型 / 4a 属性表 / 4b DF 目录 / 4c promoteTile 与两趟驱动）。
  P1-42（密门发现）、P1-46（键位回到纯 vi）、F-0（测绘）、F-1（火焰迁层）已完成。
  **F 链火侧已走完**：F-0 测绘 ✅ → F-1 迁层 ✅ → F-2a 蔓延/寿命/产物 ✅
  → F-2b 生物燃烧状态机 + P1-44 ✅。
  **F/G 链八轮全部完成**：F-0 测绘 → F-1 火焰迁层 → F-2a 蔓延/寿命/产物
  → F-2b 生物燃烧状态机 → G-1 气体迁层与体积模型 → G-2 DF 接线与蒸汽源
  → G-3 效果与比例伤害 → F-2c 爆炸。**用户裁决的路线 A（全量对齐 CE）达成。**
  `GAS` 层从 C-4a-0 搬进来后空了四轮，G-1 填上；
  `POISON ≡ CONFUSION` 当了四轮哨兵，G-1 按 CE 让它正确破缺。

### 必须记住的四条（按被坑次数排序）

1. **`WATER_DEEP` 不是 `DEEP_WATER`。** 写错不报错——vitest 走 esbuild
   只剥类型不检查，运行时得 `undefined`；只有 `npm run build` 的 vue-tsc 报 TS2339。
   **任何让人困惑的测试失败，先跑 build。**
2. **连通性判据有三口径且互相矛盾**（P1-38）：`Grid.setTerrain` 的
   `isPassable`、`Game.canMoveTo`、`Pathfinding` 成本图，对 LOCKED_DOOR /
   WATER_DEEP / CHASM 的裁决各不相同。我已因此三次量错。C-4a 统一。
3. **连通性**分析**口径要放行密门**——用 `harness.analysisAllowsMove`，
   别再各写一份。依据 `Architect.c:202-203`（CE 自己就把密门当通路）。
   ⚠️ 它的前提是玩家找得到密门，而 web 的发现机制远弱于 CE（P1-42）——
   **不要用"连通性闸门全绿"论证"关卡可玩"。**
4. **桥只架深渊**（`T_CAN_BE_BRIDGED = T_AUTO_DESCENT`）。CHASM 暂不生成
   （等 C-5），所以真实关卡里桥恒 0，`buildABridge` 已忠实实现并被 6 个
   构造场景钉死。别去改它。


### ★ 一个已被验证两次的出题模式：结构先行 + 完美门禁

C-4a-0 与 C-4a 都用了同一个套路，它奏效：

1. 先只搬**结构**，刻意让**行为逐位不变**；
2. 于是可以拿 **`generation_baseline` 不重采而绿** 当门禁——
   这是个极强的自动判据，不需要人去逐条判断"这处变化是对是错"；
3. 把"行为该怎么改"的证据**作为干跑测量交付出来**（C-4a-0 交了 74 行
   跨层清除表，112,033 次事件），下一轮拿着数据逐条裁决。

**反例**：C-4 原本想一轮做完"promoteTile + DF 目录"，投不出去——
它预设了两个 web 没有的底座，执行方只能自己现造（无法验收）或硬接（更难拆）。





### ★ 留痕授权：我已连续漏了 3 次，F-2a 起改用清单法

同类冲突累计 **8 起**，其中 **3 起是验收方写任务书时漏了提前授权**
（C-4b 的 mechFlags、P1-42 的三份 C-4 留痕、F-1 的 `c_4a_0` 两张 `toEqual` 全量表）。

**写任务书前过一遍这张清单**，凡本轮会碰的一律提前列入允许范围：

| 留痕所在 | 什么时候会到期 |
|---|---|
| `c_4a_0_layer_model.test.ts` | **新增任何地形**——两张 `toEqual` 是穷尽式全量表 |
| `c_4a_terrain_catalog.test.ts` | 改任何 TerrainCatalog 取值；promote/fire 字段新增读者 |
| `c_4b_dungeon_feature.test.ts` | DF 目录改 tile；DF 子系统符号新增生产引用 |
| `c_4c_promotion.test.ts` | 晋升驱动新增消费者；状态指纹口径变化 |
| `f_1_fire_as_terrain.test.ts` | 火的红线项（EMBERS、固定 2 伤害、promoteChance 0） |
| `p1_24` / `p1_28` | 直接写 `cell.isBurning` 的地方 |

**★ 清单要 grep 出来，而且必须搜两段 ★**（2026-09-17 第 5 次漏授权后修正）：

第一次立这条时我只搜了"本轮的**主题**"，G-3 于是又漏了一个——
`c_4a_terrain_catalog.test.ts` 钉的是 `TERRAIN_FLAGS` 全量表，
G-3 新增 `ROT_GAS` 等地形必然打红它，但那文件**一个气体关键词都没有**。

**正确的搜法是两段并集**：

```bash
# ① 结构性穷尽表——凡新增地形/DF/枚举成员的轮次都会打红它们，与主题无关
grep -rln "TERRAIN_FLAGS\|DRAW_PRIORITY\|TERRAIN_HOME_LAYER\|\
DUNGEON_FEATURE_CATALOG\|DF_MISSING_TILES\|toEqual({" src/test/*.ts

# ② 本轮主题关键词——例如气体轮
grep -rln "GasType\|gasGrid\|addGas\|volume\|DungeonLayer.GAS" src/test/*.ts
```

**①式的当前结果（2026-09-17）**：`c_4a_0_layer_model` / `c_4a_terrain_catalog` /
`c_4b_dungeon_feature` / `c_4c_promotion` / `f_1_fire_as_terrain` /
`f_2a_fire_mechanics` / `g_2_gas_df_wiring` / `p1_42_secret_door_search` /
`p2_6_display_settings`。
**凡本轮要新增任何地形、DF 或枚举成员，这九个默认全部进允许清单。**
**再加一步：读上一轮报告的"给下一轮的登记清单"。**
F-2b 明写了"气体曲线哨兵有两份等价实现（f_2a 对抗⑪ / f_2b 对抗⑦），
G-1 改气体时两处一起翻"；F-2a 明写了"届时 p4_4 进允许清单"——
**后者我没照做，于是 F-2b 又撞了一次（第 9 起冲突、我第 4 次漏授权）。**

**授权时必须加限定**："只改因本轮行为变化而到期的断言，不许放宽守卫性质
（穷尽式 `toEqual` 仍要穷尽、阈值不许松）"，并要求逐条在报告里说明。






### ★ 哨兵欠债与还债（S-1 的教训，2026-09-17）

C-5 打翻 2 个哨兵、**C-6 打翻 13 个**——因为它们**锚定的是 RNG 流位置**。
我没有手工改那 13 个数字，而是投 **S-1** 专门还债，**结果 C-6 零冲突落地**。

**S-1 找到的隔离通道**（后续立哨兵直接复用）：
`createHeadlessGame(seed, 'test')` 的层生成走 `generateTestDepth` **合成层，
结构性绕开真实生成器**；再加"全图覆写密封场景 + 清怪清物 + **搭好后重播种**"。
`c_5` 対抗⑧ 当年自称"场景自建、流复位"却失效，**缺的正是第一件**
（场上还有怪，怪物 AI 与火共享全局流）。

**三种可选形态**（按优先级）：
1. **消耗量口径**：断言 `rng.randomNumbersGenerated` **增量**，而非结果值——
   对流位移完全免疫（B-1b 首用，C-6 实测扛住）；
2. **完全隔离场景**：合成层 + 清场 + 重播种；
3. **性质断言**：断不变量而非逐位数值（最弱，前两种不适用时才用）。

**顺带揪出一条一直在掷硬币的哨兵**：`c_5` 対抗③ 的阈值 `<0.5`
**正好压在正确实现的真值上**——`randClumpedRange(8,10,2)` 方差恰为 0.5
（注释里写的 1/3 是错的）。**看着是门禁，其实是噪音源。**

**而且改造后的哨兵更敏感**：试金石里 `b_1a` L1 立刻抓到验收方 P1-43 的过窄判据
（硬编码 `terrain === LAVA`，漏了 `INERT_BRIMSTONE`；CE 的判据是
`T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER`，而 C-4a 早就做成了 `isPathingBlocker`）。

### ★★ 本地执行方取代云端（2026-09-22，本日最大变更）

**配方**（`codex` 二进制在 `/Applications/ChatGPT.app/Contents/Resources/codex`）：

```bash
nohup $C exec --worktree --approve-for-me \
  -c model_reasoning_effort="xhigh" \
  -o /tmp/codex_<round>_last.txt "<prompt>" > /tmp/codex_<round>.log 2>&1 &
```

- `--worktree`：自己的 git worktree（`~/.codex/worktrees/<hash>/brogue`），
  不撞验收方检出，**两条可并行**
- `-o <file>`：最终回复落文件——**解掉云端读不到文字回复的老问题**
- `--approve-for-me` 与 `-s/--sandbox` **互斥**，同时给会报错
- 模型 `gpt-6-astra`（自称"基于 GPT-6 的 Codex"），`xhigh` 被 CLI 头部确认接受

**效果对比（同一模型、同样的任务书纪律）**：

| 轮次 | 通道 | 验收方门禁 |
|---|---|---|
| V-2b-9b | 云端 | 90 → 15 → 12 条失败，**三次派发** |
| 审计欠账 | 本地 | 19/19 **首提通过** |
| V-2b-9c | 本地 | 105 文件 1392 通过 **首提全绿** |
| V-2b-9d | 本地 | 106 文件 1403 通过 **首提全绿** |

**差别不在模型，在能不能自验。** 云端 `nproc 3`，全量门禁 135 min CPU ≈ 45 分钟墙钟，
它跑不完 ⇒ 盲写。本地 10 核，它自己跑 33 个授权文件只要 7 分钟。
⇒ **只要额度允许，一律走本地。**

### ⛔ `nohup … &` 起的进程 harness **不跟踪**，必须另挂等待器

用 `nohup ... &` 在前台 Bash 调用里起的 codex 进程，跑完**不会通知**。
必须另起一个 `run_in_background: true` 的等待器：

```bash
while kill -0 <PID> 2>/dev/null; do sleep 30; done
echo "=== 已退出 ==="; tail -6 /tmp/codex_<round>.log
cat /tmp/codex_<round>_last.txt
```

不挂就会等一个永远不来的通知（本会话早先为此空等过 30 分钟）。

### ★★ 建守卫之前，不要做守卫本该保护的那类改动（2026-09-22）

验收方一度建议并获批"退掉 12 条 web 自创蓝图"。动手前多查一步，发现
**那 12 条里至少有一条是合法 CE 蓝图**：

> CE **15** 与 CE **43** 的 `name` 字符串**完全相同**。按 name 匹配，两条都被
> 认领给 `reward_statuary`，于是 `key_statuary` 被误判为自创。逐字段一查：
> `reward_statuary` = CE 15（freq 0 / {35,40} / `BP_PURGE_INTERIOR|BP_OPEN_INTERIOR`），
> `key_statuary` = CE 43（freq 10 / {35,90} / `BP_ADOPT_ITEM|BP_NO_INTERIOR_FLAG`）。

若按原计划执行，一条 freq=10 的 CE 蓝图会被退出生成池，**而且没有任何门禁
能发现**——因为覆盖守卫正是那一轮才要建的。**守卫缺位处的静默回归比测试红更难查。**

⇒ 顺序改为：**A 轮建映射 + 覆盖守卫（零生成流移动）→ B 轮才退池**。

### ⚠️ 蓝图覆盖率：粗匹配不可信，以逐 feature 为准

验收方两种粗算法给出**互相矛盾**的结果：按 `name` 逐字匹配 **67/71**，
按 `depthRange`+`roomSize`+`flags` 全等匹配 **54/71**，差 13 条。
`name` 会被同名蓝图坑（见上），字段匹配会被历轮的登记留形偏差坑。
**权威口径以 `bp-mapping` 轮的逐 feature 核实结果为准。**

### ⛔ 授权测试清单要**反查生成**，不要凭记忆手写（9e-1/9e-2 连栽两次）

验收方每轮手写 §7 授权清单，依据是"本轮改什么"——**这行不通**。
测试钉的是**被改动代码的可观测后果**，不是代码本身。连续两轮栽在漏项上：

| 轮 | 漏掉 | 后果 |
|---|---|---|
| 9e-1 | `c_4b` / `g_2` / `c_5_fall_subsystem` | 执行方跑完 27 文件全绿，验收方门禁 3 条失败 |
| 9e-2 | `v_2b_8_autogen` | 改了 `AutoGenerator.ts` 却没列钉它的测试 |

**正确做法：从改动的生产文件反查引用它的测试。** 例如改 `AutoGenerator.ts`：

```bash
grep -l "AUTO_GENERATOR_CATALOG\|AutoGenerator" brogue-web/src/test/*.test.ts
```

再并上「移动生成流必带」的固定三件套（见下条）。
**两次漏项都是验收方的错，不要记在执行方账上**——它们跑的都是清单里的全部。

### ⛔ 移动生成流的轮次，必须带上「对生成结果取样」的观测测试（9e-1 教训）

9e-1 的授权清单里验收方删掉了 `c_4b_dungeon_feature` / `g_2_gas_df_wiring`
（理由是"本轮不碰地形/DF"），也没列 `c_5_fall_subsystem`。
结果执行方跑完 27 个文件全绿，验收方全量门禁**跑出 3 条失败，全在这三个文件上**。

**生成流一动，这些就会变**，与本轮是否修改地形数据无关：
- `c_4b` F3 钉"生产生成的多层格形态"——机器多了就出现新叠层
- `c_5_fall_subsystem` 钉换层生成的**精确 RNG 消耗常量**——机器 469→823 直接顶飞
- `g_2` 用真实生成的关卡做舞台——RNG 状态一变，随机舍入的结果就变

⇒ **凡移动生成流，`c_4b` / `g_2` / `c_5_fall_subsystem` 一律进授权清单。**

### ★★ 验收方从读代码推因果，连错两次（9e-1 补完轮，2026-09-22）

验收方给补完轮写了两条"已定位的成因"，**都是错的**，而且其中一条照做会得到
错误的修复。执行方两条都驳回了，用的是实测而不是推理。

**① `g_2` 的"舞台外泥格也在产气"——错。**
验收方推理：`openRoom` 只清 x∈[1,20)/y∈[1,16) 一角、`promoteChance` 被全局抬到
10000、`totalVolume` 扫全图 ⇒ 沼泽机器变多后别处的泥也产气。
实测：**全图 MUD 只有 `(8,8)` 一格**。真因是 CE `Time.c:1423-1426` 与 web `Gas.ts`
逐格做整数除法 + **独立随机舍入**——2 体积进九格邻域，每格按余数独立决定是否 +1，
**期望值守恒不保证单次总量 ≤2，也可能增加**。旧注释只考虑了舍入到 0 的方向。
执行方原话：**「这些代码事实不足以证明本次失败的来源。」**
而且验收方提的处置（把测量缩回房间）**无效**——缩回去仍会测到 3。

**② `c_4b` 的"草长在浅水上"——因果说反了。**
`DF_GRASS`（`Globals.c:609`）带 `DFF_BLOCKED_BY_OTHER_LAYERS`；GRASS drawPriority=60、
SHALLOW_WATER=55，`Architect.c:3232` 要求旧优先级 >= 新 ⇒ 55>=60 不成立 ⇒
**先有浅水时不能再铺草**。合法顺序是**先草后水**，肇事蓝图是 `ce_60_idyll` 而非
验收方猜的 `ce_61_swamp`。

⇒ **规律：代码事实为真 ≠ 它是本次失败的成因。** 诊断要么实测，要么在任务书里
标明"这是推测，请实测复核"。本轮两条都标了"可能有错、授权驳回"，所以没造成损失
——**这个标注不是客套，要一直写**。

### ★ 「建成 0 台」≠「RNG 足迹为 0」（B1 实证，2026-09-22）

验收方在 B1 任务书里写过一条推论：**「建成台数为 0 的条目，退池是纯数据卫生、
不影响生成」——这是错的。** 零建成必须分两种：

| 类型 | 是否空操作 |
|---|---|
| 在**抽签前**就被既有过滤排除（B1 的 6 条 `key_guard` 被领养过滤挡住） | ✅ 是 |
| **仍在抽签池里**，只是本样本没赢（B1 的 `vestibule_flammable`） | ❌ **不是** |

单变量实验：只退 `vestibule_flammable` 一条（它在 416 层样本里建成 0 台），
结果 **162 层 / 619 字段** 变化。原因是 `chooseBP`、选址与失败重试**都在消费 RNG**，
而"成功交付数"完全不覆盖这些消费。

⇒ 判断一条蓝图退池是否影响生成，要看**它是否参与抽签**，不是看它建成过几台。

### ★ 退池的两种性质要在代码里分开（B1 立）

`blueprintQualifies` 现有两类退池，注释必须写明区别：

- **等机制**（18 号 lever 等 wired 晋升、CE 52 等撞墙拉杆、55 号等隧道 DF tile）
  —— 机制落地那一轮**摘除**过滤并复跑 F 组
- **web 自创**（B1 的 11 条）—— **永久**退池，除非自创判定被推翻

混在一起写，将来没人分得清哪条该摘。

### ⚠️ 验收方自己的门禁命令别用 `grep -c` 收尾

`grep -c` 无匹配时返回退出码 1，会让后台任务报 `failed`，而门禁其实是绿的
（B1 就这样虚惊一次）。要统计出现次数用 `grep -c … || true`。

### ⚠️ 门禁计时波动很大，别据单次测量下结论（2026-09-22 更正）

```
V-2b-9c 后：墙钟  649s · 测试 CPU  4?  (未记)
V-2b-9d 后：墙钟 1379s · 测试 CPU 12213s
bp-mapping 后：墙钟 530s · 测试 CPU 4687s   ← 用例更多，反而快 2.6 倍
```

用例数 1403 + 18 = 1421 全部执行、无缺漏，所以**不是少跑了**。
9d 那次的输出里有 `[vitest-pool]: Timeout terminating forks worker for …
c_8_connectivity.test.ts`，很可能是挂死的 worker 把墙钟顶上去了。

⇒ **先前"门禁成本翻倍、趋势上行"的判断不成立，已撤销。**
单次计时不可作为治理依据；要判趋势至少连测三次并记录是否出现 pool timeout。
**35 分钟触发线保留，但按"连续三次超过"计。**

📌 `c_8_connectivity` 的 worker 未正常终止已出现过一次。此类曾造成伪失败
（本会话早先并发跑两份门禁时出过 3 条假 STACK_TRACE_ERROR）。再现就单独查。

### ⚠️ 蓝图覆盖率只认逐 feature 核验（2026-09-22 定案）

粗算法全部不可信，实测对比：

| 方法 | 结果 | 失效原因 |
|---|---:|---|
| 严格 name 相等 | 58/71 | 11 个合法身份改过名；CE 15/43 同名会让一条 web 数据被计两次 |
| depth+size+flags 全等 | 53/71 | 忽略 frequency/features；无法区分 1/2、6/7、9/10、16/20、67/68 五对 |
| 再加 frequency 四元组 | 52/71 | 仍不是 feature 身份核验 |
| **逐 feature 认定** | **69/71** | **权威口径，已写成永久守卫** |

★ **验收方脚本曾有硬错误：`DEEPEST_LEVEL = 40`，不是 26**
（`GlobalsBrogue.c:44`；`AMULET_LEVEL` 才是 26）。CE 67-70 用 `{1, DEEPEST_LEVEL}`，
web 投影为 26 属登记留形。脚本一律替换成 26 会污染比较并误漏 67-70。

现在 `blueprint_ce_coverage.test.ts` 钉死覆盖集合、CE 号唯一性、null 项必须带
`ceOrigin`、索引落在 1-71。**进度数字从此可机械核验，不再靠估计。**

### ⛔ 云端任务的产出**必须落成文件**，CLI 读不到它的文字回复（2026-09-22）

`codex cloud` 只有 `exec / status / list / apply / diff` 五个子命令，
**`diff` 只给代码变更**。第一次派诊断任务时让它"把输出贴进最终回复"——
任务 `[READY]`、`no diff`、**内容一个字都拿不到**，白跑一轮。

⇒ 派任何云端任务（含诊断、探针）都要求它 **写文件**。

### ★ 执行方说"被环境终止"时，先去核（V-2b-9b 的最大教训，2026-09-22）

Codex 连续两轮申报「平台约 30 秒窗口，被环境终止」，于是它在**零验证**的
情况下盲写了两轮代码，验收方这边两次跑出 90 / 15 条失败。

派探针实测（`ai_docs/reports/cloud-env-probe.md`）：

```
node v20.20.2 · npm 11.4.2 · nproc 3 · 18 GB RAM · node_modules 完整(133)
npx vitest run smoke.test.ts → 34.7s 退出码 0
npm run build                → 31.7s 退出码 0
```

探针结论原话：**「所有命令均正常退出，没有超时或被环境终止。」**
不是额度、不是 setup script、不是代理——最可能是它自己 agent 层的单命令
超时被误读。任务书加一句「命令返回后先确认有没有 Vitest 汇总行再判断成败，
没有汇总就重试一次」即可。

**应在它第一次这么说时就去核，而不是接受描述连发两轮。**

📌 顺带探到的硬数字：**云端只有 3 核**。全量门禁 135 分钟 CPU ≈ **45 分钟**
墙钟（本地 10 核 13 分钟）。所以：
- 云端永远不要跑不带参数的 `npx vitest run`，分批是必须的；
- **把验收搬上云不会更快**，只会从 13 分钟变 45 分钟。

📌 `codex cloud exec` 有 **`--attempts`（best-of-N，默认 1）**，尚未用过。
对"一轮几十分钟、失败要重来"的轮次可能比补完轮划算。

### ★ 退池留形 = 加引擎过滤，**不是改数据**（V-2b-9b，2026-09-22）

`vestibule_secret_lever`（= CE 18 号）要退池时，执行方把 `blueprints.json` 的
`frequency` 从 8 改成 0，直接撞上 `v_2b_3_wired` E4 钉死的 CE 逐字值
（`GlobalsBrogue.c:305`），然后又补了个守卫断言「frequency 必须为 0」
——**两条守卫正面冲突**。

既定口径写在 47 号先例里（`BlueprintEngine.ts` 的 `canReceiveAdoptedItem` 说明）：

> 按 D2 口径退池留形：**数据照带旗标**，只是它不再被抽为领养机器

所以：**数据永远保持 CE 逐字，退池在 `blueprintQualifies` 里做**。
纠正后 F0 改成双钉——`frequency === 8`（逐字）**且** `blueprintQualifies(…) === false`
（已退池），并在注释里写明「两处若冲突说明有人用错了退池口径」。

判别法：**改数据能让守卫变绿，往往说明你在改被守卫的那个事实本身。**

### ★ 覆盖门没有观测对象时，换样本而不是改期望（V-2b-9b 复发第二次）

`c_6_autogenerators` AD-8 在单 seed 单层（20260917/D5）上测
`autogenMachine.entries.length > 0`。9b 的生成流一动，D5 不再命中，
执行方把它改成 `toEqual([])` / `toBe(0)`，理由写「真实目录 MT_* 仍全部
登记为 no-machine」。

**该理由经实测证伪**：`AutoGenerator` 的 13 个 `machine: MT.*` 条目里 7 个带
真实载体（SWAMP/BLOODFLOWER/SHRINE/IDYLL/REMNANT/DISMAL…），正是 V-2b-8 的成果。
验收方探针 3 seed × D1-26 实测建成 **28 台**——D5 只是恰好没命中。

处置同 V-2b-8 D 类：**换更大的样本，恢复原断言强度**（扫 D7/D10/D11/D18/D19，
仍用 `toBeGreaterThan(0)`）。

⚠️ 顺带一条：**不要钉精确台数**。同一探针独立运行数出 9 台、放进
`c_6` 文件内跑是 7 台——该值随同文件前序用例的模块态而动。覆盖门要守的是
「建得出来」，钉死只会造脆断言。

### ⚠️ 蓝图覆盖率目前**无法机械核验**（V-2b-9b 发现，待还）

`blueprints.json` 共 **74 条**，但只有 **17 条**带 `ceBlueprintId`
（V-2b-8 起新增的那些）。其余 57 条用 slug id（`key_nested_library`、
`vestibule_secret_lever`、`key_rat_trap`…），**看不出对应 CE 第几号**。

后果：路线图里「做完蓝图 71/71」这类说法**没有任何脚本能验证**，
按 `ceBlueprintId` 扫出来的"还缺 54 条"是假的（多数只是没标 id）。

建议还账方式：给存量 57 条补 `ceBlueprintId`（web 自创的标 `null` 并注明），
再加一条守卫钉死「CE 1-71 的覆盖集合」。在此之前，任何 x/71 的进度数字
都只能当估计看。

### ★ 边界守卫别钉在枚举终止符上（V-2b-9a 补完轮，2026-09-22）

"未授权 id 不许进目录"这类**边界守卫**，钉的那个 id 必须是**真实存在、
但刻意未抄录**的成员。V-2b-9a 补完轮里执行方把 throw 臂从 218 挪到 219，
而 219 是 `NUMBER_DUNGEON_FEATURES`（枚举终止符，不是 DF）——
钉一个永远不可能成为目录成员的值，守卫就退化为**恒真**，
正是审计报告「挑 seed 的测试」分类里的**哑**（silent）失效：
测试一直绿，但它要抓的东西已经抓不到了。

改钉 217 = `DF_STENCH_BURN`（真实 DF、刻意未抄录、`g_2` 禁入名单仍列着）。
**反向验证是判别哑与不哑的唯一手段**：把 217 注入目录 → E5 翻红，还原后复绿。
凡是"把断言挪到另一个值上"的修法，都要做这一步。

一个配套的坏味道：这类测试的**标题里常带计数**（"恰 57 条"），
而计数会随轮次漂移。V-2b-9a 时 `c_4b` 的 E1/E5 标题还写着 57，实际已 131。
标题不参与断言，所以不会红——**它是无声腐坏的文档**，改计数时顺手同步。

### ★ 并行的固有成本：地图锚定的哨兵在合并时要重锚（已两次）

第一对并行（C-5 + B-1a）暴露了这个：C-5 改了地图，于是
- 合并 C-5 时，**g_2/g_3 的 FIRE-NAT 哨兵**翻红（取景点移位）；
- 合并 B-1a 时，**它自己的 A13 物品签名哨兵**翻红（签名锚在改深渊之前的地图）。

**两次都不是回归**。判据分离得很干净：
**`generation_baseline` 才是"有没有移动 RNG 流"的权威判据**——
它绿而哨兵红，就说明哨兵是地图锚定的、被另一轮的地图改动带翻。

**规矩**：
1. 合并后哨兵翻红，**先看 `generation_baseline`**，再决定是回归还是重锚；
2. **新立 RNG 哨兵请建在构造地图/固定物品集上**，只对"本轮有没有多消耗掷骰"
   敏感，对地图变化免疫（B-1b 的任务书已按此要求）；
3. 重锚时在注释里写明它是地图锚定的、以及有几份等价实现。

### ★ 跨链并行已开（2026-09-17，F/G 链收口后）

第一对是 **C-5（坠落）+ B-0（Phase B 勘察）**，选它们是因为**零冲突是构造出来的**
——B-0 是纯勘察轮，除一份新文档外不许碰 `src/` 任何文件，
所以与任何代码轮次天然不相交。

**并行时的两条纪律**（`vite.config.ts` 注释与本文档多处已记）：
1. **全量读数不可信**：两边抢 CPU 时重型测试会集体假红（全是
   `Test timed out`、零断言失败）。看到重型测试翻红**先单跑复核**。
2. **提交前的最终门禁要在没有另一轮占 CPU 时跑**，或用
   `--fileParallelism=false` 串行。

### ★ 验收成本：两级门禁（2026-09-16 实测立规）

**实测**：基线 + 三个坏层闸门 = **78 秒**；`--fileParallelism=false` 全量 = **1108 秒**。
差 14 倍。而单轮约 100 分钟里，串行全量一项就占我验收时间的 62%。

**一级（每轮必跑，2–3 分钟）**：
```bash
npx vitest run <本轮新增的测试> <本轮改过的既有测试> \
  src/test/generation_baseline.test.ts \
  src/test/p1_26_invariants.test.ts \
  src/test/p1_29_lake_connectivity.test.ts \
  src/test/p1_33_machine_chokepoint.test.ts
npm run build
```
⚠️ **必须包含本轮改过的既有测试**，以及执行方报告里预告会受影响的那些，
否则回归会从缝里漏过去。

**二级（每 3 轮一次 / 扫荡型轮次之后 / 阶段收口前，18–19 分钟）**：
```bash
npx vitest run --fileParallelism=false
```

**风险与兜底**：一级漏掉的回归最多潜伏 3 轮。因为每轮都有独立的 `round/*` 分支
与单独提交，二级翻红时定位是 O(3) 的翻查，不是大海捞针。
**每轮仍然照常 push**（耐久性优先），二级不通过就立刻回头修。

### ★ 合并方式：`git merge --squash`，不要拷文件（2026-09-16 立）

以前我是从工作树 `cp` 文件到 main，两个毛病：
- 无法处理两轮改同一文件的不同区段；
- **`git checkout <branch> -- <path>` 会把该路径下所有文件都拉过来**，
  包括轮次没碰的——我因此误回退过一次 `SESSION_HANDOFF.md`。

**新流程**：
```bash
# 1. 执行方禁止 git 写操作，所以由验收方先快照到 round 分支
cd <worktree> && git add -A brogue-web && git commit -m "wip(<轮次>): 执行期快照（未验收）"

# 2. 回 main 做真正的三方合并（squash：一轮一个干净提交，但合并语义完整）
cd <main> && git merge --squash round/<轮次>

# 3. 验收方的修正直接改在工作区，然后一次提交（写完整验收信息）
git commit -F -   # 病灶 / CE 行号 / 探针证据 / 执行方纠正了我哪些错
git push -q origin main
```

**好处**：两轮改同一文件的不同区段时 git 自动三方合并；冲突会显式报出来而不是
被拷贝静默覆盖；`wip` 快照本身也是防 `/private/tmp` 丢失的保险（见下一节）。

### ★ 并行规则修订：看 hunk 分布，不看文件清单（2026-09-16 实测）

旧规则"只并行允许清单真正不相交的轮次"太保守。实测 `Game.ts` 的改动分布：

| 轮次 | hunk 数 | 位置 |
|---|---|---|
| P1-42 | 7 | 455 / 2497 / 4074 / 5291 / 5529 / 6388 / 6415 |
| C-4c | 6 | 29 / 335 / 2742 / 2782 / 5427 / 6351 |
| **F-1** | **32** | 横跨 2 → 6822 |

P1-42 与 C-4c **零重叠**，配 `git merge` 可以干净并行；F-1 那种**扫荡型**和谁都冲突。

**新规则**：
- **扫荡型轮次（广泛触及一个子系统）独占**，不与任何轮次并行；
- **手术型轮次（约 10 个 hunk 以内）可以同文件并行**，靠 `git merge` 收口；
- **依赖链内一律串行**（F-2b → F-2c → G-1 → G-2：下一轮要等上一轮合并）；
- **并行度上限仍是 2**——验收是串行的，我是瓶颈，N>2 零收益；
- **绝不并行两个都移动 RNG 流的轮次**（这条不变）。

**跨链并行的时机**：F/G 链走完、进入 C 链（C-5/C-6/C-7）与 Phase B 那批
天然独立的工作时再开。用户 2026-09-16 明确表态：宁可一次一件事妥善做完，
也不要为提速制造半成品。

### ★ 配额耗尽的确切诊断法（2026-09-16 实测）

`zrun.sh` 报 `PARSE_FAIL` 时**不要猜**，直连内核探一句：

```bash
node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs \
  --prompt "回复：OK" --mode yolo --json 2>&1 | head -c 400
```

实测返回：`ProviderBusinessError: [1308][已达到 5 小时的使用上限。
您的限额将在 <时间> 重置。]`——**除了 23:00–09:00 的免费窗口，还有一条
5 小时滚动上限**，交接文档此前只记了前者。

`PARSE_FAIL` 的机理：内核只吐错误、不吐 JSON，`/tmp/zrun-last.json` 为空，
zrun.sh 的 python 解析段抛异常（`zrun.sh:38`）。所以 `PARSE_FAIL` = 内核没出 JSON，
配额只是其中一种原因，别直接等同。

**第三种原因：`--mode` 传了内核不认的值（2026-09-17 踩到）。**
`zrun.sh` 的第三个参数直传内核，而内核**只认 `build` / `edit` / `plan` / `yolo`**。
验收方投 B-3 时按 Claude Code 的习惯写了 `acceptEdits`，内核回
`Unsupported --mode value: acceptEdits.` 后直接退出、不吐 JSON，
于是 PARSE_FAIL 的报错字符串与配额耗尽**一模一样**（`Expecting value: line 1 column 1`）。

所以三种 `PARSE_FAIL` 要这样分：

| 报错 | 原因 | 分辨法 |
|---|---|---|
| `Expecting value: line 1 column 1 (char 0)` | 内核没吐 JSON：**配额耗尽 或 参数非法** | 直连内核探一句，看 stderr 到底说的是 `[1308] 已达到上限` 还是 `Unsupported --mode value` |
| `Extra data: line N column 1` | 两轮并行写同一个输出文件 | 给每轮指定独立 `ZRUN_OUT` |

**教训**：`PARSE_FAIL` 之后**第一件事永远是直连内核看 stderr**，
不要凭报错字符串直接认定是配额——它至少有两种成因共用同一个字符串。
探针要用**内核认的 mode**，否则探针自己也会撞同一个坑。

**撞限额时活可能已经干完了**：F-2a 就是在吐最终回复那一步挂的，
报告无占位符、门禁章节已填。**先读报告判断完整度，再决定重跑**。

### ★ 执行方进程被杀时，产物不会丢——但要主动快照

2026-09-17 会话结束时 P1-42 的 zcode 进程被杀，停在"回填全量测试输出"那一步。
**文件都还在**（进程死不删工作树），且验收方在会话结束前把工作树快照成了
`wip(P1-42)` 提交，所以零丢失。

**规矩**：
1. 工作树在 `/private/tmp/...`，那是临时目录（**重启会清**）。
   网络切换不影响它，重启会。
2. 长轮次跑到一半时，若预见会话可能中断，**先 `git add -A && git commit` 一次
   wip 快照到 round 分支**——工作树共享主仓 `.git`，快照后内容进对象库，
   不再依赖 `/tmp` 存活。提交信息里写明"未验收、不得合并"。
3. 被杀的轮次先**读它的报告判断完整度**，别急着重跑：
   P1-42 那次八节全写完、验收对照表逐条填好，只差最终门禁——
   而最终门禁本来就是验收方自己跑的。

### ★ 全量门禁改用串行

`npx vitest run --fileParallelism=false`。并行时重型测试会集体假红
（全是 `Test timed out`、零断言失败），F-0 那轮误判成"714 零红不可复现"，
实际是另一轮在并行占 CPU。串行慢但读数干净。

### ★ 一个反复出现的判断：这一轮做了会不会是空壳？

C-4c 之后我差点直接投 C-4d（接线机器），查了才发现 **web 只有 `PRESSURE_PLATE`
一个带 `TM_IS_WIRED` 的地形**——CE 那套要靠闸门/笼子/拉杆/炮塔，web 全没有。
做了就是又一个空壳，和硫矿点不着一个毛病。

**出题前先查"这一轮的机制在 web 今天有没有载体"。**
C-4c 的实测已经给了现成的盘点法：`promoteChance` 活的只有 3 条、
负值（扩散型）载体 0 条、`fireType` 轴整体休眠。
同样的盘点应该在投任何"移植某机制"的轮次之前做一遍。

### ★ C-4c 起，「逐位不变」那个门禁失效了

C-4a-0 / C-4a / C-4b 能拿"`generation_baseline` 不重采而绿"当门禁，是因为
它们只搬结构。**promote 是回合期的事，而 baseline 只测量生成期**——
所以 C-4c 之后 baseline 大概率仍绿，**但那不再是"没改坏"的证据**。
从 C-4c 起，判据换成"实测影响报告 + 既有玩法测试"，
且**既有玩法测试翻红时不许调断言改绿**，必须逐条判"回归"还是"CE 行为首次生效"。

### ★ C-4b 查明的两条硬前提（C-4c 及之后必须守）

1. CE `promoteTile` **先清层再 spawn，且 `abortIfBlocking = false`**——
   这是 DOOR（drawPriority 8）能晋升 OPEN_DOOR（25）而不被 `fillSpawnMap`
   优先级判据挡住的唯一原因。
2. CE `spawnMapDF` **不检查"已标记"**，`probDec = 0` 的非 GAS 输入会**无限震荡**。
   CE 目录里所有走扩散的条目都满足 `probDec > 0`——**隐含输入约定**。
   手搓合成 DF 条目踩到 `dec = 0` 就是死循环，不是断言失败。

### ★ 「能不能走」全库有五套答案（C-4a 实测，我原先写错了机制）

`Grid.setTerrain` 的 `isPassable` 是本体，然后四个消费方**各打各的补丁**：
`Scent.ts:37/48` 加 CHASM/LAVA/WATER_DEEP；`SafetyMap.ts:118/347` 减
SECRET_DOOR 与 CHASM；`WaypointMap.ts:235/352` 只减 SECRET_DOOR。
`Pathfinding.calculateMap` **生产零调用点**（P4-9 后各消费方自算 cost 走 `batchScan`），
所以我原先"Pathfinding 继承了错口径"的说法是错的。
C-4a 已把 `canMoveTo` / `terrainAllowsMove` 迁为查 `TerrainCatalog`；
**真正的翻转点是 `setTerrain` 的启发式**，归 C-4a-1。

### ★ 出题时的自知之明：不要手抄 CE 数据表

C-4a-0 那轮我手抠归属层表，把 CHASM_EDGE 与 OBSIDIAN 按 drawPriority
同档猜成 SURFACE，实际是 LIQUID（`Globals.c:627` 的 DF 条目白纸黑字）。
**我在"照抄 CE 表格"上的错误率高于执行方。**
C-4a 的任务书因此刻意**不给任何 CE 数据表**，只定结构与门禁，表由执行方抽取。

### ★ 写探针前先读这一段（我已栽四次）

**优先跑既有闸门，而不是手搓探针。** p1_26 / p1_29 / p1_33 是前几轮写的，
新一轮一律禁改它们——跑它们本身就是独立验证，且它们的判据已经调对了。

手搓时的四个坑，我全踩过：
- `createHeadlessGame` + `generateDepth` 走**测试模式**的 `generateTestDepth`
  早返回路径，生成不出机器。真实生成要
  `rng.seedRandomGenerator(seed)` + `new Architect()` + `arch.generateLevel(d)`。
- 洪泛起点别取"扫描序第一个可走格"，那格可能是孤立口袋。
- 洪泛**不要在遍历时挡住机器格**——路径可以合法地穿过前厅一类机器内部；
  p1_33 用例 f 的做法是穿过去、只要求非机器可走格可达。
- 用 `cell.isPassable` 或漏掉 `LOCKED_DOOR` 都会让 bug 隐形。

### ★ 并行执行期间，全量测试结果不可信

实测教训：`invented_content_pool` 单独跑 6/6 绿、耗时 **53 秒**，而当时全局超时 120 秒；
C-2 的 zcode 在另一 worktree 里也反复跑 vitest，两边抢 CPU，于是
`armor_model_effect` / `horde_terrain_spawn` / `invented_content_pool` /
`monster_stats_effect` / `p1_29` 这些**重型长跑测试集体超时翻红**。发生过两次。

**C-2 后已治本**：`vite.config.ts` 的 `testTimeout` 上调至 **300s**、`hookTimeout` 120s。
理由与代价写在该文件注释里——**假红比慢更有害，它训练所有人把红灯当背景音**；
代价是真正挂死的用例要 300s 才浮出水面。

**规矩仍然有效**：
1. 执行方在跑时，全量读数只作参考；
2. 看到重型测试翻红，**先单独重跑该文件**再下结论；
3. **提交前的最终门禁必须在没有执行方占用 CPU 时跑一遍**。

已知重型测试（单跑耗时实测）：`c_0_add_loops` **148s**、`p1_29_lake_connectivity` 71s、
`invented_content_pool` 52s，另有 `armor_model_effect`、`monster_stats_effect`、
`horde_terrain_spawn`、`p1_33_machine_chokepoint`。**没有一个声明显式超时**，全靠全局值。

## 队列

| # | 轮次 | 状态 | 任务书 |
|---|---|---|---|
| 1 | ~~**B-2** 投掷~~ | ✅ 已合 `829c726` | `tasks/b-2.prompt.md` |
| 2 | ~~**C-7** 光照目录 + 矿灯衰减~~ | ✅ 已合 `6c3a34a` | `tasks/c-7.prompt.md` |
| 3 | ~~**B-3** 三占位卷轴~~ | ✅ 已合 `526b9db`（全量 81 文件 1007 绿） | `tasks/b-3.prompt.md` |
| 4 | **B-4a** 生成规则——「生成什么」（**独占**，移动 RNG 流） | 🟡 跑中 `wt-b-4a` | `tasks/b-4a.prompt.md` |
| 5 | **B-4b** 生成规则——「落在哪/多少」（**独占**，移动 RNG 流） | ⬜ 待写 | 热力图落位 / 金币 / 钥匙 140-166 / 每层数量 |
| 6 | **UI/渲染轮** | ⬜ 待写、**且暂不可测** | 见下方「为什么 UI 轮被推后」 |
| — | 中小 P1：P1-39 深水可游 / P1-41 成员铺开改路径距离 / C-4a-1 收敛通行判据 / i18n 扫描器模板字符串盲区 | ⬜ | 可合并；P1-41 属生成期，应挂在 B-4b 之后 |

### 为什么 UI 轮被推后（2026-09-17 验收方勘察）

渲染逻辑全部内联在 `src/components/GameCanvas.vue`（769 行）里，
**没有任何"给定格子 → 字形/颜色"的纯函数缝**。
这意味着 UI 轮的断言只能靠挂载 Vue 组件或截图比对，
按本项目「每条断言都必须能被某个具体的错误实现打红」的标准，**做不出有效门禁**。

所以 UI 轮的正确前置是**先做一轮纯重构**：把 cell → appearance 抽成纯函数，
渲染层只负责把它画出去。抽完之后 P1-47 / EMBERS-ASH-PLAIN_FIRE / 燃烧视觉 /
地面符号才有可测的落点。**不要在没有这个缝之前投 UI 轮**——
那一轮会产出一堆无法证伪的断言。

### B-3 交给 B-4b 的登记（2026-09-17）

- `AutoGenerator.ts` 序 1 / 序 33 两条 `CRYSTAL_WALL` 缺口：**地形侧已就位**
  （B-3 新增了 `CRYSTAL_WALL` tile），但 **`DF_CRYSTAL_WALL` 仍未入 web 的 DF 目录**
  （CE `Globals.c:607` `{CRYSTAL_WALL, DUNGEON, 200, 50, DFF_CLEAR_OTHER_TERRAIN}`）。
  接线时要连 DF 条目一起补，`c_4b` 的 E1 会 31→32。**接线即移动生成流**，只能在独占轮做。
- 圣徽是**十字 5 格**（中心 + 4 正邻，CE 100/100 波前），不是单格——UI 轮注意。
- B-3 登记的 deferral：`colorFlash` 等纯视觉、`IMPREGNABLE`（唯一置位源 `BP_IMPREGNABLE`
  在机器系统，web 缺）、碎石 DF 落地（web 无 `RUBBLE`）、`freeCaptivesEmbeddedAt`、
  `charmRechargeDelay`、per-cell `ITEM_DETECTED`。

### B-4 为什么拆成两轮

原计划一轮打包，勘察后发现范围失控：CE 的 `populateItems`（`Items.c:537-800`）
同时管**生成什么**（计量表 / 加权抽取 / 附魔模型）与**落在哪、多少个**
（热力图 / 金币投放 / 每层数量），而 web 这两块**都**与 CE 不同。
一轮全做会让「允许修改」清单覆盖半个引擎，验收也无法定位是哪一半出的问题。

拆法：**B-4a = 生成什么，B-4b = 落在哪/多少**。
两轮都移动 RNG 流，**必须串行**，各自重捕获一次基线。
两次重捕获比一次巨型轮次安全得多。

**并行配对规则**：只并行"允许修改"清单真正不相交的轮次；
**绝不并行两个都移动 RNG 流的轮次**；最多 2 个并发；**验收一律串行**。

---

## 未决条目（路线图有详条）

| 条目 | 一句话 | 轻重 |
|---|---|---|
| P1-37 | 宝库地板用 `CHARRED_FLOOR` 冒充 `IS_IN_MACHINE`，玩家会看到"烧焦的地面" | 中 |
| P1-25 | 击退落点判据用 `canMoveTo`，深水/熔岩口径不一致 | 中 |
| P1-14/15/16 | 饥饿行为 / `isProtected` 消费点 / 3 个占位卷轴 | 低 |
| — | ~~`Game.ts:3510-3594` 六条硬编码英文~~ ✅ **已随 B-1a/B-3 清掉**（2026-09-18 验收方复核：该段未走 i18n 的 `logger.log` 为 0；全库仅剩 `Game.ts:8624` 一条中文硬串，低） | ✅ |
| — | 突进的"猛烈突刺"专用措辞需加 i18n 键（B-1 登记） | 低 |

**⚠️ 订正（2026-09-18）**：本文件此前记载「`onConfirmRequest` 未接线，
默认 confirm 而 CE 默认 reject」——**后半句是错的**。CE `IO.c:2946-2975`：
Enter 映射到 Yes、Esc 与 `ACKNOWLEDGE_KEY` 映射到 No，且 `retVal` 非 -1 非 1
一律返回 true。详见路线图「UI-1 事实清单」第 9 条。

---

## 验收流程（每轮照做）

1. `git status --porcelain` + `git diff --stat` 查越界。
2. 全量测试 + build。**注意上面那条"并行期间读数不可信"。**
   执行方可能用"N passed"掩盖红项——自己看完整输出确认 `failed` 为 0。
3. **写独立探针**放 `src/test/zz_probe_<轮次>.test.ts`，**跑完务必删掉**。
4. 通过则提交（写清病灶、CE 行号、探针证据、未实现项、执行方纠正了我哪些错）；
   不通过则打回，说清"哪条断言、期望什么、实测什么、死路在哪"。
5. 探针撞见的**本轮范围外**的 bug，记进路线图并单独提交，不要顺手改。
6. **回来更新本文件的「当前状态」与「队列」。**

### ★ 探针的铁律

**打在真实生成的关卡/真实数据上，不能只复核执行方的人造场景。**
P4-9 有 7 条对抗性测试全绿，而真实关卡上 safety map 是整张平图、
`safetyNextStep` 在 60 个抽查格上给出方向 0 个。只复核它的场景就会放过去。

### ★ 阈值与基线的区别

- **基线重捕获**（记录当前状态）——有意变更后由验收方授权，正常。
- **放宽阈值**（削弱判据本身）——**必须论证新阈值仍有牙**：依据是什么、
  什么样的错误实现仍会被抓住，并写对抗性测试实证。
  C-1 那轮正是因为坚持这条，才查出"9.7% 阈值被击穿"其实是断言自身的**累计测量 bug**。

---

## 验收方自己反复踩的坑

1. **怪物之间默认非敌对**（`monstersAreEnemies`）——探针验怪打怪，攻击者要 `isAlly = true`。
2. **单次攻击会因命中掷骰 miss**——按单次断言即统计脆弱，改累计 N 次。
3. **叫错函数层**——几何攻击分"构建命中表 / 单目标结算"两层，要走真实入口。
4. **量错判据**——`canMoveTo` 排除的是 GRANITE/WALL/SECRET_DOOR/**LOCKED_DOOR**/**WATER_DEEP**
   （熔岩不排除）。用 `cell.isPassable` 或漏掉 `LOCKED_DOOR` 都会让 bug 隐形，两次都栽过。
5. **凭函数名和一处调用点下结论**。已因此写错：PDS 常量（CE 是 −1/−2 不是 30000/29999）、
   湖泊重试次数（20 不是 9）、`setUpWaypoints` 的种子隔离（CE 整段生成隔离、对主流零扰动，
   我错了三个版本）、"复用 P4-6 函数"却把那些函数所在文件列为禁改。
   **动手前把调用点上下文打开读完。**
6. **留痕测试与文件边界的系统性冲突**——已四次。见 `project_conventions.md` 新增的那一节。

---

## 已知代码坑

- `Pathfinding.ts` 的 `PDS_OBSTRUCTION=30000`/`PDS_FORBIDDEN=29999` 与 CE 的 −2/−1 不符，
  但文件内部自洽且有别的调用方——**不要纠正**，新代码用 `CE_PDS_*` / `WP_PDS_*`。
- `behaviorFlags` 与 `abilities` 是两个 Set；**`abilities` 全库无运行期写入者**，是死通道。
  旗标经 `syncFlagDerivedStatuses`（CE `initializeStatus`）翻译成状态生效。
- **`loopMap` 必须始终等于当前网格的 `analyzeLoopMap` 结果**——这个不变式已在四处漏过：
  `generateTestDepth`(P1-34)、`loadSnapshot`(P1-35)、waypoint 距离图、气味图。
  **新增任何"生成期派生态"时，检查所有重建网格的路径。**
- `environment.ignite()` 只点燃草/植被/沼泽/门；无视地形点火用 `igniteForced()`。
- `GasType.FIRE` **零读者但有一个写者**（F-0 修正）：`Game.ts:2872` 的
  `creeping_death` 药水 `addGas(x, y, 1, 100)` 喷的是"幽灵气"——不渲染、
  无效果、却占格扩散并挡住真气体（P1-45）。火焰伤害的真实来源仍是 `cell.isBurning`。
- 伤害记法 `"XdY"` → `{min:X, max:X*Y, clumping:X}`，**不是 min-max**。
- i18n：`defaultValue` 是无声降级通道。P1-30 已装红灯（扫描所有 `t()` 键），
  但**对硬编码英文字符串无效**。

---

## 项目决策速查

D1 行为一律照 CE，不调参凑手感 ｜ D2 自创内容保留代码但退出实际游戏 ｜
D3 大改先出方案文档再动手 ｜ D4 brogue-web 独立、不与其他项目共用文件 ｜
D5 `brogueweb/` 已封存 ｜ D6 `BrogueCE-master/` 只读参考

**执行方的 git 权限**：只读查询（`status`/`diff`/`log`）允许；
写操作（`commit`/`branch`/`merge`/`checkout`）禁止，由验收方负责。

详见 `ai_docs/dev_roadmap_2026Q3.md` 开头与 `ai_docs/phase_c_generator_proposal.md` §九。

## V-2a 验收结论（2026-09-19）

`round/v-2a` 分支，产物完整但**活没干完**（与 B-2/C-7「干完了死在写报告」不同）。门禁 93 文件 / 1167 passed / 15 failed。15 条已定性为三类：

| 类 | 条数 | 结论 |
|---|---|---|
| 前厅 `center === door` | 2（`blueprint_center` 102 处 + `p1_33`） | **真缺陷**，同一 bug 两把尺子。成因在 `BlueprintEngine.ts:372` 一行 |
| 生成期性能回归 | 11（全是 `STACK_TRACE_ERROR` 超时） | **真回归**。改前全套并行 411s，改后 `armor_model_effect` 单文件独跑 838s（自带 360s 超时），独跑也红 → 非并行争抢 |
| 基线待重捕获 | 1（`generation_baseline` 60 处） | 预期内，但必须**最后一步**捕，否则固化缺陷态 |

已核**不是**问题、不要让执行方去动的：
- 两个新缓存（`gateAnalysisCache` / `gateCandidatesCache`）设计成立。两者失效点故意不同（671 vs 894），671 行内注释给了 CE 依据（Architect.c:1063-1101）；只有 264 头注那句「失效时机一致」措辞需订正。
- 「center 不在 cells 内」这半条不成立：CE `fillInteriorForVestibuleMachine` 里 `distanceMap[origin]=0` 且 k 从 0 起，web `fillVestibuleInterior:929` 逐字镜像 → origin 恒为 cells 第一格。

任务书：`ai_docs/tasks/v-2a-finish.prompt.md`（182 行）。**需用户手动发起**（CLI 与 GUI 两条派发通道均不可用）。

## V-2a 补完轮验收（2026-09-19）：通过，待一个收尾轮才能合并

**验收方独立复核**（非采信报告）：
- 全量门禁 `npx vitest run`：9 failed / 1173 passed，**9 条全是 `STACK_TRACE_ERROR` 超时，零断言红**。（执行方报 7 条；差的 2 条是验收方并行开等待循环加重争抢所致。）
- `blueprint_center` + `p1_33` 单跑 **11/11 绿**（137s）—— 这是裁决关键项，必须独立跑到底。
- `npm run build` 绿。

**裁决：前厅 center 豁免——接受，但报告给的理由是错的。**

执行方行使授权反驳，主张"前厅 center=door=origin 是 CE 锚点语义"，于是没改引擎、改了两个测试的合同。验收方核查：

- 豁免是窄口径（按 `category==='vestibule'` 定向、保留 `center ∈ cells`、reward/key_guard 合同分毫未动），**不是整体放宽**。
- 但它给的支撑（AT_ORIGIN 锚点）**不成立**：`findFeaturePosition(available, used, center, origin, ...)` 第 4 个实参是 `room.door ?? room.center`，AT_ORIGIN 读的是 **door**，改 center 不会让锚点失守。
- **真正成立的支撑是 `MF_NEAR_ORIGIN`**：CE 的 ORIGIN 系旗标（Architect.c:1337-1348 的 distance25/75 界、`getFOVMask(..., originX, originY, ...)`）全部以 originX/originY 为基准；web 的 NEAR_ORIGIN 用的是 `center`，前厅 center==origin 才恰好与 CE 一致。把 center 挪开反而会偏离 CE。

**本轮查出的两处未登记偏差（登记给 V-2b）**：
1. `findFeaturePosition` 的 MF_NEAR_ORIGIN 以 `center` 为基准，CE 以 `originX/originY` 为基准 —— 对**全部 BP_ROOM 机器**都是偏差（前厅恰好重合所以看不出来）。
2. `Architect.trapVaults` **只声明、从未 push**，`Game.ts:1228` 的宝藏循环是死代码。前厅 center 豁免掉"可通行"检查的安全性**正建立在这条死代码上** —— 将来谁把 trapVaults 接上，前厅 center（LOCKED_DOOR 格）就成了宝藏坟墓。接线时必须连读本条。

**唯一挡住合并的**：`armor_model_effect` 聚合用例（timeout 360s，实测 823-923s）跑不完。非行为回归，是 V-2a 内容回归的既定成本（每局抽取 30 万 → 70-80 万）。收尾任务书 `ai_docs/tasks/v-2a-perf.prompt.md`。

**门禁总时长 411s → 1653s（4×）**，这是此后每一轮的固定成本。
