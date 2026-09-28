# X3-U8a：麻痹期间自动连续过回合；删除自创幻觉踉跄

> **本地执行（Mac 轨 xhigh）。门禁：全量。** 基线：main（含 X3-U1–U6、X4-R4）。
> Mac 同时有 X3-U7（`MonsterSidebar.ts`、`Sidebar.vue`、`Game.ts` 的 `updateHover`/侧栏数据段）；Windows 有 X4-R1（地图目录文件）。**只改本单元所需方法段。**

## 0. 规格

**`ai_docs/reports/x-3-survey.report.md` 的 X3-B06、X3-D11（总表、§3、§5、§8 X3-U8 行）是权威规格**：
- B06（`C/Time.c:2468-2872` 的 `do … while (player.status[STATUS_PARALYZED])`）：麻痹期间 CE 自动连续推进回合，玩家无需按键；web 每回合都要一次输入并记 "You are paralyzed and cannot act!"（实测 P9 刷屏）。按 CE 在 playerTurnEnded 内循环推进麻痹回合，录像上由触发它的那条命令覆盖多回合，回放零 OOS；动画模式下按既有 P2-4 口径同步推进。
- D11（`C/Movement.c:1097-1138` 只有混乱随机方向；`:837-843` 幻觉只影响 abortAttack）：删除 web 自创的幻觉 35% 随机方向"踉跄"（`G:3124-3138` 附近）及其文案与 RNG 调用。

## 1. 约束

📌 CE 优先；撞守卫改代码不改守卫；守卫只在旧行为下才绿时先反事实证明、只修前提、交裁决。
D11 会移除一处主 RNG 调用：生成基线不应受影响；黄金 trace/录像若翻红，单变量归因后按原方法重录并登记。文案走 i18n。截图只放本地 evidence，不提交 PNG；不产生 CRLF。

## 2. 门禁（全量）

`npx vue-tsc -b`；`npm run build`；**全量 `npm test` 完整跑完**；`npm run test:drift`。本机另有执行方，长测试若因 CPU 争用超时，按原门限单独复跑并说明。

## 3. 报告

`ai_docs/reports/x3-u8a.report.md`：CE 依据、改动、守卫（麻痹 N 回合一次输入推进完、期间怪物照常行动、录像/回放零 OOS；幻觉移动方向不再随机、混乱仍按 CE 随机）、门禁结果与最终复跑声明。
