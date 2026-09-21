# V-2b-9a 补完轮

> **在分支 `round/v-2b-9a` 上执行**。产物完好，接着往下做。

## 0. 产物完好 + 一条必须先读的流程教训

上一轮的交付在 `round/v-2b-9a` 分支的 WIP 提交里，**不要推倒重来**。已完成：
13 个地形载体（含 **RUBBLE**）+ 8 条 DF + 闭包展开，以及 `c_4b` / `c_7` / `r_1`
三张穷举表的更新。

**基线自检通过**——验收方独立复跑 `npm run test:drift` 得 1/1 绿，
证实新载体确实没有移动生成流，本轮拆分的前提成立。

### ⚠️ 上一轮报告里有一句话与事实不符

报告 §7 写：「已跑 §4 授权测试清单的**全部文件** …… 全部通过。未跑文件：无。」

**但验收方本地全量门禁跑出 11 条失败**，其中 `c_4a_terrain_catalog.test.ts`
与 `c_4a_0_layer_model.test.ts` **在 diff 里根本没被改动过**——而它们的计数断言
写死为 `103`（V-2b-8 的值），本轮新增 12 个成员后必然红。

最可能的成因**不是谎报，而是时序**：在加完全部载体**之前**跑过一次、当时是绿的，
之后没有复跑。

**本轮据此加一条硬要求，见 §3。**

## 1. 要修的 11 条

### A 类：穷举表计数没跟上（4 条）——机械

```
c_4a_terrain_catalog  全 TerrainType 键覆盖         expected 115 to be 103
r_1_appearance        穷举表覆盖全部成员             expected 115 to be 103
c_4a_0_layer_model    归属表与 drawPriority 全等表   …(112) vs …
c_4b E2               闭包自洽                       Array(128) vs Array(131)
```
`c_4a_terrain_catalog` 的那处在**第 167 行** `expect(names.length).toBe(103)`，
上方注释记录了 82→101→103 的沿革，**照格式补一行 V-2b-9a 的 103→115 并说明新增了哪些**。
`c_4b` E2 是闭包集合差 3，查是哪三条。

### B 类：新地形的可通行性（2 条）——判断题

```
c_4a_terrain_catalog  terrainAllowsMove ≡ 旧排除清单   MUD_WALL: expected false to be true
c_4a_terrain_catalog  Game.canMoveTo ≡ 旧清单          MUD_WALL: expected false to be true
```
**回 CE 查 `MUD_WALL` 的 `T_OBSTRUCTS_PASSABILITY`**，按 CE 事实决定进不进排除清单，
给 `Globals.c` 行号。同批新地形里还有没有同类的（`LAVA_RETRACTABLE`、
`ELECTRIC_CRYSTAL_OFF` 等）——**一并核对，别等下一轮再撞**。

### C 类：DF 目录的"未登记 id"合同（4 条）——需要判断

```
c_4b E5    未抄录 id 的查询得到 undefined   expected [Function] to throw /未抄录/ but got 'DF#21…'
g_2        DF#159 不得提前入目录            expected {id:159, ceLine:828, …} to be undefined
g_2        DF_EXPLOSION_FIRE 已接线         …(47) to have a length
v_2b_3     有载体的链环 tile 对位            …(47) to have a length
v_2b_5     A3 DF_MISSING_TILES              …(47) to have a length
```

后三条是同一个 `DF_MISSING_TILES` 长度守卫在三处的镜像——RUBBLE 落地后，
原先"缺 tile"的若干条 DF 现在有 tile 了，名单缩短。**这是本轮的预期效果**
（V-2b-5 登记的堵点被解开），把三处同步。

前两条更要小心：`c_4b` E5 与 `g_2` 的 "DF#159 不得提前入目录" 是**边界守卫**
——它们钉的是"没被授权抄录的 DF 不许出现在目录里"。本轮抄录闭包链时可能
**顺带把授权外的条目也抄进来了**。逐个核：DF#21x / DF#159 是不是本轮闭包的
合法成员？若不是，**从目录里撤掉**，不要改守卫。

## 2. 基线

本轮仍**不许重捕获** `generation_baseline.json`。修完后 `npm run test:drift`
必须仍绿——若它红了，说明 §1 的某处修复动到了生成流，停下来查。

## 3. 硬要求：最终复跑（堵上 §0 那个洞）

**在所有编辑完成之后**，重新跑一遍授权清单的全部文件，并在报告里：

- 给出这次**最终复跑**的时间点（相对你的工作流，例如"最后一次编辑之后"）；
- 逐文件列出结果；
- **明确声明"这是最终状态下的运行结果，不是中途快照"**。

中途跑过多少次都不算数——**只认最后一次**。这一条不满足，本轮判为未完成。

## 4. 授权改动清单

沿用 `v-2b-9a.prompt.md` §4，**再加**本轮 11 条涉及的：
`src/test/c_4a_terrain_catalog.test.ts`、`src/test/c_4a_0_layer_model.test.ts`、
`src/test/v_2b_3_wired.test.ts`、`src/test/v_2b_5_dormant.test.ts`

**仍然不许改**：`src/data/blueprints.json`、`src/test/fixtures/generation_baseline.json`

清单外改动必须申报。`BrogueCE-master/` 只读。**守卫顺延不放宽**——
特别是 §1 C 类前两条，那是边界守卫，撤目录条目而不是改守卫。

## 5. 门禁跑法

跑 §4 授权清单的**全部文件** + `npm run test:drift` + `npm run build`。
**不要**跑不带文件参数的全量 `npx vitest run`。
装不下就在报告里列出没跑到的——但 §3 的最终复跑是硬要求。

## 6. 报告

写到 `ai_docs/reports/v-2b-9a-finish.report.md`，含：

1. 11 条逐条：成因 → 处置 → 依据（CE 行号或实测）
2. **§1 B 类的 CE 判定**（含"同批还有没有同类"的核对结果）
3. **§1 C 类前两条：DF#21x / DF#159 是不是合法闭包成员**，处置是撤条目还是别的
4. §2 基线自检
5. **§3 的最终复跑声明**（时间点 + 逐文件结果 + "这是最终状态"）
6. 授权反驳
