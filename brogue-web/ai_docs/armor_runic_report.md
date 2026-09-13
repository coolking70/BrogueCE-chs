# 护甲符文触发条件与强度对齐 CE —— 交付报告

日期：2026-09-14
范围：`src/engine/Core/Game.ts`（仅 `tryTriggerArmorRunic` 一处）、`src/engine/Combat/CombatFormulas.ts`（新增强度公式 + 删死代码）；新增 `src/test/armor_runic_effect.test.ts`。
本轮不新增/不删除符文种类（8 种不变）。

## 一、自测结果

### npm test（尾部输出）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  21 passed (21)
      Tests  189 passed | 5 todo (194)
   Start  06:49:36
   Duration 11.91s
```

- 原 177 passed 全部保留，新增 12 个测试（`armor_runic_effect.test.ts`），合计 189 passed、0 failed。
- 5 个 todo 为历史遗留，与本轮无关。

### npm run build（尾部输出）

```
dist/assets/index-BBJVXHf6.js               884.61 kB │ gzip: 280.93 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
...
✓ built in 1.33s
```

构建通过；chunk 体积告警为历史既有现象，与本轮无关。

### git diff --stat

```
 brogue-web/src/engine/Combat/CombatFormulas.ts |  48 +++++++++--
 brogue-web/src/engine/Core/Game.ts             | 114 ++++++++++++++++++-------
 2 files changed, 127 insertions(+), 35 deletions(-)
```

另新增（未跟踪）：`src/test/armor_runic_effect.test.ts`。
未触碰任何禁改文件（Combat.ts / Monster.ts / Player.ts / Item.ts / ItemLoader.ts / DetailGenerator.ts / Architect.ts / Gas.ts / Bolt.ts / src/data/*.json / 既有 .test.ts）；未执行任何 git 写操作。

## 二、八种符文「旧固定概率 → 新 CE 条件」对照表

| 符文 | 旧行为（Game.ts 硬编码） | 新行为（CE 出处） | 本轮改动 |
|---|---|---|---|
| reflection | 受击 22% 概率，近战远程均可，反弹 50% 伤害 | **仅远程**触发（CE reflection 走 `projectileReflects`，Items.c:4969-5000，只作用于投掷物/法术，对近战永不触发）；触发率 `reflectionChance(netEnchant)`（PowerTables.c:109-123） | 触发条件+强度已对齐；反弹量仍为 0.5×（效果差异见第五节） |
| mutuality | 30% 概率，把**全额伤害反弹给攻击者** | **近战恒触发**（无概率判定，Combat.c:976-1024；唯一调用点 Combat.c:1272 在近战 `attack()` 内恒传 `melee=true`）；伤害与相邻敌方均摊 `share = (damage+count)/(count+1)`（C 整数除法），攻击者不计入摊派名单（Combat.c:987），玩家伤害降为 share | 触发条件+强度+效果已对齐 |
| vitality | 15% 概率，给予 15 回合再生 | CE 无 A_VITALITY（web 自创），本轮按要求保留现有行为 | 未改 |
| respiration | 20% 概率，给予燃烧/混乱 1 回合免疫 | CE 语义为毒气/蒸汽**常驻免疫**（Time.c:411-424、Time.c:601-605、Monsters.c:1409-1416、Movement.c:1338-1365），与受击事件无关 | 未改（差距见第四、五节） |
| dampening | 25% 概率，回血 min(伤害,2) | CE 语义为爆炸伤害**常驻吸收**（Time.c:355-367，`T_CAUSES_EXPLOSIVE_DAMAGE` 地形伤害归零），与受击事件无关 | 未改（差距见第四、五节） |
| absorption | 18% 概率，全额免伤 | **近战恒触发**（无概率判定，Combat.c:1026-1035）；每击 `damage -= rand_range(1, armorAbsorptionMax(netEnchant))`（PowerTables.c:107，`max(1, floor(e))`）；仅全额吸收时提示并自动鉴定，部分吸收静默（Combat.c:1030-1034） | 触发条件+强度+鉴定时机已对齐 |
| reprisal | 22% 概率，反弹 75% 伤害 | **仅近战恒触发**（Combat.c:1037-1056，且排除 INANIMATE/INVULNERABLE 攻击者）；反弹 `armorReprisalPercent(netEnchant)%` 伤害（PowerTables.c:106，`max(5, floor(e*5))`），即 `max(1, percent*damage/100)` | 触发条件+强度已对齐 |
| immunity | `randPercent(100)`（恒真），全额抵挡一切伤害 | CE Combat.c:1058-1063：被动常驻、无概率判定，**仅当攻击者属于护甲 vorpalEnemy 类别**时伤害归零；另对该类别投射物必反弹（Items.c:4973-4977） | 移除恒真的 `randPercent(100)`（无行为影响）；类别门因 web 物品无 vorpalEnemy 字段无法落地（见第四节） |

关键架构事实（调查结论）：CE 的 `applyArmorRunicEffect`（Combat.c:896-1090）**只有一个调用点**——近战结算函数 `attack()`（Combat.c:1139）内的 Combat.c:1272，且恒传 `melee=true`。因此 CE 中 mutuality / absorption / reprisal / immunity（negation 分支）都只在**近战受击**时结算；远程/法术伤害只走 `projectileReflects`（reflection / immunity-reflect）。web 侧以攻击者相邻性（Chebyshev ≤1）等价区分近战/远程，与 Monster.ts 两个调用点（近战 dist≤1 / 远程 dist>1）一致。

## 三、强度公式与黄金值（新增于 CombatFormulas.ts）

- `reflectionChance(enchant)` —— PowerTables.c:109-123 逐值移植：内嵌 POW_REFLECT 原表（0.85^x × 65536，x=0.25…50 步进 0.25，共 200 项，与 CE 原表逐数一致），`idx = clamp(trunc(e·4)-1, 0, 199)`，`chance = clamp(100 - trunc(100·表[idx]/65536), 1, 100)`。
  黄金值断言：e=1→16，e=3→39，e=5→56，e=10→81，e=20→97；均与连续闭式 `100*(1-0.85^e)`（15.0/38.6/55.6/80.3/96.1）差 ≤1 个百分点（CE 定点截断+表生成噪声）；钳位断言：e≤0.25→4、e≥49.75→100。
- `armorAbsorptionMax(enchant) = max(1, floor(e))` —— PowerTables.c:107。断言 e ∈ {-20,0,1,1.5,3,5,10,20}。
- `armorReprisalPercent(enchant) = max(5, floor(e*5))` —— PowerTables.c:106。断言 e ∈ {-20,0,1,1.5,3,5,10,20}；e=1.5→7 验证 fixpt 截断语义。
- 三者均吃 `netEnchant`（含力量修正、钳 [-20,50]），与 P1-11 `playerDefense` 同源；取值口径与 Combat.ts:73-78 一致（`strengthRequired || 0`）。
- netEnchant 依赖断言（验收 #3）：同一件 +3 护甲，力量 10（赤字 5）→ netEnchant=-9.5，三曲线全部弱于力量 20 时的取值；实战断言：力量不足的 absorption 每击恰吸收 1 点（absorptionMax 钳下限），50/50 次无空过。
- 恒触发断言（验收 #2）：absorption（100 连击每次必吸收 ≥1 且出现满额）、reprisal（30 连击每次恰反弹 5 点）、mutuality（count=1/2 精确均摊 + count=0 无事发生）均无概率判定；远程路径 30 连击全部不触发（CE 近战门）。

## 四、immunity / respiration / dampening 的 CE 语义调查

### A_IMMUNITY（Combat.c:1058-1063）
- 语义：装备时**被动常驻**。当攻击者属于该护甲生成时指定的 `vorpalEnemy` 怪物类别（`monsterIsInClass`）时，每次伤害直接归零；该类别的投射物则必被反弹（Items.c:4973-4977）。物品描述（Items.c:2761-2763）：「它能完全抵御<某类怪物>的攻击」。无任何概率判定。
- web 对齐程度：**部分对齐**。已移除恒真的 `randPercent(100)`（CE 本就无判定）；但 web 的 `Item` 模型没有 `vorpalEnemy` 字段（全仓 grep 无该字段；Item.ts 本轮禁改），「仅对指定类别生效」这一触发条件无法落地，现保留「对一切攻击者全额抵挡」的旧效果。这是 immunity 与 CE 最大的差距——现行为实际强度远超 CE（CE 相当于对约 1/N 的怪物种类免伤）。
- 建议（后续轮次）：给护甲物品补 `vorpalEnemy` 字段（生成时按 CE 规则从怪物类别中指派），再把本分支的门改成类别判定。

### A_RESPIRATION（Time.c:411-424、Time.c:601-605、Monsters.c:1409-1416、Movement.c:1338-1365）
- 语义：装备时对 `T_RESPIRATION_IMMUNITIES` 地形（毒气、蒸汽）**常驻免疫**——站在毒气里不掉血、不中毒/麻痹/混乱，且现身的警示确认也被跳过。与「受击」完全无关，无概率判定。物品描述：「它会在你周围维持一层清新空气，使你免疫蒸汽和所有毒气的影响」。
- web 对齐程度：**未对齐**。web 现实现是「受击时 20% 概率获得燃烧/混乱各 1 回合免疫」——触发事件（受击）与效果（状态免疫）都不是 CE 的语义；CE 的挂点在毒气/蒸汽结算（web 侧对应 Gas.ts/地形结算，本轮禁改）。按「差距过大、超出触发条件范畴」条款，本轮保留现有行为、只列入报告。

### A_DAMPENING（Time.c:355-367）
- 语义：装备时**常驻吸收爆炸冲击**——处于 `T_CAUSES_EXPLOSIVE_DAMAGE` 地形（如沼泽爆炸、爆炸陷阱）时伤害归零并提示「Your armor pulses and absorbs the damage.」+自动鉴定。但你仍可能被爆炸**点燃**（描述：「但你仍可能被灼伤」）。与「受击」无关，无概率判定，也不回血。
- web 对齐程度：**未对齐**。web 现实现是「受击时 25% 概率回血 min(伤害,2)」。CE 挂点在爆炸伤害结算（web 侧对应 Gas.ts/爆炸路径，本轮禁改）。同上，保留现有行为、只列入报告。另注意 Game.ts:3268 处已有一个 dampening 对负面状态时长 -1 的 web 自创挂钩，本轮未动。

## 五、效果语义与 CE 有差距但本轮未改的项（只列不修）

1. **reflection 反弹量**：web 反弹 0.5× 伤害；CE 是「偏转 reflectChance% 的来袭法术（偏转者不受伤害），其中 chance²/100% 反弹回施法者且吃满法术伤害」（Items.c:2766-2785 描述、Bolt 反射逻辑）。web 的一次性 0.5× 反弹是简化模型。
2. **reflection 的挂点**：CE 挂在投射物/法术命中（`projectileReflects`，含 MONST_REFLECT_50 怪 +4 等级、MA_REFLECT_100 恒反）；web 的远程攻击是 `CombatSystem.attack` 的射击，非 bolt 系统，只能以「远程路径」近似。
3. **immunity 缺 vorpalEnemy 类别门**（见第四节）——现为对一切攻击者全额抵挡，强度远超 CE。
4. **respiration / dampening 效果整体不是 CE 的效果**（见第四节），且 Game.ts:3268 的 dampening 状态时长 -1 为 web 自创。
5. **mutuality 的摊派对象判定**：web 以 `hp>0 && !isAlly && !MONST_IMMUNE_TO_WEAPONS && !MONST_INVULNERABLE && 相邻` 近似 CE 的 hitList（Combat.c:987-995）；CE 另排除 `MB_IS_DYING`、`MONST_INVULNERABLE` 等，语义对齐但怪物能力位图不如 CE 完整。
6. **reprisal/absorption 的结算模型**：web 是「伤害先落地、符文回补/反伤」，CE 是「结算前扣减 `*damage`」。对玩家净伤等价；但 CE 的 absorption 反过来也会减少「基于本次伤害」的后续结算（如 on-hit 状态的触发不受影响，此项差异可忽略）。
7. **CE 另有 5 种护甲符文 web 均无**（见第六节清单）；CE 负附魔护甲（如 reflection 负等级会偏转**自己**的法术，Items.c:2774-2785）的负面用法 web 也未建模。

## 六、vitality（web 自创）与缺失符文清单（只列，本轮不动种类）

- **vitality（web 自创）**：CE 无 `A_VITALITY`（Rogue.h:860-873 的枚举中不存在，parity_gap_analysis.md §10.3 同结论）。现行为：受击 15% 概率获得 15 回合再生。本轮按要求原样保留。
- **web 缺失的 CE 良性符文（1 种）**：
  - `A_MULTIPLICITY`（镜像）：受击 33% 概率（固定值，CE 唯一保留概率判定的良性护甲符文，Combat.c:921-974）克隆攻击者为友方幽灵影像，数量 `armorImageCount(e) = clamp(e/3, 1, 5)`（PowerTables.c:108）。
- **web 缺失的 CE 有害符文（3 种，Rogue.h:871-874）**：
  - `A_BURDEN`（负重）：受击 10% 概率永久 +1 力量需求（Combat.c:1064-1070）；
  - `A_VULNERABILITY`（脆弱）：受击伤害 ×2（Combat.c:1072-1078）；
  - `A_IMMOLATION`（自燃）：受击 10% 概率在玩家脚下爆出火焰地形（Combat.c:1080-1089）。

## 七、与预设不符之处（只列不修；含提示词本身的偏差）

1. **「CE 根本没有统一触发率」的表述需加注**：CE 确实没有统一公式，但也没有「每种符文一个触发率」——`applyArmorRunicEffect` 只有 reflection/immunity 之外的分支根本不掷骰，且**唯一调用点在近战 `attack()` 内（Combat.c:1272，恒传 `melee=true`）**。故 mutuality/absorption/reprisal/immunity(negation) 全部只在近战受击时结算，远程伤害完全不进这个 switch。本报告第三节对照表与实现均按此口径。
2. **提示词对 reflection 的公式描述是连续近似**：`clamp(100*(1-0.85^e), 1, 100)` 为闭式近似；CE 真实实现是 POW_REFLECT 定点表 + 截断（e=1 时 CE 给 16 而非 15，e=10 给 81 而非 80.3 取整后也有偏差）。已按仓库既有惯例（武器符文 P1-10 内嵌原表）实现 CE-exact 版本，与闭式差 ≤1 个百分点，测试同时断言两者。
3. **提示词的 `armorReprisalPercent(e) = max(5, floor(e)*5)` 写法与 CE 不同**：CE 是 `max(5, (int)(e*5))`（fixpt 截断，即 `floor(e*5)`）。整数附魔下两者一致（验收点 e=1/3/5/10/20 均满足）；分数附魔下不同（e=1.5：CE=7，提示词写法=5）。已按 CE 实现 `max(5, floor(e*5))`。
4. **`armorAbsorptionMax` 的 CE 分母语义**：CE 公式为 `max(1, (int)(enchant/FP_FACTOR))`，对负附魔也是钳到 1（而非 0 或负值）——与提示词一致，仅注明 C 侧 `enchant` 为 fixpt。
5. **提示词引用行号微偏**：`monst != attacker` 在 Combat.c:987（提示词语境无行号，此处仅备案）；POW_REFLECT 表体在 PowerTables.c:110-119（函数签名 109、索引计算 121-122）；`armorImageCount` 在 PowerTables.c:108。A_IMMUNITY 分支为 Combat.c:1058-1063。
6. **web 的 `immunity` 旧注释「blocks a specific monster type」与实际行为不符**（实为挡下一切），本轮仅移除恒真判定，未改行为。
7. **Game.ts:3268 还有一处 dampening 挂钩**（负面状态时长 -1），不属于「护甲符文那几处 if」，CE 亦无对应语义，按边界未动。

## 八、变更文件清单

- `src/engine/Combat/CombatFormulas.ts`：删除死代码 `runicArmorChance`（删除前全仓确认无调用）；新增 `armorReprisalPercent` / `armorAbsorptionMax` / `reflectionChance`（内嵌 POW_REFLECT 原表）。
- `src/engine/Core/Game.ts`：`tryTriggerArmorRunic` 重写为 CE 条件/强度（近战门 + netEnchant + 恒触发 + 精确均摊/反弹公式）；import 扩充 4 个公式函数。其余分支（vitality/respiration/dampening）逐字保留。
- `src/test/armor_runic_effect.test.ts`（新增）：黄金值、恒触发、近战门、netEnchant 依赖、死代码删除共 12 项断言。
