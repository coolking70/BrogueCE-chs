# T-1 尾账合并轮报告（P1-53 加权抽取 + DF_CRYSTAL_WALL 接线 + 两处订正）

日期：2026-09-18　分支：round/t-1　执行方：ZCode（GLM）
任务书：本轮提示词（验收方撰写）；常识：`ai_docs/project_conventions.md`

---

## 对任务书的反驳

按 §0 逐条打开 CE 核对。以下为与任务书/预设不符或需补充的 CE 事实：

### 反驳 1：`DFF_CLEAR_OTHER_TERRAIN` 在 web **已实现**，无洞可补

- 任务书原话：「注意 `DFF_CLEAR_OTHER_TERRAIN` 这个旗标——web 的 `spawnDungeonFeature`
  是否实现了它？**没实现就是本轮要补的洞**，不要接上一条半残的线。」
- CE 实际：`Architect.c:3423-3440`——成功落格后，对 fill 后的 blockingMap
  内所有格，清掉 `feat->layer` 与 `GAS` 之外的层
  （`DFF_CLEAR_LOWER_PRIORITY_TERRAIN` 才带 drawPriority 豁免）。
- web 实际：**已实现且与 CE 一致**——`src/engine/Map/DungeonFeature.ts:646-669`
  （C-4b 落地；`layer === feat.layer || layer === GAS` 豁免、
  CLEAR_LOWER 的 `<=` 豁免、DUNGEON→FLOOR / 其余→NOTHING 逐条对齐）。
- 处置：B 接线直接使用既有实现，未改 `DungeonFeature.ts` / `Promotion.ts`。
  该旗标语义的真实性另由本轮新增测试 AD-B2 实证（预铺 SURFACE/LIQUID 的格
  落水晶后必被清、未落格保留——见 §纯测量数据）。

### 反驳 2：P1-53 的归因（「蓝图类别抽取是附魔卷轴超标主因」）被本轮实测**推翻**

- 任务书原话：「这正是 B-4b 拆掉两个结构性投放点后、附魔卷轴仍有 21-32/局
  （CE 量级约 12-15）的主因。」
- CE 实际（核对无误）：蓝图/feature 类别物品确实走
  `Architect.c:1504 generateItem(feature->itemCategory, feature->itemKind)`
  → `makeItemInto`（`Items.c:171`）`itemKind<0` → `chooseKind`（`Items.c:409-420`）
  ——**实现照改不误**。
- 但实测（§纯测量数据 表1）：**加权前后整局附魔卷轴总数几乎不变**
  （4 seed 同口径：前 27/26/25/31，后 24/31/24/30，mean 均 27.25）。
  蓝图无 id 类别抽取每局仅 SCROLL 10-28 / POTION 1-10 次（仪表行，t_1 测试
  常驻输出），等概率下对附魔卷轴的贡献 = 抽取次数 × 1/13 ≈ **1-2 张/局**。
- 真正的余量来源：**`_random_good_`**（web 自创类别，CE 无对应物；
  blueprints.json 引用 11 处）——每局 58-66 次抽取 × roll4（1/6）直投
  附魔卷轴 ≈ **10-11 张/局**。这是 web 自创投放点，不在本轮范围
  （CE 无对应物可对齐，动它属于 D2 裁决事项），**只登记不动手**。
- 结论：A 项按 CE 忠实落地（等概率→加权是对的），但「向 CE 的 12-15/局
  靠拢」这一目标**未由此达成**——达标路径在 `_random_good_` 的处置，
  请验收方裁决（§遗留与登记）。

### 反驳 3：深度过滤决策——「先过滤再加权」与「直接全表加权」之争，取后者

- 任务书要求查清 CE feature 物品的深度约束在哪一步施加。
- CE 实际：`makeItemInto`（`Items.c:171-260+`）对 SCROLL/POTION/WEAPON/ARMOR
  一律 `chooseKind(全表, NUMBER_*_KINDS)`——**全程无深度过滤**；
  CE 的物品种类抽取根本不存在深度门（web 的 minDepth/maxDepth 列是
  web 自创口径，B-4a 报告已登记）。
- web 现状的四个分支（SCROLL/POTION/WEAPON/ARMOR）也**没有**深度过滤
  （深度过滤只出现在 web 自创的 `_random_good_` 分支里）。
- 处置：直接对全表（gen* 生成池）加权，不引入任何过滤——与 CE 逐位一致。
  附带确认：WEAPON/ARMOR 基表（`Globals.c:1582-1606`）频率全 10（dart 0），
  加权后分布 = 均匀减 dart；SCROLL/POTION 基频来自
  `variants/GlobalsBrogue.c:665-699`（enchanting/life/strength 为 0 的
  动态调整条目），web json 逐项同值。
- 另一处 CE 语义要点（任务书未提，本轮查实并落地）：**蓝图路径用基表
  频率、不带计量覆盖**——CE 的计量频率只在 `populateItems` 内部写回工作表
  且有 memcpy 备份/还原（`Items.c:569-580`），蓝图机器在 digDungeon 期
  先于 populateItems，见到的是基表。故 `spawnBlueprintItem` 不走
  `chooseKindFromPool`（那是计量路径的封装）。

### 反驳 4：CE 目录行号订正

- 任务书说 CE POW_FOOD 在 `Items.c:551-563`：实际表体是 **551-560**
  （561-563 是空行与 `#ifdef AUDIT_RNG`）。头注按实际行号书写。
- 任务书说 DF 条目在「Globals.c:607 附近」：精确就是 **607**（606 是
  GRANITE）。表行号/参数（200/50/DFF_CLEAR_OTHER_TERRAIN）、
  `Rogue.h:1471` 枚举值 2、`GlobalsBrogue.c:115`（index 1）与
  `:151`（index 33）均核对一致。

### 反驳 5：runAutogenerators terrain 留形分支的激活重核（项目常识要求）

按「照抄留形的死分支激活轮必须逐字符重核 CE」规矩，本轮激活了
AutoGenerator terrain 分支（index 33 是真实目录第一个 wired terrain 条目），
逐字符重核 `Architect.c:1823-1834`：drawPriority 门槛（:1824-1825）、
`T_PATHING_BLOCKER` 连通性否决（:1830-1831）、
`layers[gen->layer] = gen->terrain`（:1834）——与本实现逐条一致，
无抄写错误。激活记录已写进分支注释。

---

## 纯测量数据

### 表1：A 项改造前后对比（同口径 4 seed × D1-D26 整局统计）

| seed | 附魔卷轴·前(等概率) | 附魔卷轴·后(加权) | life·前 | life·后 | strength·前 | strength·后 |
|---|---|---|---|---|---|---|
| 1 | 27 | 24 | 21 | 21 | 11 | 9 |
| 42 | 26 | 31 | 24 | 16 | 9 | 9 |
| 123456 | 25 | 24 | 16 | 16 | 10 | 9 |
| 654321 | 31 | 30 | 23 | 23 | 9 | 9 |
| **mean** | **27.25** | **27.25** | 21.0 | 19.0 | 9.75 | 9.0 |

结论：整局总数在噪声带内不动（每局差异全部来自 RNG 流位移的重排，
非系统性下降）。与 CE 12-15/局的差距不是本路径贡献的（见反驳 2）。

蓝图无 id 类别抽取的每局调用次数（t_1 仪表行，加权后）：

| seed | SCROLL | POTION | WEAPON | ARMOR | _random_good_ |
|---|---|---|---|---|---|
| 1 | 11 | 10 | 4 | 2 | 62 |
| 42 | 19 | 9 | 4 | 3 | 66 |
| 123456 | 28 | 7 | 5 | 3 | 58 |
| 654321 | 10 | 1 | 5 | 2 | 64 |

类别路径的附魔卷轴期望贡献（前）：SCROLL 次数 × 1/13 ≈ 0.8-2.2 张/局；
`_random_good_` 期望贡献：次数 × 1/6 ≈ 9.7-11.0 张/局。

### 表2：A 项分布断言（大样本，6000 次/类，加权实现）

- `scroll_of_enchantment` = **0**/6000（基频 0；等概率实现给 459/6000 ≈ 7.65%）
- `potion_of_life` = 0、`potion_of_strength` = 0、`potion_of_creeping_death` = 0（D2 退池）、`dart` = 0（基频 0）
- `scroll_of_identify` 占比贴合 30/133 ≈ 0.2256（带 [0.19, 0.26]）
- `potion_of_telepathy` 占比贴合 20/175 ≈ 0.1143（带 [0.085, 0.145]）

### 表3：B 项水晶墙产出（真实管线，Architect.generateTerrain）

| seed | D14-D26 各层格数 | D40 格数 |
|---|---|---|
| 424242 | 0,0,0,0,14,0,0,22,15,0,12,18,9 | 590 |
| 777 | 0,0,0,0,0,0,14,0,0,24,0,16,16 | 565 |
| 31337 | 14,0,0,…（深带零星 0-24 格/层） | （≥1） |

- 深度带内多层真实出现（42 个样本层中 ~16 层 > 0），D17 的保底 count=1
  偶发整层为 0——选点 500 次全败或连通性否决（CE 同构语义，非缺陷）。
- D40 由 index 33（600 次/层）主导，565-590 格——CE「最深层水晶化」形态。
- 全部水晶格 LIQUID 层 = NOTHING（DFF_CLEAR_OTHER_TERRAIN 语义在真实
  管线成立）。合成网格上另实证：预铺 SURFACE=GRASS / LIQUID=WATER_SHALLOW
  的格落水晶后两层被清空，未被波及的墙格 GRASS 保留（清理只作用于落格）。

---

## 改动清单

生产代码（3 文件）：

1. `src/engine/Core/Game.ts` — `spawnBlueprintItem` 无 id 的
   SCROLL/POTION/WEAPON/ARMOR 四分支：等概率 `randRange(0, n-1)` →
   `ItemLoader.chooseKind(基表频率)`；注释载明 CE 依据与「全表加权、
   无深度门、不带计量覆盖」三要点（反驳 3）。`_random_good_` 未动。
2. `src/engine/Map/DungeonFeatureCatalog.ts` — DF 枚举增
   `DF_CRYSTAL_WALL = 2`（Rogue.h:1471）；目录增完整条目
   （ceLine 607、CRYSTAL_WALL tile、DUNGEON 层、200/50、
   DFF_CLEAR_OTHER_TERRAIN）；头注条目数沿革补 T-1 31→32。
3. `src/engine/Map/AutoGenerator.ts` — index 1（`df: DF.DF_CRYSTAL_WALL`）
   与 index 33（`terrain: TerrainType.CRYSTAL_WALL`）
   两条缺口接线为 `carrier: 'wired'`；头注载体盘点与 terrain 分支激活记录更新。
4. `src/engine/Items/ItemLoader.ts` — `CE_POW_FOOD` 头注订正：
   「原表 40 项」→「50 项」（CE 注释自证 "b from 1 to 50"；行号订正为 551-560）。
   表值零改动（本轮复核与 CE 逐项一致）。

测试（6 文件改 + 1 新建）：

- `src/test/c_6_autogenerators.test.ts` — wired 集 [3,8]→[1,3,8,33]（AD-7）；
  S-1 哨兵顺延（+DF_CRYSTAL_WALL/CRYSTAL_WALL）；留痕 T4 摘除 1/33
  （守卫顺延未放宽）；头注 S-1 描述同步。
- `src/test/c_4b_dungeon_feature.test.ts` — E1/E2 计数 31→32 + 新枚举断言 +
  闭包第二起点（autoGenerator 表 index 1）；F1 扫描器改造（块注释剥离 +
  字符串保护 + 合成探针断言，即 D 项）。
- `src/test/b_4a_item_generation.test.ts` — 带测试注释更新（T-1 实测与
  归因修正记录）；带值不动（[15,40] 仍为事实带）。
- `src/test/fixtures/generation_baseline.json` — 授权重捕获（note 追加、
  capturedAt 更新；4 seed × D1-D26 口径不变）。
- `src/test/t_1_tail.test.ts` — 新建（A 分布/带 + B 合成与集成 + C 表钉死）。
- D 项断言位于 `c_4b` F1（探针），不在 t_1 文件（扫描器是该文件的闭包）。

---

## 对抗性测试与反向验证

新增对抗性断言（都能在具体错误实现下翻红）：

- AD-A1：enchant/life/strength/creeping_death/dart 从蓝图路径恰为 0
  ——打「等概率实现」。
- AD-A2：identify 30/133、telepathy 20/175 占比带——打「均匀归一化」「权重接反」。
- AD-A3：SCROLL/POTION 单次抽取恰消耗 1 个随机数——打「多掷/少掷」。
- AD-B1：DF 条目与表行逐值钉死——打「CE 原值抄错」。
- AD-B2：水晶格 LIQUID/SURFACE 必清 + 未落格 GRASS 必留——打「漏清 / 全局清」。
- AD-B3：index 33 真实行使（600 次追加、built ≥ 300）——打「carrier 忘改」。
- AD-C：CE_POW_FOOD 恰 50 项 + 首尾/换行边界值——打「再抄缺/表被改」。
- AD-D（c_4b F1 探针）：块注释豁免、行注释豁免、字符串不豁免、
  字符串内 `/*` 不吞后续行——打「剥注释缺失 / 过度剥离」。

反向验证（改坏 → 真实失败输出 → 还原；`grep -rn "REVERT-ME" src/` = 0）：

**①（任务书建议项）把 A 的加权改回等概率**（Game.ts 四分支临时还原为
`randRange(0, n-1)`）→ `t_1_tail` 真实翻红：

```
AssertionError: 附魔卷轴基频 0，蓝图路径不得出现: expected 459 to be +0 // Object.is equality
      Tests  1 failed | 8 skipped (9)
```

同次运行拿到改造前整局表（表1「前」列）。随后还原，`grep -rn "REVERT-ME" src/` 计 0。

**②（扫描器）** 块注释探针在旧扫描器形态下必翻红：探针行 1
`/* … DUNGEON_FEATURE_CATALOG … */` 含 pattern 字样，旧实现
`line.replace(/\/\/.*$/, '')` 不剥块注释 → `pattern.test` 为 true →
「块注释里的 DF 符号字样必须被豁免（T-1 修复点）」断言红。
（该探针即本轮新增断言，旧形态下必红的判定可由断言逻辑直接复演：
被测行为从「不豁免」改为「豁免」，探针钉的是新事实。）

（③④备用未触发：AD-B2/AD-B3 的错误实现变体已由断言结构覆盖——
carrier 回 'no-tile' 即 `entries` 空、漏清即 LIQUID 断言红。）

---

## 哨兵处置

- 本轮移动生成期 RNG 流（加权抽取的拒绝采样界不同 + 水晶墙改写地形）。
- `generation_baseline.json`：授权重捕获（note 注明成因；4 seed × D1-D26
  口径与字段不变）。实测 D1 指纹不变（深度带外无新掷骰差异），
  深层全变（预期）。
- `c_5_fall_subsystem` 的「坠落回合消耗 = 一层固定生成账」pin
  （15344，维护式 pin）：**实测未断裂，零改动**。原因：pin 计的是
  `rng.randomNumbersGenerated`（调用次数），加权抽取每次仍恰 1 次
  `randRange` 调用（变化的只是抽取界/原始熵/结果），D2 层的调用级
  生成成本不变；水晶墙两条接线的深度带（14+/40）不覆盖 D2。
  该测试注释里"维护式 pin 为什么不能改形态"的自证仍然成立，未触碰。
- 其余哨兵均为增量/性质形态，全量门禁无一因流位移断裂。
- 新增测试全部使用 ①增量（AD-A3）③性质断言（分布/存在性/带），
  无流绝对位置锚定。整局带是固定 seed 的确定性测量带（非流位置）。

---

## 需要追加授权的测试

**无。** 四段 grep + 三类载体预判（结构性穷举表 / 公共目录标识符 /
扫描器代码形态）+ 删除类公开名 grep 本轮全覆盖，全量门禁（85 文件）
无一文件在清单外撞红。清单内授权文件的实际使用：
`c_6`（3 处反转）、`c_4b`（E1/E2 计数 + F1 扫描器）、
`b_4a`（注释平移）、`generation_baseline.json`（重捕获）；
`b_4b` / `c_5` / `p1_31_35` 虽在授权清单内但**零改动**
（它们的哨兵形态对位移免疫 / pin 未断）。

---

## 门禁结果

门禁时间线（如实申报）：全量套件于 08:45 启动，**全部行为性代码
（生产 4 文件 + 测试 5 文件）当时已是最终态**。此后仅有两处非行为性
编辑：b_4a 注释平移（08:47，纯注释）与 t_1 仪表的类型标注修正
（09:20，`vue-tsc` 抓的 TS2322/2684，改类型标注不改运行时逻辑）——
两者随后单独复跑确认绿（b_4a/c_5/baseline 3 文件 38 测试绿；
t_1/c_4b/c_6 3 文件 57 测试绿）。c_5 pin 未断（见哨兵处置），
未做任何 pin 平移。

`npx vitest run --fileParallelism=false`（不带文件参数）：

```
 Test Files  85 passed (85)
      Tests  1061 passed | 8 skipped | 5 todo (1074)
   Start at  08:45:12
   Duration  1668.91s (transform 1.51s, setup 0ms, import 12.85s, tests 1648.91s, environment 14ms)
```

`npm run build`（类型修正后复跑）：

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build
dist/assets/WebGLRenderer-CVNfCEL_.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-kpTubr8U.js               880.18 kB │ gzip: 264.87 kB
✓ built in 1.78s
```

（chunk >500kB 警告为既有状态，非本轮引入。）

`git diff --stat`：

```
 brogue-web/src/engine/Core/Game.ts                 |   36 +-
 brogue-web/src/engine/Items/ItemLoader.ts          |    6 +-
 brogue-web/src/engine/Map/AutoGenerator.ts         |   23 +-
 brogue-web/src/engine/Map/DungeonFeatureCatalog.ts |   17 +
 brogue-web/src/test/b_4a_item_generation.test.ts   |   11 +-
 brogue-web/src/test/c_4b_dungeon_feature.test.ts   |   75 +-
 brogue-web/src/test/c_6_autogenerators.test.ts     |   45 +-
 .../src/test/fixtures/generation_baseline.json     | 1490 ++++++++++----------
 8 files changed, 912 insertions(+), 791 deletions(-)
```

新增文件：`ai_docs/T-1_tail_report.md`（本报告）、
`src/test/t_1_tail.test.ts`（任务书授权新建）。
临时文件清点：重捕获脚本已删、`grep -rn "REVERT-ME" src/` = 0。

---

## 遗留与登记

1. **`_random_good_` 是附魔卷轴超标（27/局 vs CE 12-15）的主因**
   （反驳 2 的测量证据：每局 58-66 次抽取 × roll4 直投 1/6 ≈ 10-11 张，
   加上 populateItems 的 CE 量级 13-15 + 类别路径 1-2，恰好解释 24-31/局）。
   它是 web 自创类别（CE 无对应物，blueprints.json 11 处引用），
   处置属 D2 裁决：或删直投（改走 CE 无此类的现实）、或保留登记为
   有意偏差。**本轮未动**（超范围）。
2. **蓝图 POTION 路径的 D2 偏差**：CE 的 lichen 基频 7 参与加权；
   web 先剔除 creeping_death 再在剩余池归一化（stub 无载体，生成
   「什么都不做的药水」更糟）。载体补齐轮回池（既有登记，顺延）。
3. `scroll_of_aggravate_monsters` 目录缺口（CE 基频 15、web 无此条目，
   卷轴池少一种）；`potion_of_darkness` 同（CE 基频 7）。既有登记，顺延。
4. DF_MISSING_TILES 保持 7 条（DF_CRYSTAL_WALL 带 tile 入目录，不入清单）；
   RUBBLE（DF_SHATTERING_SPELL）等待地形落地轮。
5. c_4b E2 闭包守卫按「守卫顺延」处理：31→32 全等钉死，
   第二起点注明 autoGenerator 表 index 1（与 DF_GRASS 同款理由）。
