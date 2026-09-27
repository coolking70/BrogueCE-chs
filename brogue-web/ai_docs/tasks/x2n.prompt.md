# X2n：胜利高分描述的流明宝石数按 CE 求 quantity 和（不移动生成流）

> **本地执行（Windows 轨）。X-1b §4 XB01。纠正验收方此前错误推广的前提。**

## 0. 规格与 CE 依据

**`ai_docs/reports/x-1b-survey.report.md` §4 XB01 是权威规格**：
> 25 颗/14 来源层背包经真实 D40 portal 超胜利 → description=`Mastered the Dungeons of Doom with 14 lumenstones!`；CE 应为 **25**。`u_26a_deep_levels.test.ts:249` 断言 14 —— 该绿灯不能关闭此问题。

CE（验收方已核）：
- 胜利 `RogueMain.c` 约 :1312–1313 `if (theItem->category & GEM) gemCount += theItem->quantity;`，描述 :1366–1371 用 `gemCount`（0/1/复数三档）
- 死亡 `RogueMain.c:1169–1175` `numberOfMatchingPackItems(GEM,…)` 按**背包条目数** × 500 兑换金币——U26b 此裁决**正确，保持不变**

## 1. 范围

- `Endgame.ts` 把"死亡兑换条目数"和"胜利描述宝石颗数"拆成两个明确函数（不要再共用 `lumenstoneCount`）；胜利分数 `itemValue` 5000×quantity 不变
- 修正 `u_26a_deep_levels.test.ts:249` 及 U26b 专项中依赖"胜利描述按条目数"的旧前提——**这是验收方此前的错误裁决，允许按 CE 直接翻正**，并在报告写明 CE 行号；死亡兑换的断言保持
- 高分榜描述、GameEndOverlay 显示、U27 结局 checkpoint 随之正确
- 黄金 trace 若翻红：单变量归因后按原方法重录并登记

## 2. 约束

📌 **撞上守卫时改代码，不改守卫**（本轮点名的两处错误前提除外，须附 CE 行号）；**不得改变 test:drift / 深层基线**；
**反查闭包含 p1_30、U24、U26a/b、U27、p1_24 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2n.report.md`。
