# 护甲展示层口径对齐 CE 加法防御模型 — 交付报告

日期：2026-09-14
范围：P1-11（护甲"减伤"→ CE"降低被命中概率"模型）的展示层收尾。战斗结算在 P1-11 已正确，本轮只修展示层，使玩家看到的数字与实战同源。

## 改动文件

```
 brogue-web/src/engine/Core/Game.ts          |  8 ++---
 brogue-web/src/engine/UI/DetailGenerator.ts | 56 +++++++++++++++++++++--------
 2 files changed, 46 insertions(+), 18 deletions(-)
```

新增：`src/test/armor_display_effect.test.ts`（16 条用例）、本报告。未触碰任何禁改文件（CombatFormulas.ts / Combat.ts / Monster.ts / Player.ts / Item.ts / ItemLoader.ts / Architect.ts / Gas.ts / Bolt.ts / src/data/*.json / 既有 .test.ts 均未改动），未执行任何 git 写操作。

## 验证结果

### npm test（尾部）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  20 passed (20)
      Tests  166 passed | 6 todo (172)
   Start at  05:53:59
   Duration  11.61s (transform 123ms, setup 0ms, import 2.35s, tests 22.06s, environment 4ms)
```

166 passed = 修复前基线 150 passed + 新增 16 条，**原有测试无一减少、无一改写**。

### npm run build（尾部）

```
✓ 784 modules transformed.
rendering chunks...
dist/index.html                               0.76 kB │ gzip:   0.43 kB
...
dist/assets/index-DgOwC3v0.js               877.10 kB │ gzip: 277.11 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- ...
✓ built in 1.34s
```

`vue-tsc -b` 类型检查 + vite 构建全绿（chunk 体积告警为既有状态，非本轮引入）。

## 修改一：怪物详情"命中你的概率"（Game.ts 调用点 + DetailGenerator 内部计算）

### 前后对照

修复前（Game.ts 两处调用点相同，`generateMonsterDetail` 的第 4 参传的是**原始显示值**，而 DetailGenerator 拿它当 CE ×10 标度的防御值用；后三个 armor 参数是 `_` 占位、被完全忽略）：

```ts
this.inspectTarget = generateMonsterDetail(
    monster,
    this.player.hp,
    this.player.strength,
    this.player.equippedArmor?.armor ?? 0,        // ← 皮甲=3，被当 ×10 防御标度用
    [n || 1, (n || 1) * (d || 2)],
    this.player.equippedWeapon?.enchantment ?? 0,
    this.player.equippedWeapon?.strengthRequired ?? 12,
    this.player.equippedArmor?.armor ?? 0,        // ← 占位，被忽略
    this.player.equippedArmor?.enchantment ?? 0,  // ← 占位，被忽略
    this.player.equippedArmor?.strengthRequired ?? 12
);
```

```ts
// DetailGenerator.generateMonsterDetail（修复前）
const monHitProb = hitProbability(monAcc, playerDefense);  // playerDefense = 显示值 3
```

修复后（Game.ts 两处调用点：废弃参数传 0，armor 三元组照传；strReq 缺省改为 `?? 0`，理由见下）：

```ts
this.inspectTarget = generateMonsterDetail(
    monster,
    this.player.hp,
    this.player.strength,
    0, // 已废弃占位：防御由 DetailGenerator 内部用下方 armor 三元组经 playerDefense() 计算
    [n || 1, (n || 1) * (d || 2)],
    this.player.equippedWeapon?.enchantment ?? 0,
    this.player.equippedWeapon?.strengthRequired ?? 12,
    this.player.equippedArmor?.armor ?? 0,
    this.player.equippedArmor?.enchantment ?? 0,
    this.player.equippedArmor?.strengthRequired ?? 0 // 缺省口径对齐 Combat.ts 的 || 0
);
```

```ts
// DetailGenerator.generateMonsterDetail（修复后）：复用三个占位参数，
// 在内部调用 playerDefense()——防御计算只保留 CombatFormulas 一处真相来源
const armorBase = playerArmorBase ?? 0;
const effectivePlayerDefense = armorBase > 0
    ? playerDefense(armorBase, playerArmorEnchant ?? 0, playerStrength, playerArmorStrReq ?? 0)
    : 0;
const monHitProb = hitProbability(monAcc, effectivePlayerDefense);
```

要点：

- **不传现成值、传原料**（与 P1-6 删除重复伤害解析器同理由）：防御算法只在 `CombatFormulas.playerDefense` 一处定义，面板与实战（`Combat.ts:73-81`）各自调用它。
- **两个口径与实战逐字对齐**：
  - `armorBase > 0` 守卫 ↔ `Combat.ts:73` 的 `equippedArmor && equippedArmor.armor` truthy 守卫（无甲 → 防御 0）。若机械调用 `playerDefense(0, 0, 力量, 0)`，力量盈余会凭空产生幻影防御（`netEnchant(0,12,0)` = +3 → 防御 30），所以这个守卫必须复刻。
  - `playerArmorStrReq ?? 0` ↔ `Combat.ts:74` 的 `strengthRequired || 0`。Game.ts 原来占位参数传的是 `?? 12`，已改为 `?? 0`（属任务允许的调用点参数传递范围）。armors.json 中所有护甲都带 strengthRequired，缺省值实际不触发，但对齐后"同源"不依赖数据巧合。
- 第 4 参签名保留（既有 `DetailGenerator.test.ts` 按位传参不可改动），改名 `_playerDefense` 并标注 `@deprecated`，函数不再读取。

## 修改二：物品详情"实际护甲值"（DetailGenerator.ts ARMOR 段）

### 前后对照

```ts
// 修复前：旧乘法"减伤值"口径
statsLines.push({ text: `基础护甲值: ${item.armor}` });
if (item.enchantment !== 0) {
    const strReq = item.strengthRequired || 12;
    const ne = netEnchant(item.enchantment, playerStrength, strReq);
    const frac = damageFraction(ne);
    const effectiveArmor = Math.round(item.armor * frac);      // ← 乘法
    statsLines.push({
        text: `实际护甲值: ${effectiveArmor} (附魔 ${item.enchantment > 0 ? '+' : ''}${item.enchantment})`,
        ...
```

```ts
// 修复后：CE 加法口径（显示值 = armor + netEnchant，非 ×10 内部值）
const strReq = item.strengthRequired || 12;
const ne = netEnchant(item.enchantment, playerStrength, strReq);
statsLines.push({ text: `基础防御值: ${item.armor}` });
if (ne !== 0 || item.enchantment !== 0) {
    const effectiveArmor = item.armor + ne;                    // ← 加法
    const strengthNote = ne !== item.enchantment ? '，含力量修正' : '';
    statsLines.push({
        text: `实际防御值: ${trimFloatStr(effectiveArmor)} (净附魔 ${signedTrimFloatStr(ne)}${strengthNote})`,
        color: ne > 0 ? '#44ff44' : ne < 0 ? '#ff4444' : undefined
    });
}
```

行为差异（除公式外）：

- 展示行门槛从 `enchantment !== 0` 放宽为 `ne !== 0 || enchantment !== 0`：加法模型下力量不匹配同样改变防御（如 +0 板甲、力量差 1 → 8.5），旧门槛会让玩家看不到这一惩罚。
- 标注从"附魔 +N"（原始附魔）改为"净附魔 ±N（含力量修正）"：展示值由净附魔决定，只标原始附魔会在力量不匹配时与数值自相矛盾。

## 面板显示值前后对照表

### 怪物详情"该怪物有 X% 的概率命中你"（精度 100 的怪物）

| 档位 | 旧面板（把显示值当防御） | 新面板 | 实战真值 `hitProbability(100, playerDefense(...))` |
|---|---|---|---|
| 无甲 | 100% | 100% | **100%** |
| 皮甲+0（3，力=需=10） | 96% | 68% | **68%** |
| 皮甲+3（显示 6，力=需=10） | 96% | 46% | **46%** |
| 板甲+0（11，力=需=19） | 87% | 24% | **24%** |
| 板甲+3（显示 14，力=需=19） | 87% | 16% | **16%** |
| 板甲-2 力量不足（力16<需19，净附魔 -9.5，防御 15） | 87% | 82% | **82%** |
| 皮甲+0 力量盈余（力12>需10，防御 35） | 96% | 63% | **63%** |

旧口径两个荒谬之处均消除：附魔完全不改变面板（皮甲+0 与 +3 同为 96%）、中甲以上长期谎报安全（板甲系显示 87%，实战其实是 16~28%）。

### 物品详情护甲值（对照：旧 `round(armor × 1.065^ne)` vs 新 `armor + netEnchant`）

| 场景 | 旧"实际护甲值" | 新"实际防御值" |
|---|---|---|
| 皮甲+0 力量恰好 | 3 | 3（无修正行，基础行即真值） |
| 皮甲+2 力量恰好 | 3 | 5 |
| 板甲+3 力量恰好 | 13 | 14 |
| 板甲+0 力量不足 1 | 9 | 8.5 |
| 皮甲+1 力量盈余 2 | 3 | 4.5 |
| 鳞甲-2 力量恰好 | 4 | 2 |
| 皮甲-3 力量恰好 | 2 | 0 |

小数说明：力量盈余按 CE 每 +0.25/点 计入净附魔，防御可出现一位小数（4.5、8.5）；显示保留一位小数、净附魔同口径，与 `playerDefense` 既有 float 理想值约定一致（CombatFormulas.ts 注释已记录与 CE 定点截断 ≤0.05 显示点的量化差异）。

## 措辞选择与理由

- `基础护甲值` → **`基础防御值`**；`实际护甲值` → **`实际防御值`**。
- 理由：CE 的底层术语就是 defense（侧栏 "defense"、`player.info.defense`），面板怪物段也已有"防御: N"行；"护甲"指装备物本身，"护甲值"在旧减伤模型语境下暗示"能挡下多少伤害"，正是被废弃的语义。"防御值"准确表达 CE 模型中"降低被命中概率的属性"，且与面板内既有用语统一。`实际防御值` 与武器段的 `实际伤害` 保持同一命名式（基础值 + 你的力量/附魔修正后的实效值）。
- 附注 `净附魔`：值 = 原始附魔 + 力量修正，注明"含力量修正"仅在不等于原始附魔时出现，避免恒定噪音。

## 测试覆盖（新增 `src/test/armor_display_effect.test.ts`，16 条）

1. **物品护甲值口径**（7 组合 × 1 + 1 回归锁）：遍历 (armor, enchantment, strength, strengthRequired) 组合，断言面板数值 = `armor + netEnchant(...)`（显示值口径）；一条显式断言旧乘法值（皮甲+2 → 3）不再出现。
2. **命中率同源（核心断言）**：5 档护甲（无甲 / 皮甲+0 / 板甲+3 / 皮甲+0 力量盈余 / 板甲-2 力量不足）× 精度 {70, 100}，断言面板解析值 === `hitProbability(acc, playerDefense(...))`（真值函数按 `Combat.ts:73-81` 语义建模，含无甲→0 守卫）；另有一条断言旧口径值与真值必然不同，防止回退。
3. **Game 接线**：`createHeadlessGame` 后给玩家穿皮甲+0 / 卸甲，在玩家相邻可见格布置怪物并调 `handleInspectAt`，断言 `inspectTarget` 面板文本与公式真值逐字相等（锁 Game.ts 三元组传参与 `?? 0` 缺省）。

## 其他展示层与战斗口径不一致之处（只列不修）

1. **武器/护甲"物品详情"段的力量需求缺省是 `|| 12`**（DetailGenerator.ts 武器段与护甲段），而实战是 `strengthRequired || 0`（Combat.ts:52/74）。若将来出现无 `strengthRequired` 的装备，物品详情的力量修正会与实战不符。当前 weapons/armors 数据全部带显式需求，无实际影响；护甲详情段本轮未动该缺省（任务边界仅要求改公式与措辞）。
2. **玩家命中行硬编码基础精度 100**（`hitProbability(100, monDef, wNE)`），与 Combat.ts:38 的 `attackerAccuracy = 100` 当前一致；但两处是各自硬编码，将来玩家精度若受状态影响需同步改，属潜在耦合点。
3. **武器"实际伤害"区间的逐端四舍五入**（`round(lo×frac)~round(hi×frac)`）与实战逐次掷骷 `max(1, round(roll×frac))` 存在 ±1 的显示级舍入差，既有限制、影响可忽略。
4. **侧栏（Sidebar.vue）没有任何防御显示**：玩家当前总防御值在常驻 UI 不可见，只能靠检查怪物时反推。属"缺失的展示"而非"错误的展示"——CE 侧栏常驻显示 defense，可作后续补充项。

## 与预设不符之处（只列不修）

1. **行号漂移**：提示词称物品护甲段在 `DetailGenerator.ts:310-321`，实际为 309-336（乘法计算在 314-323）；Game.ts 两处调用点 1136-1147 / 1186-1197 与提示词基本一致。
2. **提示词未提及的第三个偏差**：Game.ts 给占位参数传的 armor strReq 缺省是 `?? 12`，与实战 `|| 0` 不一致。属"参数传递"允许范围，已一并对齐为 `?? 0`（见修改一要点）。
3. **无甲守卫是隐含口径**：提示词只说"在 DetailGenerator 内部调用 playerDefense()"，但机械调用 `playerDefense(0, 0, 力量, 0)` 会因力量盈余产生幻影防御（+0.25×力量，力量 12 → 防御 30）。实战（Combat.ts:73）对无甲完全跳过该公式，面板必须复刻同款守卫才算同源——已实现并有专门测试覆盖。
4. **"皮甲 = 3"的对应力量需求**：armors.json 中皮甲 `strengthRequired` 是 **10**（提示词未涉及，仅备查）；板甲 plate_mail 显示值 11、需求 19，与提示词"板甲 11"一致。
