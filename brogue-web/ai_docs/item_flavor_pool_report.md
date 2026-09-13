# 修复报告：未鉴定物品外观池容量不足（item flavor pool）

日期：2026-09-14
改动范围：`src/engine/Items/ItemLoader.ts`（唯一修改文件）、新增 `src/engine/Items/itemFlavors.test.ts`、本报告。

## 1. 缺陷与修法概述

`ItemLoader.initConsumables()` 为每类未鉴定物品从固定池中洗牌分配外观。
原池大小（药水 8 / 卷轴 8 / 魔杖 6 / 法杖 6 / 戒指 6 / 护符 6）小于或接近物品种类数
（16 / 14 / 7 / 7 / 6 / 6），且分配循环带 `if (index < shuffled.length)` 静默跳过——
8 种药水、6 种卷轴、1 魔杖、1 法杖永远无外观，显示 "Unknown"。

本轮修复：

1. 五类池按 CE 词表扩充（见 §3、§4），卷轴改为 CE 式词素程序化拼装（见 §5）；
2. 静默跳过改为 `console.error` 明确报错（见 §6）；
3. 新增验收测试 `itemFlavors.test.ts`（5 项：池容量、池内无重复、固定 seed 双射、
   zh_CN 下全中文显示、不同 seed 分配不同），全部通过。

## 2. 验收结果

### npm test（尾部，exit=0）

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  18 passed (18)
      Tests  145 passed | 1 expected fail | 7 todo (153)
   Start at  04:41:41
   Duration  2.99s (transform 1.21s, setup 0ms, import 2.14s, tests 8.73s, environment 4ms)
```

145 passed = 原有 140（无减少）+ 新增 5。`1 expected fail` 是仓库中本就用
`expect().fail()` 标注的占位用例；`7 todo` 亦为既有。

### npm run build（尾部，exit=0）

```
dist/assets/CanvasRenderer-d2N6OXPO.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-BKtQvLvB.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-COvW8P8K.js           41.30 kB │ gzip:  10.82 kB
dist/assets/RenderTargetSystem-CUNV8u85.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-BMwDHZ-V.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-nEqrbYYK.js               877.21 kB │ gzip: 277.04 kB

(!) Some chunks are larger than 500 kB after minification. Consider: …
✓ built in 1.35s
```

（chunk 体积告警为既有状态，非本轮引入。）

### git diff --stat

```
 brogue-web/src/engine/Items/ItemLoader.ts | 207 +++++++++++++++++++++++-------
 1 file changed, 164 insertions(+), 43 deletions(-)
```

新增文件（未跟踪）：`src/engine/Items/itemFlavors.test.ts`、`ai_docs/item_flavor_pool_report.md`。

## 3. 六类外观池扩充前后对照

| 类别 | 物品种类 | CE 池大小（Rogue.h:1071-1077） | 扩充前 | 扩充后 | 说明 |
|---|---|---|---|---|---|
| 药水颜色 | 16 | NUMBER_ITEM_COLORS = 21 | 8 | **27** | CE 21 色，green/blue 与既有条目重复故以既有 8 + 新 19 组成 |
| 卷轴标题 | 14 | NUMBER_ITEM_TITLES = 14（词素 21） | 8 | **21 个词素**（程序化拼装，见 §5） | 标题空间 21³+21⁴ ≈ 21.6 万，远超 14 |
| 魔杖材质 | 7 | NUMBER_ITEM_METALS = 12 | 6 | **17** | CE 12 金属去 copper（既有 Copper Wand）+ 既有 6 |
| 法杖木材 | 7 | NUMBER_ITEM_WOODS = 21 | 6 | **27** | CE 21 木全量 + 既有 6 |
| 戒指宝石 | 6 | NUMBER_ITEM_GEMS = 18 | 6 | **23** | CE 18 石去 agate（既有 Agate Ring）+ 既有 6 |
| 护符 | 6 | CE 无此类别 | 6 | 6 | 恰好够用；不足时新代码会 console.error 兜底 |

每类池均 ≥ 物品种类数，且池内显示名两两不同（测试 1a/1b 断言）；
固定 seed 初始化后六类物品逐一类内双射（测试 2），不同 seed 分配不同（测试 3）。

## 4. 词表来源

- **英文词表**：全部取自 `BrogueCE-master/src/brogue/Globals.c` 的
  `titlePhonemes`（L1455）、`itemColorsRef`（L1481 起）、`itemWoodsRef`（L1507 起）、
  `itemMetalsRef`（L1533 起）、`itemGemsRef`（L1548 起）。
- **中文选词**：该 CE 检出为中文本地化分支，其 `bin/assets/zh_CN.todo.json` /
  `zh_CN.merged.json` 内有词素级官方翻译（如 `"crimson": "深红色"`、`"teak": "柚木"`、
  `"pewter": "白锡"`、`"onyx": "缟玛瑙"`、`"alexandrite": "变石"`），新词条逐词采用之。
  todo 里缺失的常见色词（orange/yellow/pink/gray 等）按同一构词法自行补译
  （橙色/黄色/粉色/灰色…）。
- **药水 hex 颜色**：CE 的外观词只作为名字渲染（紫色高亮文本），地牢里药水颜色
  来自每类药水自己的表色；web 版把颜色并入池条目，故 19 个新色的 hex 为按词义
  自选，全部与既有 8 色及彼此不同（测试 1b 断言 hex 无重复）。
- **既有条目未动**：8 药水 + 6 魔杖 + 6 法杖 + 6 戒指 + 6 护符共 32 条旧词条原样保留
  （仍走 zh_CN.json 的 `name.X` 键翻译）。跨类别的词面呼应（橡木魔杖/橡木法杖、
  翡翠戒指/玉戒指、青色药水/青绿色药水）不违反"同类内双射"，予以保留并在 §8 列出。

## 5. 卷轴标题方案：程序化拼装（与 CE 一致）

**选择**：不扩充固定词表，而是移植 CE 的生成算法——从 21 个中文词素
（`titlePhonemes`，Globals.c L1455，玄妙/天书/灵符/古咒/…/灵魂）里取
3~4 个拼成标题（`Items.c:8851-8856`：`rand_range(3,4)` 个词素），显示格式沿用
现有风格 `题为「玄妙天书灵符」的卷轴`；一局内用 `Set` 去重，撞题则重试
（1000 次上限，理论失败率 ≈ 0，超限抛错）。

**理由**：

1. 与 CE（至少本中文分支）行为逐字对齐，后续任何 CE 对齐核查都能直接比照；
2. 标题空间 21³ ~ 21⁴ ≈ 21.6 万，14 张卷轴每局采 14 个不重复标题绰绰有余，
   以后再加卷轴种类也不会重演"池不够"缺陷（固定词表方案 14 取 14 没有富余）；
3. 每局标题完全不同，正是"未鉴定外观每局随机"玩法的本意。

放弃固定词表方案的原因：14 张卷轴要求词表 ≥14，无富余、未来易复发，
且 2 字标题的词表还得另造一套与 CE 无对应的词。

## 6. 静默跳过改成了什么

`initConsumables` 拆为 `initConsumables` + 私有 `assignAllFlavors` +
`assignArcanaFlavors(pool, flavors, label)`，分配逻辑统一为：

- 分配前检查 `池大小 < 物品种类数` → `console.error`（含池名、两个数量、后果提示）；
- 逐条分配时取不到词条（理论上只在池不足时发生）→ 逐条 `console.error`
  （含物品 id），该物品回落到既有的 `Unknown Potion` / `Unknown` 显示，
  不再无声无息；
- 卷轴标题生成重试 1000 次仍撞题（词素空间耗尽才可能）→ 抛 `Error`。

正常路径（当前词表）下六类全部静默分配成功、构成双射；error 分支只在前人
再犯"池小于种类数"时响亮触发。

## 7. 一个必要的附带改动：外观分配迁移到 RNG_COSMETIC

`startNewGame` 的顺序是 `rng.seedRandomGenerator(seed)` → `initConsumables()`
（Game.ts:340-344），因此外观洗牌消耗的随机数会移位同一 seed 下后续的
地牢/怪物生成序列。池一旦扩充（本任务的核心），消耗模式必然改变。

处理：`initConsumables` 全程在 `rng.setRNG(RNGType.RNG_COSMETIC)` 下执行并
`finally` 还原（`Random.ts` 本就移植了 CE Math.c 的双流机制，此前无人使用）。
外观是纯展示层随机，不应扰动游戏状态生成；这使外观池今后再增删词条
（含本轮这种规模变化）都不会影响玩法层随机序列。

与 CE 的差异：CE 的 `shuffleFlavors()`（RogueMain.c:313）在主随机流上洗牌，
靠"池大小恒定"保持回放稳定；web 池可调，必须解耦。见 §8 第 3 条。

## 8. 与预设不符之处（只列不修）

1. **既有测试 `src/test/monster_stats_effect.test.ts` 存在原生闪失，且被本任务
   不可避免的随机数消耗变化放大**（最重要的偏离，详述如下）：
   - 该测试聚合 16 seed × 500 回合，断言 `legacy.hits === legacy.attacks` 与
     `wired.hits < wired.attacks`。它自述"怪物游走使用未播种的
     `Math.random()`（Monster.ts:291/510），单次运行不可复现"。
   - 实测（完整 `npm test`，同机同命令）：**HEAD 干净副本 2/24 次失败**（约 8%）；
     本树 9/29 次失败（约 31%；去掉新增测试文件后 5/10，证明放大源是第 §7 条
     的消耗移位而非新测试文件本身）。即：该测试在未改动的 main 上本就会偶发
     失败，此前 9 连绿只是运气。
   - 失败样本分析：一次是 legacy 记账缺口（210 攻/210 中 → 变体 210/216，
     采样器把"选中相邻怪"记为攻击、若玩家当回合行动被异常改向则少记命中）；
     一次是 wired 幸运连击（聚合中对 def>0 怪物仅 9 次攻击全部命中，
     `Goblin(def=10):5攻/5中 Monkey(def=17):4攻/4中`，样本太小导致
     `wired.hits < wired.attacks` 以约 10-20% 概率随机翻车）。
   - 本任务边界（禁改任何 `.test.ts`、禁改 Game/Monster/Combat/harness）
     内无法消除该闪失；任何落实"扩池"的方案都会重掷它的轨迹骰子——
     连"保持主流消耗恰好 34 次"的兼容 hack 也只能回到 HEAD 的 ~8% 基线，
     且属污染引擎的坏设计，未采用。建议后续任务：在 harness 内给
     `Math.random` 播种或加固该测试的聚合（缩短跑局、加大 def>0 样本）。
   - 本轮最终验收跑为全绿（见 §2），但 CI 若反复重跑需预期 ~1/3 概率撞上
     该既有闪失。
2. **提示词对既有词表风格的描述与实际不符**：实际既有翻译是
   "红色药水""铜魔杖""梣木法杖"（zh_CN.json），并非"赤红药水""铜质魔杖"。
   新词条按实际风格补齐。
3. **CE 词表语言**：提示词要求"去读这些数组取词（再翻译）"，但本
   BrogueCE-master 检出的词表英文名 + 官方中文翻译散落在
   `bin/assets/zh_CN.todo.json`（部分常见色词缺失，按构词法自行补译）。
4. **i18n 机制被迫双轨**：边界只允许改 `ItemLoader.ts`、不允许动
   `src/locales/zh_CN.json`，故新词条直接存中文显示名（`tn()` 对无 i18n 键的
   字符串原样返回），旧词条仍走 `name.X` 键。项目当前仅有 zh_CN 一个 locale，
   无实际影响；未来若加 en locale，新词条需补翻（或迁回 i18n 键）。
5. **白色药水（0xf5f5f5）与既有冒泡药水（0xffffff）在地面视觉上几乎无法区分**：
   纯白已被冒泡药水占用，白色又必须存在（CE 词表要求）。名字可区分、
   背包内可区分，仅地面 '!' 颜色近乎相同。若要消除，需调整冒泡药水的
   既有 hex（本轮不动物品条目）。
6. **护符池无富余（6=6）**：CE 无 charm 对应词表；不足时的兜底由 §6 的
   console.error 承担。今后新增护符种类时需同步扩池。
7. 提示词中"现有是……铜质魔杖"（见第 2 条）及 CE 数组行号
   （titlePhonemes 实际在 Globals.c L1455 而非提示词提到的位置附近；
   itemColorsRef/itemWoodsRef/itemMetalsRef/itemGemsRef 的行号与提示词一致）
   ——其余预设（六类物品种类数 16/14/7/7/6/6、CE 池大小 21/14/21/12/18、
   静默跳过的成因）经核对全部属实。

## 9. 交付物清单

- 修改：`src/engine/Items/ItemLoader.ts`（扩池 + 程序化卷轴标题 + 响亮报错 + cosmetic 流）
- 新增：`src/engine/Items/itemFlavors.test.ts`（5 项验收测试）
- 新增：`ai_docs/item_flavor_pool_report.md`（本报告）
- 未执行任何 git 写操作；未创建仓库内临时文件；未触碰边界外文件。
