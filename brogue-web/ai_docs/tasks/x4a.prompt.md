# X4a：自动探索/寻路按 CE 逐步重算；投掷选目标可取消；地图字形强制文本呈现

> **本地执行（Mac 轨 xhigh）。来源：用户试玩反馈 + FE-1 报告 §6 引擎接口需求。**
> 基线：`frontend-mobile` 头（`ae63cadd`，= main + FE-1 A–D，前端组件以此为准）。

## 0. 规格与问题事实（验收方已核对）

### A. 自动探索频繁"此路不通"（用户反馈）

web 现状（`src/engine/Core/Game.ts`）：
- 探索（`x`）在 `~G:9529–9570` 做一次 BFS 选目标，`setAutoPath` 一次性算出整条 A* 路径存入 `autoPath`；
  `PlayerTravel.ts:20` 把**未发现格一律视为可走**，所以路径常穿过未知区域。
- `stepAutoPathInner`（`~G:10494–10500`）逐步沿旧路径走；下一格若 `!grid.getCell(next).isPassable`（**真实地形，含玩家未见过的墙**）就清路径并打印 `move.path_blocked`（"此路不通。"）。
  后果：①新揭示的墙导致探索频繁中断并刷提示；②用真实地形判定未见格属于信息泄露。
- 步进直接写 `player.loc`（`~G:10512–10516`）而非走手动移动同一条路径。

CE 规则（`BrogueCE-master/src/brogue/Movement.c`）：
- `explore()`（:2258 起）：**每一步**重新 `getExploreMap`（:2206）→ `nextStep`（:1767）取方向 → `playerMoves(dir)`；相邻敌人先 `adjacentFightingDir/startFighting`；混乱/被困时拒绝；新怪物/物品出现 → `rogue.disturbed` 停止。无"路径被阻"提示。
- `travelRoute()`（:1842）：每步前检查**剩余已知路径**是否因 `diagonalBlocked`/`monsterAvoids(&player, …)`（按玩家已知信息）变得不可走，是则 `disturbed` 静默停止；每步经 `playerMoves`，失败即停。
- `travelMap()`（:1887）同理，经 `playerMoves`。

要求：
1. 自动探索改为 CE 语义：每一步用**玩家已知信息**重算探索目标/距离图并取下一步（可沿用现有 BFS/A* 实现，但必须逐步重算；若能以合理代价移植 `getExploreMap`+`nextStep` 更好），新揭示的墙只会让下一步改道，不中断、不提示。探索无目标时仍打印"这里没有什么可探索的了"。
2. 点击寻路（travel）按 `travelRoute`：每步前用已知信息复核剩余路径，失效则静默停止（不打印 `path_blocked`）；不得用真实地形判定未见格。
3. 每一步都经与手动移动相同的移动入口（等价 `playerMoves`：含攻击/拾取/地形进入/回合推进），删除直接写 `player.loc` 的旁路；保持 P2-2 输入锁、P2-4 自动行进口径、W-18 混乱行为、U27 录像边界（`auto_step` 命令）不变。
4. 若 `move.path_blocked` 因此无调用者，删除该 i18n 键并同步守卫；保留"无法到达该位置"（起步即无路径）的提示。

### B. 投掷选目标无法取消（FE-1 报告 §6）

`isThrowing` 只在投出后清零，`escape` 不清除，桌面按 Esc 与触屏"取消"都无效。CE `throwCommand` → `chooseTarget` 返回 false 时直接 return，不消耗回合、不动 RNG。
要求：`handlePlayerAction('escape')` 在 `isThrowing` 且背包未开时清除 `isThrowing` 与 `throwItemTarget`，不耗回合、不碰 rng，作为一条 `escape` 命令被录制；随后把前端 TargetBar 的投掷取消接到这条命令，并移除 `mobile.target.throw_cancel_unsupported` 提示（及其 i18n 键）。

### C. 茂密植被显示为彩色 emoji（用户反馈"视野外持续高亮"）

CE `platformdependent.c:124` `G_FOLIAGE → U_ARIES`（♈ U+2648），CE 用自身字体按文本绘制。web `TerrainAppearanceCatalog.ts:24,111` 同为 `♈`，但 Pixi `Text` 交给浏览器排版，macOS/iOS/Android 默认按 **emoji 呈现**（紫色方块），忽略前景色、光照与记忆变暗 → 视野内外都"高亮"。同类风险：`♠` U+2660（Architect/Blueprint/Game 中用作字形）。
要求：在渲染层（`GameCanvas.vue` 设置 `sprite.text` 处及 bolt/浮字等同类处）对具有 emoji 呈现能力的码点统一追加 U+FE0E（文本呈现选择符），或采用等效且可测的方法；**不改引擎中的 CE 字符数据**。补守卫：地形/实体目录中所有字形经渲染规范化后不含默认 emoji 呈现的码点（至少覆盖 U+2600–U+27BF、U+2B00–U+2BFF 区段中 Emoji=Yes 的字符）。在浏览器中截图对比修复前后（桌面 + 手机视口，植被在视野内/记忆中各一张），放 `ai_docs/reports/x4a-evidence/`。

## 1. 约束

📌 CE 优先于本任务书；**撞上守卫时改代码，不改守卫**；守卫只在旧行为下才绿时，先做反事实证明、只修前提、交验收方裁决；
不追求同种子逐骰一致（项目裁决），但**规则可观察结果**须与 CE 一致；黄金 trace（UR2/UR3/UR4）若翻红：单变量归因（仅回退本单元生产文件使旧夹具通过）后按原方法重录并登记；
不得改变 test:drift / 深层基线；反查闭包含 p1_30、U24、U27、X2a、X3b、W-18、P2-2、P2-4、fe_1_touch、i_1_interaction 与所有读源码守卫；不产生 CRLF；不提交 dist。

## 2. 门禁与报告

vue-tsc + build + **全量 npm test 完整跑完** + test:drift；最终复跑声明。
报告 `ai_docs/reports/x4a.report.md`：三项各自的 CE 依据、改动、守卫、证据；列出任何重录的 trace 及归因。
