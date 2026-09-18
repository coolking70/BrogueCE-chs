# R-1 结案报告：渲染纯重构轮（格子→外观纯函数）

日期：2026-09-18 ｜ 分支：`round/r-1` ｜ 状态：**完成，两项门禁全绿**

---

## 对任务书的反驳

任务书的事实锚点**全部核对无误**，无需行使授权反驳条款：

| 任务书断言 | 实际核对 | 结论 |
|---|---|---|
| `GameCanvas.vue` 769 行 | `wc -l` = 769 | ✅ |
| `:126` `getTerrainVisual(terrain, isVisible)` | 126 行起，签名一致 | ✅ |
| `:341` 起 `render()` 约 220 行 | 341–563 行，223 行 | ✅ |
| `:447` `placeEntity(...)` 绘制原语 | 447 行起 | ✅ |
| `TerrainType` 当前 **47 个**成员 | 枚举逐一数（NOTHING…SACRED_GLYPH）= 47 | ✅ |
| 幻觉走 COSMETIC 流、p2_0 已钉 | `GameCanvas.vue:17-33`、`p2_0_seeded_rng.test.ts` | ✅ |

一处**补充说明**（非反驳）：任务书 §3 说"若你认为别的路径更合理，说明理由"——
`src/engine/UI/Appearance.ts` 是合理落点（与本就存在的 UI 概念同域），已沿用。

另有一处任务书**未写明但重构中发现**的事实，见 §遗留与登记 第 7 条
（`render()` 里 `telepathyRevealed` 原来在怪循环内**逐怪重算**，重构后提到帧级一次，值不变）。

---

## 抽出的接口

新文件 `src/engine/UI/Appearance.ts`（339 行），全部为纯函数：**不 import 全局 `game`/`activeGame`**（结构守卫钉死），一切输入经参数注入。

```ts
// ① 地形基础外观（由 getTerrainVisual 逐字迁入）
function terrainAppearance(terrain: TerrainType, isVisible: boolean): TerrainVisual
//    TerrainVisual = { char: string; color: string; bgColor: number | null }

// ② 一个格子最终画成什么（null = 未探索且不可见，不画）
function cellAppearance(cell: Cell, ctx: CellAppearanceContext): TerrainVisual | null

// ③ 实体（物品/怪物/玩家）画成什么（null = 不画）
//    统一入口 + 三个具体函数（render 循环直调具体函数，省去逐帧判别）
function entityAppearance(entity: Item | Monster | Player, ctx: EntityAppearanceContext): EntityVisual | null
function itemAppearance(item: Item, ctx: EntityAppearanceContext): EntityVisual | null
function monsterAppearance(monster: Monster, ctx: EntityAppearanceContext): EntityVisual | null
function playerAppearance(player: Player): EntityVisual
//    EntityVisual = { char: string; color: string | number; interactive: boolean }
```

**`ctx` 字段及理由**（字段集 = 重构前 `render()` 实际读取的全局态，一个不多一个不少）：

| 字段 | 出处（重构前） | 为什么在 ctx 里 |
|---|---|---|
| `CellAppearanceContext.gas` | `game.environment.gasGrid[x]?.[y]` | 气体覆盖（POISON/STEAM/CONFUSION/CREEPING_DEATH 四分支）。**该格**的快照，由渲染层取出传入，纯函数不接触 EnvironmentManager |
| `CellAppearanceContext.light` | `game.lightMap.getLight(x, y)` | 光照混合（0.8/0.5 比例）与"可见但无光=近黑"分支 |
| `EntityAppearanceContext.cellVisible / cellHasMemory` | `game.grid.getCell(entity.loc)` 的两个标志 | 物品/怪物的可见态与记忆残像判定；渲染层查格后传布尔，纯函数不接触 Grid |
| `EntityAppearanceContext.telepathy` | `game.player.statusDurations.telepathy` | 心灵感应剪影（#66ccff） |
| 两处 `.hallucinating` | `game.player.statusDurations.hallucinating` | 幻觉覆盖 |
| 两处 `.cosmetic` | `cosmeticPercent` / `cosmeticPick`（GameCanvas 模块块，COSMETIC 流） | 幻觉掷骰**注入**而非内部调用全局 rng——保持纯度且不污染玩法流（p2_0 的既有保证不破） |

**掷骰时序是接口契约的一部分**：幻觉的 percent/pick 调用次数与顺序（瓦片 `percent(15)→pick色→pick字`、物品**两次独立** `percent(30)`、怪物 `percent(35)→pick色→pick字`）逐字保留，测试用记录型假随机钉死了调用序列（见测试「幻觉双掷怪癖」组）。

---

## 行为逐位不变的证据

1. **特征化表规模**：
   - `terrainAppearance`：**47 成员 × 2 可见态 = 94 条全等断言**（`Record<TerrainType,…>` 期望表，编译期强制穷举 + 运行期成员计数 = 47 断言）。不可见态按原实现的统一变暗规则（`#333333` / `0x111111`）逐成员钉死。
   - `cellAppearance`：未探索/可见/记忆三态 + 燃烧 + 四种气体 + PARALYSIS 无分支 + 幻觉命中/不命中 + 无光压暗 + 光照混合（含具体值锚点 `#cccccc`/`0x595966` 等）共 19 条用例。
   - `entityAppearance`：物品 7 条（含幻觉双掷的 [中,中]/[中,不中]/[不中,中] 三种组合）、怪物 8 条、玩家/分流 3 条。
   - 合计 **42 条用例**，全部不依赖真实 rng、不依赖游戏实例，`5ms` 跑完。
2. **搬运方式**：`terrainAppearance` 与 `cellAppearance` 的决策体为**逐字搬运**（含原注释），仅把 `game.*` 读取替换为 ctx 字段；三条反向验证证明测试真的咬得住输出。
3. **事件序保持**：逐帧的 cosmetic 掷骰序列在重构前后逐调用一致（瓦片循环 → 物品循环 → 怪物循环的顺序、每处调用的参数与先后均未动）；`getLight`/`gasGrid` 读取原本只在可见格发生、重构后对全部未跳过格发生——两者均为纯读（`LightMap.getLight` = 越界检查 + 数组读，`gasGrid` 为镜像数组读），无可观察差异。
4. **全量门禁**：85 个测试文件、1094 用例全绿（含所有既有渲染/RNG/动画测试：p2_0、p2_4、p2_6、c_7 等，它们 import 的 `cosmeticPercent`/`cosmeticPick`/`computeMapLayout` 导出原样保留）。

---

## 改动清单

```
 brogue-web/src/components/GameCanvas.vue | 209 +++++++------------------------
 1 file changed, 42 insertions(+), 167 deletions(-)
```

- `src/components/GameCanvas.vue`（769 → 644 行）：删除 `getTerrainVisual` 与 render 内的全部外观决策（燃烧/气体/光照/幻觉/记忆、物品/怪物/玩家的字形颜色逻辑、幻觉调色板）；render 改为「取格 → 调外观纯函数 → 绘制」。删除不再使用的 import（`TerrainType`/`GasType`/`ColorUtils`/`MonsterState`）。**保留**全部既有模块级导出（`TILE_SIZE`/`cosmeticPercent`/`cosmeticPick`/`computeMapLayout`/`computeMapOffset`——p2_0/p2_4/p2_6 依赖）。
- `src/engine/UI/Appearance.ts`（新建，339 行）：上述三个纯函数 + 类型 + 幻觉调色板常量。
- `src/test/r_1_appearance.test.ts`（新建，545 行，42 用例）：特征化 + 结构守卫。
- 引擎/生成侧**零改动**（`git status` 仅上述三文件；`generation_baseline` 随全量通过，fixture 未动）。

---

## 对抗性测试与反向验证

三条均"真的改坏 → 跑 → 贴真实失败输出 → 还原"；还原后 `grep -rn "REVERT-ME" src/` = **0**，单文件复跑 42/42 绿。

### ① 改坏地形 bgColor（FLOOR 0x222233 → 0x222234）→ 穷举表红

```
FAIL ... > R-1 terrainAppearance 特征化（穷举钉死） > 可见态：每个成员的 {char, color, bgColor} 全等钉死
AssertionError: TerrainType[2] 可见态: expected … to deeply equal …
- Expected: "bgColor": 2236979      (+ Received: "bgColor": 2236980)
      Tests  1 failed | 41 skipped (42)
```

### ② 删掉记忆态变暗分支 → 楼梯记忆断言红

```
FAIL ... > 记忆态楼梯保持明亮（#ffffff / 0x222222）——原实现的楼梯特例
AssertionError: expected { char: '>', color: '#333333', …(1) } to deeply equal { char: '>', color: '#ffffff', …(1) }
- Expected: "bgColor": 2236962, "color": "#ffffff"
+ Received: "bgColor": 1118481, "color": "#333333"
```

（普通地形的记忆断言在 ② 下保持绿——它们的变暗由 `terrainAppearance` 兜底，**楼梯特例才是判别位**；这正是把三态分开测的价值。）

### ③ 往 GameCanvas.vue 塞颜色字面量 switch → 结构守卫双红

```
FAIL ... > 颜色字面量多重集 == 豁免清单（逐条有理由，新增即红）
AssertionError: expected [ '#000000', '#ffff00', …(5) ] to deeply equal [ '#000000', '#ffff00', …(4) ]
@@ -3,6 +3,7 @@    "0x999999",

FAIL ... > 没有字形字面量的 switch/case 分支（terrain 决策 switch 已迁出）
AssertionError: expected 1 to be +0   （/case '/ 计数）
```

### 结构守卫的豁免清单（逐条理由，写在测试内，新增即红）

| 字面量 | 次数 | 豁免理由 |
|---|---|---|
| `0x111111` | 1 | Pixi Application **画布清屏色**（整幅画布的底，不是任何一格的颜色） |
| `'#ffffff'` | 2 | Text sprite 与浮字的**初始 fill**（中性占位，每帧被 `visual.color`/`ft.color` 覆盖） |
| `'#ffff00'` | 2 | 箭矢投射物 sprite 初始 fill 与 dropShadow（每帧被 boltFrame 颜色覆盖） |
| `'#000000'` | 1 | 浮字描边底色（绘制原语的静态样式） |

其余守卫：`case '` 计数=0；`getTerrainVisual`/`TerrainType`/`GasType`/`MonsterState`/`ColorUtils` 在 script 区零引用；setup 区禁止直接调用 `cosmeticPercent(`/`cosmeticPick(`（只能经 ctx 注入）；四个外观函数调用点与 import 必须在；setup 区禁止 `char = '…'` 形态的字形赋值与 `♠/§/⊙` 字形；`Appearance.ts` 禁止 import 全局游戏单例。

---

## 需要追加授权的测试

**无。** 四段 grep 自查（主题 / 结构性穷举表 / 公共目录标识符 / 扫描器代码形态）后，全量门禁中清单外测试零撞红。本轮**没有**往任何公共目录加条目、没有删任何公开符号、`GameCanvas.vue` 的既有导出全部保留，因此既有主题测试无一受扰。

---

## 门禁结果

### `npx vitest run --fileParallelism=false`（不带文件参数，全量单 worker）

```
 Test Files  85 passed (85)
      Tests  1094 passed | 8 skipped | 5 todo (1107)
   Start at  08:43:20
   Duration  1691.08s (transform 1.13s, setup 0ms, import 13.15s, tests 1667.72s, environment 15ms)
```

（时长偏长系 T-1 轮并行抢 CPU 所致，无翻红，无需单独重跑。）

### `npm run build`（vue-tsc -b + vite build）

```
✓ built in 2.10s
build exit: 0
```

期间 build 门禁真实咬过一次：`src/test/r_1_appearance.test.ts(29,27): error TS6133: 'RGBA' is declared but its value is never read.`——已删该未用导入后复跑通过。（旁证任务书 §7 的警告：`tsc --noEmit` 不应用 `noUnusedLocals`，门禁必须走 `npm run build`。）

chunk >500 kB 警告为既有现象，与本轮无关。

---

## 遗留与登记（六条 UI 欠账的落点——本轮的主要交付物）

重构后每条欠账都有了**能写出可证伪断言的函数缝**。下一轮 UI-1 按下表落点补：

| # | 欠账 | 现状锚点（重构前位置 → 现位置） | UI-1 落点 |
|---|---|---|---|
| 1 | **EMBERS / ASH / PLAIN_FIRE 无渲染** | 原 `getTerrainVisual` 无 case → `terrainAppearance` 的 default 分支（`Appearance.ts`）。特征化表里三者已钉死为 `DEFAULT_LOOK`，且 `FIRE_TERRAIN_TYPES`（Grid.ts:363）可直接枚举载体 | `terrainAppearance` 加三个 case + `r_1_appearance.test.ts` 的 `EXPECTED_VISIBLE` 表对应行改值（表会编译期强制提醒）。注意 PLAIN_FIRE 现被 `cellAppearance` 的燃烧分支盖成 `*`，加 case 时两处交互要一起断言 |
| 2 | **燃烧的怪物身上无视觉** | 原 render 怪循环只按盟友/睡眠变色 → `monsterAppearance`（`Appearance.ts`）。函数当前只读 `hp/isAlly/state/char/color` | `monsterAppearance` 加 burning 判定。需要给 `EntityAppearanceContext` 增加输入（如 `burning: boolean`，渲染层从格子的 `isBurning` 取）——ctx 加字段是本轮设计的预期扩展点 |
| 3 | **探魔（心灵感应）只有剪影、无地面符号** | 原 render `#66ccff` 分支 → `monsterAppearance` 的 telepathy 分支 | 剪影样式在 `monsterAppearance`；"地面符号"（CE 的嗅探点标记）属格子层 → `cellAppearance` + ctx 加 `telepathy` 输入 |
| 4 | **PARALYSIS / METHANE 气体无渲染分支**（重构中新确认，任务书六条之外） | 原 render 气体只认四种 → `cellAppearance` 气体段。测试已钉死 PARALYSIS 无分支的现状（「勿当回归修」用例） | `cellAppearance` 气体段加分支；翻掉那条"无分支"特征化用例时注明激活轮次（留痕反转惯例） |
| 5 | **`onConfirmRequest` 未接线** | `Game.ts:408` 定义钩子、`:6603` 消费；生产侧**无任何组件赋值**（仅 c_5 测试在用），headless 按"确认"处理 | 不属 Appearance——UI 组件层（App.vue 或 GameCanvas 挂载段）赋一个确认弹窗回调。落点在 `onMounted` 的接线区，与外观函数无关 |
| 6 | **裸键名** | i18n 层问题（`Game.ts` 大量 `i18next.t(..., { defaultValue })` 调用点），不落在 Appearance.ts | i18n/文案轮处理：`zh_CN.json` 补键 + `p1_30` 门禁跑一遍；与渲染纯函数无关 |
| 7 | **C-7 光照渲染升级** | `cellAppearance` 光照段保留了原实现的自我声明："Brogue uses a complex multiply/add system. Here we'll do a simple proportion mix"（乘 0.8/0.5） | `cellAppearance` 光照段换成 CE 的 multiply/add 混合（Light.c），特征化表的光照锚点值（`#cccccc`/`0x595966`/`#ffeecc` 等）同步翻新 |

**给 UI-1 的两条操作提醒**：

1. 改 `EXPECTED_VISIBLE` 表或 ctx 字段时，`src/test/r_1_appearance.test.ts` 在你的"允许修改"清单里要按条目写明（结构性穷举表 + 留痕反转，两类历史冲突高发）。
2. `cellAppearance` 的输出宽度仍是 79×19 全格遍历——若 UI-1 加逐格开销大的计算（如新光照模型），注意 p2_4 的动画节奏测试对帧耗时的既有约束。

**结构性不可达激活提示**：本轮无留形死分支（全部函数可达、已测），无"激活轮需重核"项。
