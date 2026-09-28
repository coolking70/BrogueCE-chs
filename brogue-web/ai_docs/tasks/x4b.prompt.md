# X4b：地形描述走"位置描述行"，不进行动日志（CE flavorMessage）

> **本地执行（Mac 轨 xhigh）。来源：用户试玩反馈。门禁档位：中档（见 §3）。**
> 基线：main `bd6bc768`（含 FE-1 A–D、X4a）。

## 0. 问题与 CE 规则（验收方已核对）

用户反馈：每走一步，"你正站在打开的门上。""你正站在踩倒的植被上。"等都写进行动日志，刷屏严重（同屏出现 ×11、×12 的重复计数）。

web 现状：`src/engine/Core/Game.ts:~9184` `bindDungeonFeatureEffects` 的 `flavor` 回调用 `logger.log(i18next.t('df.flavor', …))` 把 DF 触发的地形描述写入消息日志。

CE 规则：
- `Architect.c:3252` DF 生成时对玩家所在格调用 `flavorMessage(tileFlavor(player.loc))`；
- `IO.c:3425 flavorMessage`：只打印到地图下方的**位置描述行**（`ROWS - 2`，`flavorTextColor`），**不进入消息存档**；
- `Movement.c:61`、`:1886`、`:1924`、`IO.c:3378` 等处 `updateFlavorText()`：每回合/行进结束刷新该行为玩家当前位置描述（`describeLocation`）；鼠标悬停时该行显示悬停格描述。

## 1. 要求

1. 引擎提供"位置描述行"状态（例如 `game.flavorText`，纯显示、不入存档、不入录像、不碰 rng）：
   - DF flavor 回调改为设置该状态，**不再写日志**；
   - 玩家移动/回合结束/自动行进结束后按 CE `updateFlavorText` 语义刷新为玩家位置描述（复用现有 `describeLocation`/地形名逻辑；若 web 已有等价函数直接用）。
2. 前端：桌面侧栏与手机 `MessageStrip` 现有显示 `hoveredText` 的位置改为"悬停/长按描述优先，否则显示 `flavorText`"（CE 同一行的行为）；样式沿用现有次要文字色。
3. 其余真正的消息（战斗、拾取、发现物品、坠落 `fall.flavor_*` 等 CE 用 `message()` 的文案）**保持进日志**，逐条对照 CE 是 `message` 还是 `flavorMessage` 决定去向；在报告中列出本次改变去向的全部调用点及 CE 出处。
4. i18n：`df.flavor` 若仍被使用保持键名；不新增硬编码文本。

## 2. 约束

📌 CE 优先于本任务书；撞上守卫时改代码，不改守卫；守卫仅在旧行为下才绿时先做反事实证明、只修前提、交验收方裁决。
不改游戏规则、生成与 RNG 调用；不改存档格式（`flavorText` 不入快照，U03 若要求登记则按 `reset`/显示类登记）。
黄金 trace（UR2/UR3/UR4）若因日志内容变化翻红：单变量归因（只回退本单元生产文件使旧夹具通过）后按原方法重录并登记。
不产生 CRLF；不提交 dist；**验收截图只放本地 `ai_docs/reports/x4b-evidence/`，不提交 PNG**（`.gitignore` 已覆盖）。

## 3. 门禁（中档，**不跑全量 npm test**）

在 `brogue-web/` 下：
```bash
npx vue-tsc -b
npm run build
npx vitest run <本单元新增/修改的测试> <所有引用 df.flavor、logger、hoveredText、MessageStrip、Sidebar 的测试> \
  src/test/p1_30_i18n_gate.test.ts src/test/u24_hardcoded_text.test.ts \
  src/test/u_27_recording.test.ts src/test/x2a_recording_checkpoint.test.ts src/test/x3b_display_recording.test.ts \
  src/test/x4a_movement_rendering.test.ts src/test/fe_1_touch.test.ts src/test/ui_1_rendering.test.ts src/test/i_1_interaction.test.ts \
  <UR2/UR3/UR4 黄金 trace 测试文件> <U03 状态契约测试文件>
npm run test:drift
```
反查：用 grep 找出所有读取 Game.ts/Sidebar.vue/MessageStrip.vue 源码的守卫一并纳入。报告中列出实际执行的文件清单与结果。

## 4. 报告

`ai_docs/reports/x4b.report.md`：CE 依据、去向变化清单、新增守卫（至少：踩倒植被/开门不产生日志条目而更新位置描述行；战斗/拾取消息仍进日志；位置描述不影响录像回放零 OOS）、门禁清单与结果。
