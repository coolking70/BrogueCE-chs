# V-2a 补完轮：前厅 center 契约 + 生成期性能回归 + 基线重捕获

## 0. 先读这一段：产物完好，**不要推倒重来**

上一轮 V-2a 跑了 163 分钟后以 `error` 收场、**没有写出报告文件**，但**代码产物是完整的、已保留在 `round/v-2a` 分支**。验收方已独立核过：

- 三项要求的改动全部到位：`MF_BUILD_VESTIBULE` ×4、`MF_OUTSOURCE_ITEM_TO_MACHINE` ×1、`MF_ALTERNATIVE` ×2
- 新测试 `src/test/v_2a_vestibule_return.test.ts`（146 行 / 3 个用例）语法完整，**门禁中这 3 个用例全绿**
- `MF_KEY_DISPOSABLE` 只进了数据、引擎未消费（遵守了上轮禁令）
- 无 `REVERT-ME` 残留，`MF_BUILD_AT_ORIGIN` 实现在位 —— 代码不是被故意留残的

**你的任务是在这份产物上补完，不是重做。** 上轮新增的两个缓存（`gateAnalysisCache` / `gateCandidatesCache`）验收方已逐处核过设计，**判定成立、予以保留**，不要删除或"简化"。

门禁现状：93 文件 / 1167 passed / **15 failed**。下面把这 15 条分成三类，逐类给结论。

---

## 1. 真缺陷（必须修）：前厅机器的 `center` 与 `door` 取了同一格

### 现象

`p1_33_machine_chokepoint.test.ts` a) 报 `机器结构合同被破坏`，逐条点名的**全部**是 `vestibule_*`：

```
seed424242/D3  vestibule_locked     center 非法（不在 cells 内或与 door 重合）
seed424242/D3  vestibule_flammable  center 非法（...）
seed777/D9     vestibule_guardian   center 非法（...）
...
```

`blueprint_center.test.ts` b) 的 `expected [ …(102) ] to deeply equal []` 是**同一缺陷被另一把尺子量到**（12 seeds × D1..D26 全局扫描），不是第二个 bug。修掉一个，两条一起绿。

### 成因（已定位到行）

`src/engine/Generator/BlueprintEngine.ts` 约 372 行，BP_VESTIBULE 分支：

```ts
const interior = this.fillVestibuleInterior(bp, origin);
if (!interior) return null;
room = { cells: interior, center: origin, door: origin };
```

`center` 和 `door` 被赋成了同一个 `origin`。契约要求 center ∈ cells **且** center ≠ door，所以违的是后半条。

### 判定依据（CE 已核，不要重复推翻）

"center 不在 cells 内"这半条**不成立**，别往那个方向修：

- CE `fillInteriorForVestibuleMachine`（Architect.c）里 `distanceMap[originX][originY] = 0`，而收格循环 `for (k=0; ...)` **从 k=0 起**，所以 origin 本身就是 interior 收的第一格。
- web `fillVestibuleInterior`（BlueprintEngine.ts:929）逐字镜像了这一点：`dist[origin.x][origin.y] = 0`，k 从 0 起。

结论：`origin ∈ cells` **恒成立**，活缺陷只有"与 door 重合"一条。

### 修法要求

给前厅选一个 ≠ door 的 center。**硬约束：**

1. **不得消耗 RNG。** 生成期多掷一次骰子会让全线基线再次分叉，代价远超这个 bug 本身。选法必须是对已有 `cells` 的确定性函数。
2. center 必须 ∈ cells，且该格可通行（`blueprint_center` 测的是"宝藏落点可通行性"）。
3. 退化兜底：`cells.length === 1` 时（door 被封死、dijkstra 扩不开）无法满足 center ≠ door。四个前厅蓝图的 `roomSize` 下限分别是 6/8/10/8，正常不会退化，但你要处理：要么在此情形让 `fillVestibuleInterior` 返回 `null`（建造失败，CE 有 "not enough room" 的同源失败路径），要么在契约测试里给出**有 CE 依据的**豁免。选哪条你定，但要在报告里写明理由。

推荐（非强制）：取 `cells` 中距 door 最远的那格（即 dijkstra 外壳序里最后收进来的），语义上"最深入前厅内部、远离门口"，确定性、零 RNG。若你有更贴 CE 的选法，**行使授权反驳**，但必须给出 CE 文件:行号。

---

## 2. 真回归（必须修）：生成期性能

### 证据

| 口径 | 耗时 |
|---|---|
| 改动前·**全套并行门禁** | 411 s |
| 改动后·`armor_model_effect.test.ts` **单文件独跑** | **838 s** |

该文件的聚合用例自带 `{ timeout: 360_000 }`，838 s 远超，**独跑也失败**。这排除了"并行争抢导致"的解释 —— 是真回归。

门禁里这一批报 `Error: STACK_TRACE_ERROR` 的文件，都是同一个超时在不同文件上的投影：

```
armor_model_effect, b_4b_item_placement, c_1_room_profile, c_4a_0_layer_model,
c_4a_terrain_catalog, c_8_connectivity, horde_terrain_spawn,
invented_content_pool, monster_stats_effect, p1_26_invariants,
p1_37_machine_flag_i18n
```

**不要**逐个去调这些文件的 `timeout` 数字把它们"改绿"。那是把温度计砸了。要找的是生成变慢的成因。

### 已知的合理成因与已排除项

- V-2a 恢复了前厅/外包内容物，生成期**本来就会变重**，一定幅度的变慢是预期的。
- 上轮加的两个缓存正是为此（头注记了 seed31337/D2 554s → 消除嵌套重试的全图重算）。**缓存要保留。**
- 但 411 s（全套）→ 838 s（单文件）这个量级不是"内容变多"能解释的，怀疑是**递归外包路径上的重试放大**：`MF_OUTSOURCE_ITEM_TO_MACHINE` 让子机器建造进入递归，若失败重试在父/子两层相乘，就是平方级。请从这里查起。

### 要求

- 定位放大点，给出**改前/改后的实测秒数**（同一 seed、同一文件），不要只说"优化了"。
- 性能修复**不得改变 RNG 消耗序列**。若某个改法会动掷骰次数，停下来，在报告里写明取舍，不要擅自接受基线分叉。

---

## 3. 基线重捕获（在 1、2 都修完之后做，不要提前）

`generation_baseline.test.ts` 报 `生成结果偏离基线 60 处`。V-2a 本就有意改变生成（前厅真建起来了），基线**应当**重捕获 —— 上轮大概率是在半成品状态下捕的，所以现在对不上。

**顺序要求**：必须等第 1、2 节改完、其余门禁项全绿之后，**最后一步**才重捕获 `src/test/fixtures/generation_baseline.json`。提前捕获会把缺陷态固化进基线。

重捕获后在报告里写明：60 处偏离中，有多少条在修完 center 缺陷后自行消失、剩下多少是前厅内容物带来的**预期**变化。

---

## 4. 一处文档订正（顺手做掉）

`BlueprintEngine.ts:264` 处 `gateCandidatesCache` 的头注写着"失效时机与 gateAnalysisCache 一致"，但实际两者**故意**不在同一处失效（候选缓存在 671 行 `applyBlueprint` 内清、分析缓存在 894 行方法尾部清），而 671 行的行内注释已经把"为什么必须不一致"讲清楚了（chokeMap 是地形派生物，CE Architect.c:1063-1101 每层预计算；提前失效会让子机器分析耦合进父机器地形）。

把 264 头注那句"一致"改成与 671 行一致的表述。**只改注释**，不要动失效时机本身。

---

## 5. 授权改动清单

以下之外的文件一律不许动：

**引擎**
- `src/engine/Generator/BlueprintEngine.ts`

**测试与固件**
- `src/test/fixtures/generation_baseline.json`（仅第 3 节的最后一步）
- `src/test/blueprint_center.test.ts`
- `src/test/p1_33_machine_chokepoint.test.ts`
- `src/test/v_2a_vestibule_return.test.ts`
- `src/test/p1_20_item_placement.test.ts`
- `src/test/p1_31_35_placement_snapshot.test.ts`
- `src/test/v_1a_blueprint_items.test.ts`
- `src/test/v_1c_machine_structure.test.ts`

上面这 6 个测试文件里，`blueprint_center` 和 `p1_33` 在缺陷修好后**应当自行转绿，不需要改**；列进来是因为它们钉了 center 契约，万一契约措辞要跟着调整。其余四个钉了 vestibule 主题，同理。

**守卫顺延不放宽**：任何一个守卫因本轮改动而撞断，把期望值**顺着实测挪**，绝不放宽成 `toBeGreaterThan` 之类。放宽即视为本轮失败。

**只读，动一下就算越界**
- `BrogueCE-master/`（全部，含 `src/`、`bin/assets/`）
- `src/data/blueprints.json`（第 1 节若确需改 roomSize，**先在报告里申请**，本轮不要自行改）

---

## 6. 本轮明确不做

- 蓝图全目录扩充（web 20 → CE ~69）—— 那是 V-2b
- `MF_KEY_DISPOSABLE` 的引擎消费 —— 独立的钥匙轮
- `BP_TREAT_AS_BLOCKING` / `BP_REQUIRE_BLOCKING` 在 `fillVestibuleInterior` 里的复核接线 —— 上轮已登记为挂起项（见该函数尾部注释），激活轮再做
- 给超时测试调大 `timeout` 数字来充当"修复"

---

## 7. 授权反驳

以上任何一条事实判断，若你在 CE 源码里读到相反的证据，**你有权也有义务驳回并纠正**，不要为了顺从而实现一个错的东西。驳回时必须给出 `BrogueCE-master/src/...` 的文件:行号。这一条在历次轮次里多次拦下过验收方的错误判断，认真用。

特别是第 1 节那条"origin 恒在 cells 内"—— 验收方是从 CE 的 `distanceMap[origin]=0` + `k=0` 起始推出来的。若你发现某条路径下 origin 会被排除（例如 cost 被判 forbidden 且 dijkstra 覆写了 dist），立刻指出。

---

## 8. 门禁与报告

**门禁跑法（照抄，不要改）：**

```
npx vitest run
npm run build
```

- `npx vitest run` 是**并行**的（约 411 s 基准）。不要加 `--fileParallelism=false`：串行会复用单 worker，反而制造跨文件的模块单例污染。
- 类型门禁用 `npm run build`（vue-tsc -b 会套用 `tsconfig.app.json` 的 `noUnusedLocals`），**不要**用 `npx tsc --noEmit`，它漏未使用变量。
- 失败清单**完整输出**，不要 `| tail`。

**报告**写到 `ai_docs/reports/v-2a-finish.report.md`，含：

1. 第 1 节的修法与 CE 依据（文件:行号）
2. 第 2 节的放大点定位 + 改前/改后实测秒数
3. 第 3 节：60 处偏离的成因拆分（自愈 vs 预期变化）
4. 门禁两条命令的完整输出结尾（文件数 / passed / failed）
5. 任何你行使授权反驳的地方
