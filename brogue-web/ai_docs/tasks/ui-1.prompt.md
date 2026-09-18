# UI-1：七条渲染欠账（与 C-8 并行，**渲染层，零生成期改动**）

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错事实**。
凡引用的 CE 行号/语义都**必须打开 `BrogueCE-master/` 逐字核对**，
冲突时**以 CE 源码为准**，并在 `## 对任务书的反驳` 一节写明。

⚠️ **本轮的事实清单已经过三方核对**（验收方起草 → 第三方模型独立核对 →
验收方回源码复验），见路线图「UI-1 事实清单」九条。
**但这不免除你的核对义务** —— 三方核对过的清单里，
原本就有**三条是验收方写错、被第三方揪出来的**。照样自己验。

## 1. 前置已就位

**R-1 已落地**（`44e73b1`）：`src/engine/UI/Appearance.ts` 抽出了三个零全局依赖的纯函数：

```ts
terrainAppearance(terrain, isVisible)      // 地形外观
cellAppearance(cell, ctx)                  // 一个格子最终画成什么；null = 未探索且不可见
entityAppearance(entity, ctx)              // 怪物/物品/玩家（另有 item/monster/player 三个具体函数）
```

`ctx` 是**显式输入对象**，**新增 ctx 字段是预期的扩展点**。
`r_1_appearance.test.ts` 有 42 条特征化用例（含 `TerrainType` 47 成员 × 2 态的
**编译期强制穷举表**）—— **改了外观就会撞红那张表，这是设计如此**，
按「留痕反转」惯例更新它，不要绕过。

R-1 还留了一条**结构守卫**：`GameCanvas.vue` 里不得出现颜色/字形字面量的决策分支
（只有 6 项逐条注明理由的豁免）。**本轮新增的外观决策一律写进 `Appearance.ts`**，
往 SFC 里塞就会被守卫抓住。

## 2. 七条欠账与落点（R-1 逐条登记）

| # | 欠账 | 落点 |
|---|---|---|
| 1 | `EMBERS`/`ASH`/`PLAIN_FIRE` 无渲染 | `terrainAppearance` 加 case + 穷举表同步 |
| 2 | 燃烧在怪物身上无视觉 | `monsterAppearance` + `ctx` 加 `burning` |
| 3 | 探魔无地面符号 | `cellAppearance` + `ctx` 加探测态 |
| 4 | `PARALYSIS`/`METHANE` 气体无渲染 | `cellAppearance` 气体段 |
| 5 | `explosion_immunity` 侧栏显示裸键名 | **见 §3.1——处置方向与原登记相反** |
| 6 | `onConfirmRequest` 未接线 | UI 组件层（`Game.ts:408` 有定义，生产侧**零组件接线**，R-1 已核实） |
| 7 | C-7 光照未升级 | `cellAppearance` 光照段：0.8/0.5 简单混合 → CE 的 multiply/add |

## 3. 已核实的 CE 事实（**仍须自验**）

### 3.1 ⚠️ 第 5 条的方向是反的

CE 的状态名表给 `STATUS_EXPLOSION_IMMUNITY` 的显示名是 **空字符串 `""`**
—— **CE 有意不显示这个状态**。同表里 `STATUS_NUTRITION` / `STATUS_ENTERS_LEVEL_IN` /
`STATUS_ENRAGED` 也是空名。

所以**正确处置是"不显示"，不是"补一个中文标签"**（路线图 P1-47 的原登记是错的）。
请核对该表并按 CE 处置；顺带检查 web 是否还有别的"CE 空名但 web 在显示"的状态。

### 3.2 ⚠️ 状态表的列语义

CE 的 `statusEffect` 结构体（`Rogue.h:2022-2025`）是
`{char name[COLS]; boolean isNegatable; int playerNegatedValue;}`。
**第二列是「可否被驱散」，不是「是否有益」。**
若 web 的 `STATUS_CONFIG` 按"有益/有害"给状态上色，**别拿 CE 的第二列当依据**。

### 3.3 ⚠️ 探魔符号的条件是**析取**，两支各有不同的可见性守卫

CE `IO.c:1219-1236`：

```c
} else if (((HAS_ITEM && ITEM_DETECTED && itemMagicPolarity(theItem)
             && !playerCanSeeOrSense(loc))          // 左支：看不见【格子】
            || monsterWithDetectedItem){             // 右支：自带 !canSeeMonster（看不见【怪物】）
```

`monsterWithDetectedItem` 的定义在 `IO.c:1120-1121`，含 `!canSeeMonster(monst)`。
**两个守卫针对的对象不同，不要合并。**
polarity `-1` → `G_BAD_MAGIC`（`badMessageColor`）、`+1` → `G_GOOD_MAGIC`（`goodMessageColor`）、
`AMULET` 特例 → `G_AMULET`（white）、polarity `0` → `cellChar = 0`。

**分支顺序**（`IO.c:1215-1245`）：`HAS_PLAYER` → 探测物品 → `HAS_MONSTER`。
即**携带已探测魔法物品且看不见的怪物，该格画魔法符号而不是怪物**。

### 3.4 火焰三态

`ASH` 与 `EMBERS` **同字形 `G_ASHES`**，靠前景色区分
（`ashForeColor` / `fireForeColor`）；`PLAIN_FIRE` 用 `G_FIRE`。
`drawPriority` **数值越小越优先**（`Rogue.h:1910` 原注释
*"lower number means higher priority"*）：PLAIN_FIRE(10) > EMBERS(70) > ASH(80)。
`TM_VISUALLY_DISTINCT` **只有 PLAIN_FIRE 有**。

### 3.5 燃烧是**发光**，不是改字形

CE `Light.c:250`：`if (monst->status[STATUS_BURNING] && !(monst->info.flags & MONST_FIERY))`
→ `paintLight(BURNING_CREATURE_LIGHT)`。
**不是改字形或颜色**，且 `MONST_FIERY` 的怪物**不叠加**此光。
web 若无法在渲染层表达"发光"，**登记 deferral 并说明**，
**不要自创一个 CE 没有的"燃烧染色"** —— 用户裁决是
「优先还原 CE 的逻辑结构，避免原创差异引起后续连锁反应」。

### 3.6 确认框

CE `IO.c:2946-2975`：**Enter = Yes**（`buttons[0].hotkey[2] = RETURN_KEY`）、
**Esc = No**、`ACKNOWLEDGE_KEY` 也映射到 No；`retVal` 非 -1 非 1 一律返回 true。
（交接文档旧记载"CE 默认拒绝"**是错的**，已订正。）

## 4. 绝对禁止

- **不得修改 `BrogueCE-master/`**（只读参考，D6）。
- **不得触碰生成期任何代码**，**不得重新捕获 `generation_baseline`**。
  ⚠️ 本轮与 **C-8（生成器连通性修复）并行**，C-8 活动在
  `src/engine/Generator/` 与 `src/engine/Map/`。**严格待在渲染/状态/i18n 层内。**
  `generation_baseline` 保持绿且 fixture 未动 = 你没越界的证据。
- **不得往 `GameCanvas.vue` 里塞外观决策**（R-1 的结构守卫会抓）。
- 不得为了让测试变绿而放宽断言；穷举表按「留痕反转」更新，不是绕过。

## 5. 允许修改的文件

**先按四段 grep 自查**（`project_conventions.md`）。

**生产代码：**
- `src/engine/UI/Appearance.ts`
- `src/engine/Status/statusConfig.ts`
- `src/components/GameCanvas.vue`（**仅**绘制接线与 ctx 取值，不得含外观决策）
- `src/components/App.vue` 或等价挂载点（第 6 条 `onConfirmRequest`）
- `src/engine/Map/LightCatalog.ts`（**仅当**第 7 条需要，且**不得改生成期用法**）
- `src/locales/**`

**测试：**
- `src/test/r_1_appearance.test.ts`（穷举表与 ctx 扩展，**反转不放宽**）
- `src/test/p1_30_i18n_gate.test.ts`
- `src/test/c_7_lighting.test.ts`（第 7 条）
- 新建 `src/test/ui_1_rendering.test.ts`

**清单外撞红：停下，不要改**，写进 `## 需要追加授权的测试`。

## 6. 测试要求

1. 七条**逐条**有断言，且**每条都必须能被某个具体的错误实现打红**。
2. 第 5 条要有**负向断言**：`explosion_immunity` **不出现**在状态栏可见集合里。
3. 第 3 条要**分别**断言两支守卫（看不见格子 / 看不见怪物），以及
   `HAS_MONSTER` 之前的分支顺序。
4. **对抗性测试 ≥ 3 条 + 强制反向验证**：真改坏 → 跑 → **贴真实失败输出**
   → 还原 → `grep -rn "REVERT-ME" src/` = 0。
5. 新哨兵不得锚定 RNG 流绝对位置（本轮本就不该碰 RNG）。

## 7. 门禁

`npx vitest run --fileParallelism=false`（不带文件参数）
**外加 `npm run build`**（不要用 `tsc --noEmit`）。

⚠️ C-8 并行跑着会抢 CPU：**重型测试翻红时先单独重跑该文件**再下结论。

## 8. 最终回复必须包含

1. `## 对任务书的反驳`
2. `## 七条逐条落地情况`（含任何 deferral 及其理由）
3. `## 改动清单`
4. `## 对抗性测试与反向验证`（含**真实失败输出**）
5. `## 需要追加授权的测试`
6. `## 门禁结果`（含 `generation_baseline` 绿且 fixture 未动的证据）
7. `## 遗留与登记`
