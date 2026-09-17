# B-2（续）：补完收尾 —— 你上一次运行撞上了 5 小时配额上限

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**。

## 状况说明

**你上一次跑 B-2 时被 GLM 的 5 小时使用上限中断**，不是任务失败。
**产物完好留在工作区**（验收方已快照保全，767 行）：

```
 M src/engine/Combat/Combat.ts        (+61)
 M src/engine/Core/Game.ts            (+323)
 M src/engine/Input.ts                (+7)
 M src/locales/zh_CN.json             (+5)
 M src/locales/zh_CN.legacy.json      (+3)   ← 见下，需要你说明
 M src/test/b_1a_identification.test.ts (+40)
 M src/test/p1_46_keybindings.test.ts   (+8)
?? src/test/b_2_throwing.test.ts      (379 行，新建，16 条全绿)
```

**验收方已代你验过**：`b_2_throwing.test.ts` **16/16 全绿**；
`npm run build` 剩**两个**错误，都在你的新测试文件里：
- `b_2_throwing.test.ts(33,1)`: TS6133 `'CombatSystem'` 声明未使用
- `b_2_throwing.test.ts(97,45)`: TS2367 `MonsterState.ASLEEP` 与
  `MonsterState.HUNTING` 的比较**类型上不可能成立**
  ——⚠️ **这条不是清理项，是可能的真 bug**：那行断言大概率永远为假或永远为真，
  请查明本意并修对。

**所以实现基本完成，缺的是收尾与报告。不要推倒重来。**

---

## 本轮只做四件事

### 1. 修掉两个 TS 错误

尤其 TS2367 那条——**先查明断言本意**，不要为了消错而把断言改弱。

### 2. 说明一处越界（验收方需要裁决）

你改了 `src/locales/zh_CN.legacy.json`（加了键 `monster.looks_healthy`），
**该文件不在原任务书的允许清单里**（只允许 `zh_CN.json` 且仅增键）。

请在报告里说明：**为什么需要动它**（是 i18n 门禁的要求吗？），
以及**能不能只改 `zh_CN.json` 就满足门禁**。若能，请改回去。

### 3. 跑完整门禁并如实报告

原任务书 `ai_docs/b-2.prompt.md` §四 与 §六：
- **`generation_baseline` 必须保持绿**（投掷是交互期行为，不该碰生成期）；
- **但它不够**——`generation_baseline` 对交互期掷骰是盲的
  （`project_conventions.md` 2026-09-17 立，B-1c 实证）。
  **本轮必须另立交互期哨兵**：`rng.randomNumbersGenerated` **增量**口径，
  建在构造场景上（S-1 摸清的隔离通道：`createHeadlessGame(seed, 'test')`
  走合成层 + 清场 + 搭好后重播种）。
  **反向验证必须真往交互期注入一次掷骰确认它翻红**
  ——B-1c 正是靠这一步发现自己的哨兵调错了函数层。
- 全量用 `npx vitest run --fileParallelism=false`（串行）。

### 4. 补写报告 `ai_docs/b_2_throwing_report.md`

按原任务书 §七：CE 投掷路径的行号与复核要点、**载体盘点表**
（CE 的投掷武器在 web 有哪些——`weapons.json` 里似乎只有 `dart`）、
**交互期哨兵的设计与反向验证输出**、`generation_baseline` 绿的实际输出行、
改了哪些既有测试断言、对抗性测试与**反向验证的真实失败输出**、
给 B-3 / B-4 的登记清单。

⚠️ **反向验证（≥4 条真实改坏 → 贴输出 → 还原）若上一次没做完，本轮必须补做**，
并确认 `grep -rn "REVERT-ME" src/` 为 0。

---

## 文件边界

与原任务书 `ai_docs/b-2.prompt.md` §五**完全一致**。
`src/data/*.json` 仍然禁改（投掷武器数据表归 B-4）。

---

## 如果你发现上一次的实现有问题

**直接改**，并在报告里说明——你现在有完整上下文重新审视它。
尤其自查：**投掷真的是逐格弹道了吗，还是仍有"瞬移到目标格"的残留？**
（这是本轮要反转的留痕：B-0 实测"投掷是传送 + 落地"。）
