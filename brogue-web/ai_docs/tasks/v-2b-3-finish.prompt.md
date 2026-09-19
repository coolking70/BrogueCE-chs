# V-2b-3 补完轮：产物完好，接着往下做

## 0. 先读这段：**不要推倒重来**

上一轮跑了 48 分钟后以 `unknown_error` 中断（**不是配额耗尽**，远未到时长上限），
**没有写出报告**，但引擎侧产物完整且自洽，已保留在 `round/v-2b-3` 分支的工作区
（未提交）。验收方逐项独立核过，下面两张表就是核出来的。

### 已完成（**不要重做、不要"顺手重构"**）

| 任务书条款 | 状态 | 证据 |
|---|---|---|
| §1.1 `activateMachine` | ✅ | `Promotion.ts:253`，CE `Time.c:1173-1228` 直译，含洗牌序 |
| §1.2 `IS_POWERED` 格标记 | ✅ | `Grid.ts`（+62 行） |
| §1.3 wired 分支 | ✅ | 占位已升格为真实通电；头注第 5 条已改写，CE 三要点（先置位再递归 / 机器不必连续 / 结束清全图）逐条注明行号 |
| §1.4 `circuitBreakersPreventActivation` | ✅ | `Promotion.ts:218`，CE `Time.c:1230-1242` 直译 |
| §2 载体地形 | ✅ | 新增 **9** 个 TerrainType（MACHINE_GLYPH / PORTCULLIS_CLOSED / WORM_TUNNEL_OUTER_WALL / WALL_LEVER_HIDDEN / GAS_TRAP_PARALYSIS(+_HIDDEN) / MACHINE_PARALYSIS_VENT_HIDDEN / MACHINE_METHANE_VENT_HIDDEN / PILOT_LIGHT_DORMANT）+ `TerrainCatalog.ts`（+93）+ `DungeonFeatureCatalog.ts`（+209） |
| §2 `MACHINE_PRESSURE_PLATE` 别名判定 | ✅ | 按 web `PRESSURE_PLATE` 处理，CE 依据 `Globals.c:402` 已注（`TerrainCatalog.ts:292`） |

改动面 4 文件 / +504 −8，全部在授权清单内。

### 未完成（本轮要做的）

1. **`npm run build` 现在是红的**（见 §1）——这是第一优先
2. §1.5 的 REPEAT failsafe（`BlueprintEngine.ts` 一行未动）
3. §3 六条蓝图（`blueprints.json` 一行未动）
4. `wiredBranchHit` 的留痕反转（测试侧）
5. 新测试 `v_2b_3_wired.test.ts`
6. 基线重捕获（最后一步）
7. 报告

---

## 1. 第一优先：先把 build 修绿

新增 9 个 TerrainType 后，两个 `Record<TerrainType, …>` 穷举表缺成员，
`vue-tsc` 直接报错：

```
src/test/c_7_lighting.test.ts(139,11): error TS2740: ... is missing the following
  properties from type 'Record<TerrainType, number>': 53, 54, 55, 56, and 5 more.
src/test/r_1_appearance.test.ts(71,7):  error TS2740: ... 同上
```

两个文件都**在上一轮任务书 §5 的授权清单里**（验收方吸取 V-2b-2b 教训预列的），
直接补成员即可。补的值要与 `TerrainCatalog` / 渲染口径一致，不要随手填 0 —— 
`r_1_appearance` 是外观穷举、`c_7_lighting` 是发光值穷举，填错等于悄悄改了渲染。

**做完这一步先跑一次 `npm run build` 确认绿**，再往下做。后面每加一个地形都可能
再撞这类表，养成"加完地形立刻 build"的节奏，别攒到最后。

---

## 2. 其余五件（原任务书条款，原文仍有效）

原任务书 `ai_docs/tasks/v-2b-3.prompt.md` **仍然是本轮的规格**，下列条款照其原文执行：

- **§1.5 REPEAT failsafe** —— 给 `BlueprintEngine.ts:1193` 的 do-while 加迭代上界 +
  显式抛错（带蓝图 id / feature 序号 / 轮数）。纯防御，可达路径零行为变化。
- **§0 的留痕反转** —— 自己 grep 找全所有钉 `wiredBranchHit` 的断言，逐个反转为
  「命中时真的通电了」。**这是硬要求**：占位的前提已经变假，不许只改实现不动断言，
  也不许直接删断言。
- **§3 六条蓝图** —— 18 / 22 / 24 / 25 / 67 / 68（41 号按原 §2 推迟到 V-2b-4）。
- **新测试** `v_2b_3_wired.test.ts`。
- **§4 基线重捕获** —— **最后一步**。原文那条判据仍然有效且重要：先测清楚生成期
  到底触不触发激活；若零触发则基线**不应**偏离，偏离了就是实现误伤，停下来查，
  别用重捕获盖过去。

---

## 3. 授权改动清单

沿用原任务书 §5 的清单（含验收方预列的穷举表类文件），**再加**：

- `src/engine/Generator/BlueprintEngine.ts`（§1.5 的 failsafe）
- `src/data/blueprints.json`（§3 的六条蓝图）

清单外一律不动；`BrogueCE-master/` 只读。**守卫顺延不放宽**；撞断 > 5 个停下来在
报告里说明，不要硬改。

---

## 4. 关于上一轮的中断本身

`unknown_error` 无堆栈，成因不明。**若你在执行中观察到任何可能的成因**（某个操作
反复超时、某个文件异常大、某次工具调用挂死），在报告里单列一节写明——这比补完
本身更有长期价值，前几轮已经有三次类似中断了。

若本轮再次中断：产物同样会被保留，验收方会再写一份补完任务书。**所以宁可慢、
宁可分步验证，也不要为了赶进度跳过 build 检查。**

---

## 5. 门禁与报告

```
npx vitest run
npm run build
```

并行跑，不加 `--fileParallelism=false`；失败清单完整输出，不要 `| tail`。
全量门禁墙钟约 9 分钟。

报告写到 `ai_docs/reports/v-2b-3.report.md`，含原任务书 §8 要求的八项，
外加 §4 的中断成因观察（无则写"无"）。
