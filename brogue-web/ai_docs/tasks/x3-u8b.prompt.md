# X3-U8b：装备力量提示、满包与回避标记、装备细节分支

> **本地执行（Mac 轨 xhigh）。门禁：中档。** 基线：main（含 X3-U1–U7、X4-R4）。
> Mac 同时有 X3-U8a（`TimeCoordinator.ts`、`Game.ts` 移动分支/麻痹段/幻觉分支）；Windows 有 X4-R1（地图目录）。**只改本单元所需方法段。**

## 0. 规格

**`ai_docs/reports/x-3-survey.report.md` 的 X3-A08、A09、A10（总表、§2、§8 X3-U8 行）是权威规格**：
- A08（`C/Items.c:3925-3958` strengthCheck）：装备力量不足的武器/护甲后按 CE 出 "You can barely lift …; N more strength would be ideal." / "You stagger under the weight …"（只出消息，不改数值）。
- A09（`C/Items.c:836-935`，满包 `:930-934`；`:8386,6857,6873`；`C/Movement.c:2175,2235`）：满包走上物品格提示 "Your pack is too full to pick up X." 并打 `ITEM_PLAYER_AVOIDS`；丢弃、投掷落地（CE 未命中的武器除外）也打 AVOIDS；探索目标与自动拾取尊重 AVOIDS（实测 P11/P12）。
- A10（`C/Items.c:3983-4003,8319-8327,8352-8357,8393-8396`）："you are already wearing that ring."；两枚戒指时按 CE 提示选一枚替换；"your X was not equipped."；站在 T_OBSTRUCTS_ITEMS 格时丢弃被拒 "There is already something there."。

## 1. 约束

📌 CE 优先；撞守卫改代码不改守卫；守卫只在旧行为下才绿时先反事实证明、只修前提、交裁决。
AVOIDS 为物品持久旗标：随快照保存（按 U03 契约登记），不做旧档迁移；不改规则数值与生成；不新增 RNG 调用；录像回放零 OOS。文案走 i18n。黄金 trace 若翻红：单变量归因后按原方法重录并登记。截图只放本地 evidence，不提交 PNG；不产生 CRLF。

## 2. 门禁（中档）

`npx vue-tsc -b`；`npm run build`；`npx vitest run` 本单元新增守卫 + grep 反查引用 `equipItem`/`unequip`/`dropItem`/`pickup`/`ITEM_PLAYER_AVOIDS`/`isAutoExploring`/`strength` 的测试 + p1_30、u24、u_27_recording、x2a、x3_u1–u6 守卫、x4a、fe_1_touch、i_1_interaction、UR2/UR3/UR4、U03；`npm run test:drift`。

## 3. 报告

`ai_docs/reports/x3-u8b.report.md`：CE 依据、改动、守卫（力量不足两种提示；满包提示+不再反复尝试；丢弃/投掷后探索不回捡；未命中武器例外；戒指/丢弃拒绝分支）、门禁结果与实际执行清单。
