# C-7（续）：补完收尾 —— 你上一次运行撞上了 5 小时配额上限

> 只改"允许修改"清单里的文件；**不要执行任何 git 写操作**。

## 状况说明

**你上一次跑 C-7 时被 GLM 的 5 小时使用上限中断**，不是任务失败。
**你的产物完好地留在工作区**（验收方已快照保全）：

```
 M src/engine/Core/Game.ts          (+208)
 M src/engine/Lighting/LightMap.ts  (+310)
 M src/engine/Map/TerrainCatalog.ts (+62)
?? src/engine/Map/LightCatalog.ts   (398 行，新建)
?? src/test/c_7_lighting.test.ts    (610 行，新建，25 条全绿)
```

**验收方已代你验过**：`npx vitest run src/test/c_7_lighting.test.ts` → **25/25 全绿**；
`npm run build` 只剩**一个** TS6133：
`src/test/c_7_lighting.test.ts(26,5): 'FP_FACTOR' is declared but its value is never read`。

**所以实现基本完成，缺的是收尾与报告。不要推倒重来。**

---

## 本轮只做三件事

### 1. 清掉那个 TS6133

要么用上 `FP_FACTOR`，要么删掉它。`npm run build` 必须绿。

### 2. 跑完整门禁并如实报告

原任务书 `ai_docs/c-7.prompt.md` §四 的五条：
1. **反向哨兵**：火 / 气体 / 坠落 / 自动生成器的行为断言必须不变。
   ⚠️ **S-1 刚把 8 个哨兵改造成对 RNG 流位移免疫**——本轮若改了生成，
   它们应当**保持绿**；若有翻红，那是真阳性或改造不彻底，**如实报告**。
2. `generation_baseline` 若因新增光照数据变红，**如实报告不许刷新**。
3. 坏层闸门 `p1_26` / `p1_29` / `p1_33` 仍为 0。
4. 载体盘点表 + "接了/没接/为什么"。
5. `npm run build` 绿。

全量用 `npx vitest run --fileParallelism=false`（串行）。
**注意另一轮（B-2）可能并行**，重型测试可能因抢 CPU 假红——先单跑复核。

### 3. 补写报告 `ai_docs/c_7_lighting_report.md`

按原任务书 §八：光照目录的 CE 出处与字段语义、**载体盘点表**与
"引擎侧可观测 / 必须等渲染轮"的判断、`updateMinersLightRadius` 的 CE 行号、
**留形分支逐字重核声明**、反向哨兵的逐位比对输出、改了哪些既有测试断言、
对抗性测试与**反向验证的真实失败输出**、**C 链收口总结**。

⚠️ **反向验证（≥3 条真实改坏 → 贴输出 → 还原）若上一次没做完，本轮必须补做**，
并确认 `grep -rn "REVERT-ME" src/` 为 0。

---

## 文件边界

与原任务书 `ai_docs/c-7.prompt.md` §六**完全一致**，不再重复。
特别提醒：`src/components/`（渲染层）禁改，归 UI 轮。

---

## 如果你发现上一次的实现有问题

**直接改**，并在报告里说明——你现在有完整的上下文重新审视它。
尤其请自查：**有没有接了光照目录却没人消费的空转链**
（原任务书 §二.3 的核心要求：只做引擎侧可观测的那部分）。
