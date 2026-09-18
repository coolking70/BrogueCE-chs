# UI-1 结题报告：七条渲染欠账（与 C-8 并行，零生成期改动）

日期：2026-09-18 · 分支：`round/ui-1` · 执行：开发方（ZCode）
任务书事实复核方式：所有引用的 CE 行号/数值**逐条回源打开** `BrogueCE-master/src/brogue/` 核对，冲突处在 §一 申报。

---

## 一、对任务书的反驳

本轮任务书的事实清单（§3.1–3.6）经逐条回源核对**全部属实**，包括两条⚠️警示：
状态表列语义（`Rogue.h:2022-2025` 确为 `{name, isNegatable, playerNegatedValue}`）、
确认框 Enter=Yes/Esc=No（`IO.c:2956/2966`，且 `ACKNOWLEDGE_KEY = ' '`，`Rogue.h:1179`——
比任务书写的还多核了一个键）、探魔符号析取双守卫（`IO.c:1120-1121` 与 `1219-1236`
的守卫对象确为「怪物」与「格子」之别）。`statusEffectCatalog` 空名四条
（`Globals.c:1811-1814`：EXPLOSION_IMMUNITY / NUTRITION / ENTERS_LEVEL_IN / ENRAGED）亦核实。
三方核对确实起了作用——本轮**没有发现 CE 事实层面的错误**。反驳集中在授权与落点：

### 反驳 1（授权缺口，需追认）：Sidebar.vue 不在允许清单，但第 5 条的显示载体就是它

第 5 条落点写 `statusConfig.ts`，但「explosion_immunity 侧栏显示裸键名」的**显示代码**
在 `src/components/Sidebar.vue:52-58`：它对 `statusDurations` 里每个 `turns > 0` 的键
**无条件渲染**，`STATUS_CONFIG` 查不到就回退 `{label: id}`——这正是裸键名 bug 本体。
只改 statusConfig.ts 而不动 Sidebar，`explosion_immunity` 照显，第 5 条就是死代码 +
假绿（违反「宁可红，不可绕」）。

这正是项目常识 2026-09-17 规矩（「凡范围含『修某处显示』的，先 grep 出承载显示的文件」）
要防的**漏授权形态②**，任务书写清单时没有对第 5 条执行该 grep。

**处置**：按任务书第 5 条自己的处置命令（「按 CE 处置为不显示」）做了**最小 2 行改动**
（import + filter 一行），在此申报请验收方追认。若不追认：revert `Sidebar.vue` 即可
（statusConfig 侧机制保留，但第 5 条的用户可见修复随之作废——请一并裁决该条的存废）。

### 反驳 2（落点反驳）：第 2 条「monsterAppearance + ctx 加 burning」的方向与 CE 结构相反

CE 对燃烧怪物的视觉是 `updateLighting()` 里 `paintLight(BURNING_CREATURE_LIGHT)`
（`Light.c:250`，仅非 `MONST_FIERY`），泼进**玩法光网格** `tmap.light`（`Time.c:894`
每回合重刷，参与 VISIBLE/黑暗判定）——`getCellAppearance` 全程不读 `STATUS_BURNING`，
字形/颜色零变化。web 的等价接线点是 `Game.updateVision` 的生物光循环（**Game.ts 本轮禁改**）。

因此在 `monsterAppearance`/ctx 层加 `burning` 字段只有两种下场：自创 CE 没有的「燃烧染色」
（被 §3.5 用户裁决明令禁止），或造一个永远没人读的死字段。按 §3.5 自己给出的出口
**登记 deferral**（§二第 2 条），ctx 未加 burning。deferral 附激活轮的精确做法（§七）。

### 反驳 3（结构申报）：第 3 条右支（怪物携带品符号）在 web 无载体

CE `monsterWithDetectedItem`（`IO.c:1120-1121`）依赖 `monst->carriedItem`；
web 的 `Monster` **没有** carriedItem 字段（只有死亡掉落率 `itemDropChance`）。
本轮把右支**实现为留形分支**：`ctx.carriedItem` 注入口 + 完整判定逻辑 + 测试注入覆盖
（`ui_1_rendering.test.ts` 右支三条），GameCanvas 生产侧恒传 `null` 并注明。
激活轮 = 怪物载物轮。

### 反驳 4（隐含必要改动申报）：第 1 条必须连带移除 `cell.isBurning` 的 '*' 覆盖层

任务书字面是「terrainAppearance 加 case」，但 cellAppearance 原有的燃烧覆盖层
（`char='*'`、`#ffaa00`、`0xcc2200`）在 terrainAppearance **之后**执行——不移除它，
PLAIN_FIRE 的 case 永远被盖住，是死代码。移除同时是**更忠实的 CE**：CE 没有独立燃烧
覆盖层，火即地形。连带后果见反驳 5。

### 反驳 5（任务书名单缺两员）：GAS_FIRE / GAS_EXPLOSION 必须随第 1 条一起获得火外观

`Grid.isBurning` 的载体集 `FIRE_TERRAIN_TYPES`（`Grid.ts:363`）=
{PLAIN_FIRE, GAS_FIRE, GAS_EXPLOSION}。覆盖层移除后若不给 GAS_FIRE/GAS_EXPLOSION case，
这两类格子会从 '*' **退化成空白**（回归）。CE 依据充分：
GAS_FIRE tile 本身 = `G_FIRE + fireForeColor`（`Globals.c:495`）；爆炸火各 DF 的落点
tile 也是 PLAIN_FIRE（dungeonFeatureCatalog 多条 `{PLAIN_FIRE, SURFACE, …}`，
如 `Globals.c:138/144/178/184/206`）。两者已与 PLAIN_FIRE 同款入表。

### 反驳 6（实现口径说明，非错误）：符号/火焰字形取 CE 图形平台 Unicode

web 是图形风格渲染器（既有 '♠'/'⊙'/'§' 先例），故字形一律取 `platformdependent.c`
的图形映射（⚐ G_FIRE=U+22CF、G_ASHES=`'`、G_GOOD_MAGIC=U+29F3、G_BAD_MAGIC=U+29F2、
G_AMULET=U+2640）；颜色换算按 CE 自带 web 平台的 `(unsigned char)(v*255/100)`
截断（`web-platform.c:170-175`）。U+29F2/29F3 属生僻数学符号块，个别字体可能回退渲染
——已登记为观察项（§七），两个导出常量一改一测即可换 curses ASCII 替代。

---

## 二、七条逐条落地情况

| # | 欠账 | 状态 | 落地说明 |
|---|---|---|---|
| 1 | EMBERS/ASH/PLAIN_FIRE 无渲染 | ✅ | `terrainAppearance` 加 5 个 case（含反驳 5 的 GAS_FIRE/GAS_EXPLOSION）。字形：PLAIN_FIRE 族=`⋏`（G_FIRE）、ASH/EMBERS=`'`（G_ASHES，CE 两平台一致）；颜色：fireForeColor{70,20,0}→`#b23300`、ashForeColor{20,20,20}→`#333333`（CE web 平台 ×255/100 截断）；bg 全 null（CE backColor=0）。CE 的 drawPriority（10/70/80）与 TM_VISUALLY_DISTINCT 在 web 单值 `cell.terrain` 模型里无可观察载体，不迁移（deferral-grade，非缺失）。r_1 穷举表按留痕反转同步（5 成员从 DEFAULT_LOOK 翻为真值，非放宽——每格有了更严的全等锚）。 |
| 2 | 燃烧怪物无视觉 | ⏸ deferral | 见反驳 2。CE 是玩法光照（Light.c:250），接线点 Game.updateVision 本轮禁改。**未加** ctx.burning、**未加**任何燃烧染色（§3.5 用户裁决）。留痕：ui_1 两条（行为等价 + monsterAppearance 代码零燃烧分支），注释写明激活轮做法与「激活轮需重核」。 |
| 3 | 探魔无地面符号 | ✅（右支留形） | `cellAppearance` 新增 `detectedMagicAppearance`：左支（地面物 `magicDetected` + 极性≠0 + **看不见格子**）、右支（`ctx.carriedItem`，生产者折入 !canSeeMonster；web 无载体恒 null，反驳 3）；两支**析取不合并**、右支取携带物（IO.c:1123-1125 顺序）；符号 ⚕/⧳/⧲ 按 AMULET→极性→的 CE 顺序（IO.c:1229-1238）；polarity==0 的内层防御分支结构性不可达（两支守卫已滤 0），不迁移。符号压过地形/气体字形、不做记忆变暗（IO.c:1349-1359 "do nothing"）、**穿透「未探索不画」门**。ctx 新增 `groundItem`/`carriedItem`/`lightChannels`（任务书预告的扩展点）。 |
| 4 | PARALYSIS/METHANE 气体无渲染 | ✅ | gasGrid 覆盖层加两分支：bg 取 CE tile backColor 减半（pink {100,60,66}→0x7f4c54；methaneColor {45,60,15}→0x394c13——CE 原值直接当 bg 会和既有四种气体的暗底惯例冲突，减半是 web 惯例内化，**注册为 web 自创口径**）、字形 `~`（CE 气体 tile 字形即 ' '，以色辨气；'~' 沿用 web 气体惯例中最中性的云形）、fg 各配同族亮色。`!isBurning` 守卫与 density>0 门与既有四支一致。r_1 旧留痕「PARALYSIS/METHANE 无分支」已按反转惯例改钉新事实。 |
| 5 | explosion_immunity 裸键名 | ✅（方向按 §3.1 反转） | 处置 = **不显示**（CE 有意空名，Globals.c:1811；IO.c:4823 `name[0]` 门）。`statusConfig.ts` 导出 `CE_EMPTY_NAME_STATUSES`（现值恰 = {'explosion_immunity'}，注释写明 CE 四条空名全名单与 web 载体核对）+ `isSidebarVisibleStatus()`；Sidebar 过滤一行（反驳 1，请追认）。顺带核查完毕：web 侧无其它「CE 空名但 web 在显示」的状态——'burning' 在 CE 有名（"Burning"）；nutrition 不进 statusDurations（走饥饿部件，CE 同款 IO.c:4786）；enraged/enters_level_in 无写入点。**未给** explosion_immunity 补中文标签（P1-47 原登记方向错误，请验收方更新路线图）。未知键仍裸显（既有调试可见性，不借机收缩）。 |
| 6 | onConfirmRequest 未接线 | ✅ | `App.vue` 模块块导出 `wireConfirmRequest(game)` 并在 setup 挂到 `activeGame`。同步契约用浏览器原生 `confirm()`——web 平台唯一能同步阻塞的模态，且键语义与 CE 完全同构（Enter=OK=Yes ≙ RETURN_KEY 挂 Yes 钮；Esc=Cancel=No ≙ ESCAPE_KEY 挂 No 钮；ACKNOWLEDGE_KEY=' ' 同 No，Rogue.h:1179）。回放（`replayStatus==='playing'`）与自动寻路（`isAutoTraveling()` ≙ CE `rogue.autoPlayingLevel`）直接放行不弹框（IO.c:2941-2943 "oh yes he did"）——否则回放会卡死在对话框。headless/测试不挂 App，钩子保持 null → 按确认处理（C-5 原申报不变）。i18n：消息体由引擎传入（已本地化），**零新增 t() 调用**，p1_30 无涉。 |
| 7 | C-7 光照未升级 | ✅ | `ctx.light: LightCell`（钳 0-255 的旧渲染视图）**替换**为 `ctx.lightChannels: LightChannels`（`LightMap.lightAt` ≙ CE `tmap.light` 三通道原值，可超 100）。混合公式替换为 CE 管线：`adjustedLightValue`（>150 平方根压回，IO.c:1732-1737 + Rogue.h:180）→ 每通道 `applyColorMultiplier`（IO.c:1517-1530，trunc(base×mult/100)，出界钳字节域 ≙ plotChar 0..100 钳）前景/背景各一次（IO.c:1434-1437）。「可见但无光」近黑分支与幻觉分支逐位不动。GameCanvas 只改 ctx 取值（每帧建一次物品索引 map + `lightAt`），零外观决策（r_1 结构守卫全绿）。c_7:620 留痕按反转惯例翻转（原钉「渲染层只消费 getLight」→ 新钉「消费 lightAt 三通道、仍禁 import 光照目录/paintLight」）。 |

**Deferral 汇总**：仅第 2 条一条（理由与激活路径见反驳 2 与 §七）；第 1 条的
drawPriority/TM_VISUALLY_DISTINCT 与第 3 条 polarity==0 防御分支为「无可观察载体 /
结构性不可达，不迁移」级别，均已在代码注释与本节登记。

---

## 三、改动清单

```
 brogue-web/src/App.vue                       |  24 ++   [新模块块 wireConfirmRequest + setup 接线]（第6条）
 brogue-web/src/components/GameCanvas.vue     |  16 +-  [仅 ctx 取值：lightAt/物品索引/carriedItem:null]（第3/7条接线）
 brogue-web/src/components/Sidebar.vue        |   6 +-  [import + 一行 filter]（第5条；反驳 1 请追认）
 brogue-web/src/engine/Status/statusConfig.ts |  25 ++   [CE_EMPTY_NAME_STATUSES + isSidebarVisibleStatus]（第5条）
 brogue-web/src/engine/UI/Appearance.ts       | 253 +--- [第1/3/4/7条 + 第2条deferral注释 + ctx 扩展]
 brogue-web/src/test/c_7_lighting.test.ts     |   9 +-  [:479 改口 + :620 留痕反转（授权清单内）]
 brogue-web/src/test/r_1_appearance.test.ts   | 196 +-- [穷举表 5 成员反转 + 光照/燃烧/气体用例按新事实重钉 + ctx 字段]
 brogue-web/src/test/ui_1_rendering.test.ts   | 新文件  [32 条：七条逐条 + 6 条对抗性 + 2 条 deferral 留痕]
 7 files changed, 406 insertions(+), 123 deletions(-)
```

未动（门禁证据见 §六）：`BrogueCE-master/`（只读）、`src/engine/Generator/`、
`src/engine/Map/`（含 LightMap.ts / LightCatalog.ts——本轮实际**不需要**改 LightCatalog，
灯目录 60 条 C-7 已含 BURNING_CREATURE_LIGHT）、生成期 fixture、`p1_30_i18n_gate`
（零新增 t() 调用，无需动）。

---

## 四、对抗性测试与反向验证

`ui_1_rendering.test.ts` 每条 it 的注释里写明了它打红的**具体错误实现**。
强制反向验证做了 4 轮（任务书要求 ≥3），每轮：真改坏 → 跑 → 记录 → 还原。
**还原后 `grep -rn "REVERT-ME" src/` = 0 条。**

### 反向验证 ①：光照平方根压回被改成恒等（adjustedLightValue 直接返回 x）

```
 × 对抗：过亮通道平方根压回（adjustedLightValue，IO.c:1732-1737）——漏写压回/用旧混合即红 2ms
 FAIL  src/test/ui_1_rendering.test.ts > UI-1 第 7 条 … > 对抗：过亮通道平方根压回 …
 AssertionError: expected 4013403 to be 3618643 // Object.is equality
      Tests  1 failed | 31 passed (32)
```

### 反向验证 ②：恶意魔法符号错用善意色（badMessageColor↔goodMessageColor 互换）

```
 FAIL … > 左支：恶意物品 → G_BAD_MAGIC + badMessageColor；不做记忆变暗 …
 AssertionError: expected '#997fff' to be '#ff7f99' // Object.is equality
 FAIL … > 对抗：分支顺序——右支（携带物）压过左支（地面物），CE IO.c:1123-1125
 AssertionError: expected '#997fff' to be '#ff7f99' // Object.is equality
      Tests  2 failed | 30 passed (32)
```

### 反向验证 ③：CE 空名集被清空（模拟 P1-47 原「照显」的错误处置）

```
 FAIL … > 负向：explosion_immunity 不得出现在侧栏可见集合
 AssertionError: expected true to be false // Object.is equality
 FAIL … > CE 空名集恰为 web 现有载体（explosion_immunity）…
 AssertionError: expected [] to deeply equal [ 'explosion_immunity' ]
      Tests  2 failed | 30 passed (32)
```

### 反向验证 ④：EMBERS 抄成 ashForeColor（同字形异色抄同）

```
 FAIL  src/test/r_1_appearance.test.ts > … 可见态：每个成员的 {char, color, bgColor} 全等钉死
 AssertionError: TerrainType[32] 可见态: expected { char: '\'', color: '#333333', … } to deeply equal { char: '\'', color: '#b23300', … }
 FAIL  src/test/ui_1_rendering.test.ts > UI-1 第 1 条 … > 对抗：ASH 与 EMBERS 同字形但**颜色不同**…
 AssertionError: expected '#333333' to be '#b23300' // Object.is equality
      Tests  2 failed | 75 passed (77)
```

四轮各自命中「穷举表 + 专项对抗」双保险中的至少一道；③命中任务书点名要的**负向断言**。

---

## 五、需要追加授权的测试

无。清单外测试零撞红（全量 87 文件绿为证）；唯一清单外改动是生产文件
`Sidebar.vue`（生产侧授权缺口，见反驳 1，**请验收方追认或裁决第 5 条存废**）。

---

## 六、门禁结果

### 全量 vitest（`npx vitest run --fileParallelism=false`，不带文件参数）

```
 RUN  v4.1.11 /…/brogue-web

 Test Files  87 passed (87)
      Tests  1138 passed | 8 skipped | 5 todo (1151)
   Start at  15:19:14
   Duration  1433.32s (transform 991ms, setup 0ms, import 11.53s, tests 1414.79s, environment 14ms)
```

（exit code 0。期间无 C-8 抢红翻案：无任何文件需要单独重跑。）

### npm run build（类型门禁，非 tsc --noEmit）

```
 dist/assets/index-BFCFYEd6.js               882.24 kB │ gzip: 265.94 kB
 (!) Some chunks are larger than 500 kB after minification. …   ← 既有告警，非本轮引入
 ✓ built in 1.67s
```

### generation_baseline 绿 + fixture 未动

```
 npx vitest run --fileParallelism=false src/test/generation_baseline.test.ts
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  11.57s

 git status --porcelain：
 M brogue-web/src/App.vue
 M brogue-web/src/components/GameCanvas.vue
 M brogue-web/src/components/Sidebar.vue
 M brogue-web/src/engine/Status/statusConfig.ts
 M brogue-web/src/engine/UI/Appearance.ts
 M brogue-web/src/test/c_7_lighting.test.ts
 M brogue-web/src/test/r_1_appearance.test.ts
?? brogue-web/src/test/ui_1_rendering.test.ts
 git diff --name-only | grep -i "fixture\|baseline" → exit 1（无任何 fixture/baseline 文件被改）
```

零生成期文件改动（diff 里没有 Generator/Map 下的任何文件）；RNG 流零触碰
（本轮无任何掷骰改动，generation_baseline 绿即为此项证据，无需另立哨兵——任务书 §6.5）。

---

## 七、遗留与登记

1. **第 2 条激活轮**（燃烧怪发光）：在 `Game.updateVision` 的生物光循环里加
   `if (burningDuration(m) > 0 && !m.isFiery) lm.paintLight({ light: LIGHT_CATALOG[BURNING_CREATURE_LIGHT], … })`
   ——CE `Light.c:250` 逐字语义；web `LightCatalog` 已有该条目（c_7 钉 60 条）。
   渲染侧届时**零改动**（乘法管线自动吃到新光）。登记时请把 ui_1 的
   「燃烧怪物无专属外观」留痕一并翻转为「lightGrid 含火光」。
   **激活轮需重核 CE**：fiery 判定的 web 载体名（MONST_FIERY 旗标的 web 等价位）。
2. **P1-47 路线图登记方向错误**（补标签 → 应为不显示）：请验收方按 §3.1 更新路线图，
   防止后续轮按旧登记「修回来」。
3. **符号字形字体覆盖观察项**：⧲/⧳（U+29F2/29F3）在个别平台字体可能回退渲染；
   若真机观察不能接受，把 `Appearance.ts` 的 `G_BAD_MAGIC_CHAR/G_GOOD_MAGIC_CHAR`
   换成 curses 平台映射（`'+'`/`'$'`——注意 '+' 与 DOOR 撞形）并同步 ui_1 的
   两条逐字符锚点断言即可。
4. **怪物载物轮**：实现 `Monster.carriedItem` 后，把 GameCanvas 的
   `carriedItem: null` 换成真实取值（带 !canSeeMonster 守卫折入），右支即激活；
   ui_1 右支三条测试无需改。
5. **getLight/fillRenderFromLighting 已无生产消费者**（渲染改走 lightAt）：
   c_7:479 已改口为「兼容面」；后续清理轮可评估下线（本轮不动，LightMap.ts 禁改）。
6. **web telepathy 剪影与探魔符号的角落叠加**：CE 的「感知」按格（TELEPATHIC_VISIBLE
   进 ANY_KIND_OF_VISIBLE），web 的 telepathy 是全局怪物显影——两者叠加在
   「探测物品 + 心灵感应 + 隐形怪同格」时会同时画出符号与剪影。CE 原语义下该格
   画符号（怪物分支要求 canSeeOrSense 或 定身+已发现）。登记为 web 已知结构差，
   不在本轮七条范围内。
7. **气体 bg「CE 原值减半」是 web 自创口径**（第 4 条）：若后续轮统一气体视觉
   （比如把既有四种气体的自创色一并换成 CE tile 原色），新气体的两值应随行。
