# 武器符文触发率：线性近似 → CE 真实公式（交付报告）

日期：2026-09-14
范围：`src/engine/Combat/CombatFormulas.ts`（核心）、`src/engine/Combat/Combat.ts`（仅接线）、
`src/engine/Combat/CombatFormulas.test.ts`（仅 runicWeaponChance 的 it.todo 落地）
CE 基线：`BrogueCE-master/src/brogue/PowerTables.c:220-345`（`runicWeaponChance`）、
`Combat.c:76-83`（`netEnchant`）、`Combat.c:660-677`（触发与背刺加倍调用点）、
`Rogue.h:99-101 / 835-846 / 1376-1378`、`Globals.c:1582-1603`（weaponTable）

---

## 1. 实现摘要

`runicWeaponChance(enchantment, runicKind?, weapon?)` 由线性近似 `clamp(7 + 4·ench, 3, 90)`
替换为 PowerTables.c:220-345 的逐值移植：

1. **按符文种类取各自的 (1-p)^x 定点递减表**（201 项，x 以 0.25 附魔点步进、范围 [0,50]），
   五张表**原样内嵌**（POW_16/POW_6/POW_7/POW_11/POW_15，与 CE 原表逐数一致，
   含 CE 生成时 ≤1/65536 的噪声），不使用运行时 `Math.pow`。
2. **高伤武器惩罚**：`adjustedBaseDamage = (range.lowerBound + range.upperBound) / 2`
   （C 整数除法），`modifier = 1 - min(0.99, adjustedBaseDamage/18)`（定点截断复刻）。
3. **查表**：`tableIndex = enchantLevel·modifier·4 / FP / FP` 两级整数截断后钳 [0,200]，
   `chance = 100 - 表值/FP`。
4. **攻速修正**：STAGGER（迟滞）伤害折半 + 触发率 `1-(1-c)²`；QUICKLY（迅捷）触发率
   `1-√(1-c)`。注意 CE 源码 317-319 行已把"迅捷武器伤害加倍"**注释停用**
   （"Testing disabling this for balance reasons"），实现如实保留该不对称。
5. **下限**：`clamp(chance, max(1, e), 100)`——负附魔与 0 附魔返回 1 而非 0（见 §8.2）。
6. **slaying → 0**、**有害/表外符文 → 固定 15**（PowerTables.c:300-305）。

与连续闭式公式 `100·(1-(1-p)^(e·modifier))` 的唯一差异是 CE 表下标的 0.25 量化
（全参数域实测最大 3.07 个百分点），测试中以 ≤3.5pp 的等价界断言（CombatFormulas.test.ts
"与闭式公式一致"用例），黄金值本身则与 CE 表逐值相等。

### 接线变化（Combat.ts，仅限新签名）

- 传参 `weaponEnchant`（= `netEnchant(...)`，含力量修正、钳 [-20,50]）而非原先的面板附魔。
  依据：PowerTables.c:306-308 内部取 `netEnchant(theItem)`（Combat.c:76-83：附魔 + 力量
  修正后钳 [-20,50]）。**行为影响**：力量盈余会提高触发率、力量欠缺降低之（旧实现完全
  不看力量）。
- 新增第三参 `{ damageMin: parts.min, damageMax: parts.max }`——复用函数内已解析的
  `parseDamageString` 结果，未对字符串做任何正则取数。web 的 `XdY+Z` 记法解析出的
  {min,max} 与 CE Globals.c weaponTable 的 range 逐武器一致（P1-7 已校准，抽样核对：
  dagger {3,4}、rapier {3,5}、mace {16,20}、war hammer {25,35}、dart {2,4} 等）。

---

## 2. 验收自测输出

### npm test（尾部）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web


 Test Files  20 passed (20)
      Tests  177 passed | 5 todo (182)
   Start at  06:21:26
   Duration  11.79s (transform 1.38s, setup 0ms, import 2.47s, tests 22.81s, environment 4ms)
```

原有 166 passed **无一减少**（177 = 166 + 11 个由 it.todo 落地及新增的 runicWeaponChance
用例；todo 由 6 → 5，减少的正是已落地的 runicWeaponChance 占位）。

### npm run build（尾部）

```
dist/assets/Filter-BqUw-IZz.js                0.90 kB │ gzip:   0.48 kB
dist/assets/BufferResource-DPDso6sV.js       10.60 kB │ gzip:   2.79 kB
dist/assets/webworkerAll-BT-9wKAT.js         11.88 kB │ gzip:   3.94 kB
dist/assets/CanvasRenderer-DCDU4G7J.js       22.67 kB │ gzip:   7.09 kB
dist/assets/WebGPURenderer-Bfx9lp1i.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-BU4pgbvp.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-C2FVxUeG.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-BgNJJ3NC.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-DJSDOeNO.js               882.87 kB │ gzip: 280.63 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration/options/#output-manualchunks
- Adjust chunk size limit to this warning via build.chunkSizeWarningLimit.
✓ built in 1.35s
```

（chunk 体积警告为既有状态，与本次改动无关；`vue-tsc -b` 类型检查通过。）

### git diff --stat

```
 brogue-web/src/engine/Combat/Combat.ts             |  11 +-
 brogue-web/src/engine/Combat/CombatFormulas.test.ts| 116 +++++++++++-
 brogue-web/src/engine/Combat/CombatFormulas.ts     | 203 ++++++++++++++++++++-
 3 files changed, 318 insertions(+), 12 deletions(-)
```

仅触碰允许清单内的三个文件；未新增符文种类、未改任何符文效果实现、未动 src/data/。

---

## 3. 新旧触发率对照表（百分比）

旧 = `clamp(7+4·ench, 3, 90)`；新 = CE 表逐值。**粗体**为按本轮口径的处理结果。

### 匕首（低伤，adj=3，modifier=5/6）+ speed（p=0.16）

| 附魔 | 0 | 1 | 2 | 3 | 4 | 5 | 7 | 10 | 15 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| 旧 | 7 | 11 | 15 | 19 | 23 | 27 | 35 | 47 | 67 | 87 |
| 新 | **1** | 13 | 24 | 36 | 44 | 51 | 64 | 77 | 89 | 95 |

低伤武器在高附魔下显著更快（e≥3 时 +13～+17pp），0/负附魔从 7 降到下限 1。

### 战锤（高伤，adj=30，modifier=0.01）+ speed

| 附魔 | 0 | 1 | 2 | 3 | 4 | 5 | 7 | 10 | 15 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| 旧 | 7 | 11 | 15 | 19 | 23 | 27 | 35 | 47 | 67 | 87 |
| 新 | **1** | **1** | **2** | **3** | **4** | **5** | **7** | **10** | **15** | **20** |

高伤武器原始查表值≈0，实际触发率几乎完全由下限 `max(1, e)` 决定（恰好 = 附魔数）。
旧公式对武器伤害完全不敏感——这是两者最大的行为分野：同样的 +10 附魔，匕首 77% vs
战锤 10%。

### 匕首 + quietus（p=0.06）

| 附魔 | 0 | 1 | 2 | 3 | 4 | 5 | 7 | 10 | 15 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| 旧 | 7 | 11 | 15 | 19 | 23 | 27 | 35 | 47 | 67 | 87 |
| 新 | **1** | 5 | 9 | 15 | 19 | 22 | 30 | 40 | 54 | 64 |

### 匕首 + 其他种类（抽样）

| 符文 | p | e=1 | e=4 | e=7 | e=10 |
|---|---|---|---|---|---|
| paralyzing（POW_7） | 0.07 | 6 | 22 | 35 | 46 |
| confusion（POW_11） | 0.11 | 9 | 32 | 51 | 61 |
| force（POW_15） | 0.15 | 12 | 40 | 58 | 71 |
| slaying | — | 0 | 0 | 0 | 0 |
| mercy / vampirism / venom | — | **15** | **15** | **15** | **15** |

（旧公式不区分种类，一律 11/23/35/47。）

---

## 4. web 已有符文的映射与 CE 无对应符文的处置

ItemLoader.spawnWeapon（ItemLoader.ts:356）的符文池实际为 **9 种**：

| web 符文名 | 本轮触发率口径 | 依据/理由 |
|---|---|---|
| speed | POW_16（p=0.16） | CE W_SPEED（PowerTables.c:285） |
| quietus | POW_6（p=0.06） | CE W_QUIETUS（:286） |
| paralyzing | POW_7（p=0.07） | CE W_PARALYSIS（:287）；web 命名不同但同物，且 Game.ts 有对应麻痹效果实现 |
| confusion | POW_11（p=0.11） | CE W_CONFUSION（:290） |
| force | POW_15（p=0.15） | CE W_FORCE（:291） |
| slaying | 恒 0 | CE W_SLAYING：非概率触发（:300-302） |
| mercy | 固定 15 | CE W_MERCY 即**有害符文**（Rogue.h:844，`NUMBER_GOOD_WEAPON_ENCHANT_KINDS` 从它起算），CE 对有害符文一律返回 15（:303-305）——web 的 mercy 直接套用 CE 原位口径 |
| vampirism | 固定 15 | **web 自创、CE 无此符文**，无 (1-p)^x 表可查。可选口径只有三种：虚构一条概率曲线（等于发明新机制）、按"最强符文"取表（凭空加强）、按 CE"表外符文"固定 15。取第三种：它是 CE 代码中唯一"无表符文"的既定处理，且不引入任何 CE 不存在的数值曲线 |
| venom | 固定 15 | 同 vampirism（web 自创，CE 无对应；见 §8.1——提示词未列此符文） |

未提供 `runicKind` 的单参兼容形态（既有 armor_model_effect.test.ts:168 的调用）同按
"表外 → 15"处理，理由相同：没有类别信息就不能虚构概率曲线。

## 5. 缺失符文与语义偏差清单（只列不修）

**CE 有、web 无的武器符文（2 种，提示词说 3 种，见 §8.1）：**

| CE 符文 | 表 | 说明 |
|---|---|---|
| W_MULTIPLICITY | POW_15 | 触发时分裂怪物镜像；web 无此机制 |
| W_SLOWING | POW_14 | 即 CE 的 slowing 符文；web 无。本轮连 POW_14 表也按边界未移植 |

**web 有、CE 无（2 种）**：vampirism、venom（口径见 §4）。

**语义偏差（效果层，本轮不动）：**

- **mercy**：CE = 治疗**被击中的怪物**所受伤害的 50%（Combat.c:845
  `heal(defender, gameConst->onHitMercyHealPercent)`，常量 = 50，Rogue.h:2399 注释
  "percentage of damage healed on-hit"）；web = 把怪物留到 1 HP。提示词"治疗被击中的
  敌人 50% 生命"亦不精确——是伤害量的 50%，非最大生命的 50%。
- **vampirism**：CE 无此符文（web = 命中吸血 50%，类似 CE 吸血鬼怪物的机制嫁接到武器）。
- **venom**：CE 无此武器符文（web = 追加毒伤；CE 的毒来自 gas/怪物，不是符文）。
- **speed**：CE 触发效果 = 给玩家**免费一回合**（Combat.c:701-709
  `player.ticksUntilTurn = -1 // free turn!`）；web = 追加一次等伤打击。语义实质不同。
- **slaying**：CE = 仅对本局随机指定的 vorpal 敌人类别必杀（Combat.c:669-671
  `monsterIsInClass(defender, theItem->vorpalEnemy) ? 100 : 0`）；web = 无条件即杀
  （takeDamage(9999)）。强得多且没有类别限制。
- **quietus**：CE = 即死（带 flare 与不死系豁免等判定）；web = takeDamage(9999)，
  对超高血量目标理论上可存活，工程上近似。

## 6. ITEM_ATTACKS_STAGGER / ITEM_ATTACKS_QUICKLY 在 web 的对应情况

**web 无等价标志。** 核查范围：`src/data/weapons.json` 全部条目（字段仅 id/name/
strengthRequired/damage/weight/description，dart 另有 source 注记）、
`ItemLoader.spawnWeapon`（只装载上述字段）、`Item.ts`（无 flags 类字段）。因此：

- 两条攻速修正**当前对所有武器不生效**（`attacksStagger`/`attacksQuickly` 均不会被置位）；
- CE 语义中 mace/hammer 为 STAGGER（Rogue.h:1376）、rapier 为 QUICKLY（:1378）——
  web 的 mace、war_hammer、rapier 描述文案虽提到"命中后需要额外一回合恢复"/"攻击速度
  是其他武器的两倍"，但数据层无对应标志；
- 公式已按 CE 完整实现这两个分支（含 STAGGER 的伤害折半与 1-(1-c)²、QUICKLY 的
  1-√(1-c)），测试用合成上下文锁住黄金值（mace+STAGGER e4 = 51；rapier+QUICKLY e4 = 23），
  将来数据层补标志时无需再动公式。按边界要求，未为此改任何武器数据。

## 7. 背刺加倍确认

CE Combat.c:673-677：`chance = runicWeaponChance(...); if (backstabbed && chance < 100)
chance = min(chance*2, (chance+100)/2);`——加倍作用在 `runicWeaponChance` 的**返回值**上。

web Combat.ts 接线后结构相同：`const triggerChance = runicWeaponChance(净附魔, 符文, 武器)`
→ `if (backstab && adjustedChance < 100) adjustedChance = Math.min(adjustedChance*2,
Math.floor((adjustedChance+100)/2))`。加倍**正确作用于新公式的结果**（含高伤武器被下限
抬升后的值与有害/表外符文的 15 → 30）。CE 中 slaying 不参与加倍（走独立分支），web 侧
slaying 返回 0，加倍后仍为 0，行为等价。

## 8. 与预设不符之处（只列不修，含提示词本身的出入）

1. **web 符文种类是 9 种，不是提示词说的 7 种**。ItemLoader.spawnWeapon 的池子是
   `['paralyzing','venom','quietus','vampirism','speed','confusion','force','slaying','mercy']`。
   提示词所列"缺失 3 种：paralysis、multiplicity、slowing"中，**paralysis 其实已存在**
   （名为 `paralyzing`，Game.ts:3457 有完整麻痹效果），本轮已按 CE POW_7 接入公式；
   真正缺失的是 **multiplicity 与 slowing** 两种。venom 则是提示词完全未提到的第 9 种。
2. **验收预设"负附魔→0"与 CE 不符**。CE PowerTables.c:323-324 确实先归零，但 :342 行
   末尾下限 `clamp(chance, max(1, e), 100)` 把结果抬到 **1**（0 附魔同理返回 1）。
   实现与测试均以 CE 为准（负附魔 → 1），测试注释已注明该出入。
3. **提示词"mercy 治疗 50% 生命"不够精确**：CE 治疗的是所受**伤害**的 50%
   （Rogue.h:2399），非最大生命的 50%。
4. **CombatFormulas.ts 旧文件头注释称 FP_FACTOR=1000**，实际为 `1<<16 = 65536`
   （Rogue.h:99-101）。已顺手修正该注释（CombatFormulas.ts 内，非行为变更）。
5. **旧调用点传面板附魔而非净附魔**（Combat.ts 原 `runicWeaponChance(enchant)` 用
   `equippedWeapon.enchantment`）。CE 公式内部取 netEnchant（含力量修正），接线时已改传
   `weaponEnchant`——这是"接上新签名"的一部分，但行为上意味着力量修正从此影响触发率。
6. **提示词第 3 条未提 CE 的 QUICKLY 伤害加倍被注释停用一事**（PowerTables.c:317-319）。
   实现已按 CE 保留该不对称（只有 STAGGER 折半伤害），供后续若 web 补攻速标志时参照。
7. 提示词所列 5 张表与符文的对应关系（POW_16/6/7/15/14/11 → 各符文、W_PLENTY 无表）
   **核对无误**； harmful 判定边界 `runicType >= NUMBER_GOOD_WEAPON_ENCHANT_KINDS`
   （= W_MERCY，Rogue.h:844）亦核对无误。slaying 在枚举上位于"好符文"段但提前返回 0，
   与提示词描述一致。

## 9. 测试落地清单（CombatFormulas.test.ts，原 it.todo → 9 个用例）

1. 匕首+speed 黄金值（6 档附魔，注明表下标与表值，PowerTables.c:221-230、311-328）
2. 战锤+speed 黄金值（高伤惩罚 + 下限抬升）
3. quietus 黄金值（POW_6）
4. paralyzing / confusion / force 各表抽样黄金值
5. 与闭式公式 `100·(1-(1-p)^(e·modifier))` 的等价界（5 符文 × 4 武器 × e∈[0,50] 全扫描，
   ≤3.5pp——CE 表 0.25 量化的理论上界内）
6. slaying 恒 0（含 0/负附魔边界）
7. 有害/表外符文固定 15（mercy/vampirism/venom/multiplicity/slowing/无类别单参形态）
8. 负附魔与 0 附魔 → 1（注明与任务预设的出入，见 §8.2）
9. STAGGER/QUICKLY 合成上下文黄金值 + 无武器上下文不抛错
