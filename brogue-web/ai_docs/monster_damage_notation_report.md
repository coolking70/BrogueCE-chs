# monsters.json damage 记法对齐 CE — 交付报告

日期：2026-09-14
范围：`src/data/monsters.json`（数据修正）+ `src/data/monsterDamage.test.ts`（新增）+ `src/test/monster_damage_balance.test.ts`（新增）。未触碰任何引擎文件与既有测试，未执行任何 git 写操作。

---

## 1. 缺陷与语义回顾

- `CombatSystem.parseDamageString`（`src/engine/Combat/Combat.ts:180`）是**掷骰记法**：
  `"XdY"` → `{min: X, max: X*Y, clumping: X}`；`"XdY+Z"` → `{min: X+Z, max: X*Y+Z, clumping: X}`。
- CE 的 `damage` 是 `randomRange{min,max,clumpFactor}`，`{9,13,2}` 就是字面 **9~13**。
- monsters.json 原先把 CE 的 `{min,max}` 直接写成 `"MINdMAX"`，于是解析出的 max 被
  乘上了骰子面数（如 ogre `"9d13"` → 9~117），怪物伤害被严重放大（玩家仅 30 HP）。
- 修法：非 {0,0,0} 条目统一改 `"1dN+M"`，其中 `N = max−min+1`、`M = min−1`，
  解析结果 `min = 1+M`、`max = N+M` 与 CE 完全一致（clumping = 1）。

## 2. 提取方法与自检锚点核对

- 权威来源：`BrogueCE-master/src/brogue/Globals.c` 的 `creatureType monsterCatalog[]`
  （数组声明 L1025；玩家 `"you"` 为 L1027 首条、非怪物；67 只怪物条目分布在
  L1030..L1163；字段序依 `Rogue.h:2172` 的 `creatureType`）。
- 逐条提取 `damage{min,max,clumpFactor}`，与 monsters.json 现值按掷骰语义解析出的
  min/max 比对。**独立核算结果与自检锚点完全一致**：
  - CE damage 非 {0,0,0} 且与 web 现值不一致：**43 条**
  - CE damage 为 {0,0,0}：**12 条**
  - 合计需改动 **55 条**；另有 **12 条**现值本就正确（含 CE {1,1} 的 spectral
    blade/sword），无需改动。
  - 校验恒等式：43 + 12 + 12 = 67 ✓
- 附带印证：对 43 条不一致项计算「旧期望/新期望」比值（均匀分布期望 = (min+max)/2，
  clumping=1 时 `clumpedRoll` 即 `randRange`），均值 = **4.441**，与任务提示的
  「修复前怪物伤害平均放大 4.4 倍」精确吻合——双向印证提取无误。

## 3. 完整改动清单（55 条）

新解析 = `CombatSystem.parseDamageString(新记法)` 的结果；行号为 Globals.c monsterCatalog 表体。

| 怪物 id | 旧记法 | 旧解析 min~max | 新记法 | 新解析 min~max | CE min~max | 行号 |
|---|---|---|---|---|---|---|
| jackal | 2d4 | 2~8 | 1d3+1 | 2~4 | 2~4 | L1032 |
| eel | 3d7 | 3~21 | 1d5+2 | 3~7 | 3~7 | L1033 |
| bloat | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1037 |
| pit_bloat | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1039 |
| goblin | 2d5 | 2~10 | 1d4+1 | 2~5 | 2~5 | L1041 |
| goblin_conjurer | 2d4 | 2~8 | 1d3+1 | 2~4 | 2~4 | L1043 |
| goblin_mystic | 2d4 | 2~8 | 1d3+1 | 2~4 | 2~4 | L1045 |
| goblin_totem | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1047 |
| vampire_bat | 2d6 | 2~12 | 1d5+1 | 2~6 | 2~6 | L1053 |
| arrow_turret | 2d6 | 2~12 | 1d5+1 | 2~6 | 2~6 | L1055 |
| centipede | 4d12 | 4~48 | 1d9+3 | 4~12 | 4~12 | L1059 |
| ogre | 9d13 | 9~117 | 1d5+8 | 9~13 | 9~13 | L1061 |
| bog_monster | 3d4 | 3~12 | 1d2+2 | 3~4 | 3~4 | L1063 |
| ogre_totem | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1065 |
| spider | 3d4 | 3~12 | 1d2+2 | 3~4 | 3~4 | L1067 |
| spark_turret | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1069 |
| wisp | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1071 |
| wraith | 6d13 | 6~78 | 1d8+5 | 6~13 | 6~13 | L1073 |
| zombie | 7d12 | 7~84 | 1d6+6 | 7~12 | 7~12 | L1075 |
| troll | 10d15 | 10~150 | 1d6+9 | 10~15 | 10~15 | L1076 |
| ogre_shaman | 5d9 | 5~45 | 1d5+4 | 5~9 | 5~9 | L1078 |
| naga | 7d11 | 7~77 | 1d5+6 | 7~11 | 7~11 | L1080 |
| salamander | 5d11 | 5~55 | 1d7+4 | 5~11 | 5~11 | L1082 |
| explosive_bloat | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1084 |
| dar_blademaster | 5d9 | 5~45 | 1d5+4 | 5~9 | 5~9 | L1086 |
| dar_priestess | 2d5 | 2~10 | 1d4+1 | 2~5 | 2~5 | L1088 |
| acidic_jelly | 2d6 | 2~12 | 1d5+1 | 2~6 | 2~6 | L1092 |
| centaur | 4d8 | 4~32 | 1d5+3 | 4~8 | 4~8 | L1094 |
| underworm | 18d22 | 18~396 | 1d5+17 | 18~22 | 18~22 | L1096 |
| sentinel | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1098 |
| kraken | 15d20 | 15~300 | 1d6+14 | 15~20 | 15~20 | L1102 |
| lich | 2d6 | 2~12 | 1d5+1 | 2~6 | 2~6 | L1104 |
| phylactery | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1106 |
| phantom | 12d18 | 12~216 | 1d7+11 | 12~18 | 12~18 | L1110 |
| imp | 4d9 | 4~36 | 1d6+3 | 4~9 | 4~9 | L1114 |
| fury | 6d11 | 6~66 | 1d6+5 | 6~11 | 6~11 | L1116 |
| revenant | 15d20 | 15~300 | 1d6+14 | 15~20 | 15~20 | L1118 |
| tentacle_horror | 25d35 | 25~875 | 1d11+24 | 25~35 | 25~35 | L1120 |
| golem | 4d8 | 4~32 | 1d5+3 | 4~8 | 4~8 | L1121 |
| dragon | 25d50 | 25~1250 | 1d26+24 | 25~50 | 25~50 | L1123 |
| goblin_warlord | 3d6 | 3~18 | 1d4+2 | 3~6 | 3~6 | L1127 |
| black_jelly | 3d8 | 3~24 | 1d6+2 | 3~8 | 3~8 | L1129 |
| vampire | 4d15 | 4~60 | 1d12+3 | 4~15 | 4~15 | L1131 |
| flamedancer | 3d8 | 3~24 | 1d6+2 | 3~8 | 3~8 | L1133 |
| stone_guardian | 12d17 | 12~204 | 1d6+11 | 12~17 | 12~17 | L1141 |
| winged_guardian | 12d17 | 12~204 | 1d6+11 | 12~17 | 12~17 | L1143 |
| guardian_spirit | 5d12 | 5~60 | 1d8+4 | 5~12 | 5~12 | L1145 |
| Warden_of_Yendor | 12d17 | 12~204 | 1d6+11 | 12~17 | 12~17 | L1147 |
| eldritch_totem | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1149 |
| mirrored_totem | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1151 |
| unicorn | 2d10 | 2~20 | 1d9+1 | 2~10 | 2~10 | L1155 |
| ifrit | 5d13 | 5~65 | 1d9+4 | 5~13 | 5~13 | L1157 |
| phoenix | 4d10 | 4~40 | 1d7+3 | 4~10 | 4~10 | L1159 |
| phoenix_egg | 1d1 | 1~1 | 0d1 | 0~0 | 0~0 | L1161 |
| mangrove_dryad | 2d8 | 2~16 | 1d7+1 | 2~8 | 2~8 | L1163 |

每条新记法均经脚本验算 + 测试断言双重核对（见 §6），非凭空填写。
说明：表中 43 条非零项全部改为 `1dN+M`；12 条 {0,0,0} 项改为 `0d1`。

### 未改动的 12 条（现值已与 CE 一致，保持原记法）

| 怪物 id | 现记法 | 解析 min~max | CE min~max | 行号 |
|---|---|---|---|---|
| rat | 1d3 | 1~3 | 1~3 | L1030 |
| kobold | 1d4 | 1~4 | 1~4 | L1031 |
| monkey | 1d3 | 1~3 | 1~3 | L1035 |
| pink_jelly | 1d3 | 1~3 | 1~3 | L1049 |
| toad | 1d4 | 1~4 | 1~4 | L1051 |
| acid_mound | 1d3 | 1~3 | 1~3 | L1057 |
| dar_battlemage | 1d3 | 1~3 | 1~3 | L1090 |
| dart_turret | 1d2 | 1~2 | 1~2 | L1100 |
| pixie | 1d3 | 1~3 | 1~3 | L1108 |
| flame_turret | 1d2 | 1~2 | 1~2 | L1112 |
| spectral_blade | 1d1 | 1~1 | 1~1 | L1137 |
| spectral_sword | 1d1 | 1~1 | 1~1 | L1139 |

这 12 条的原生 `1dN` 与 `1dN+0` 语义完全相同（M = min−1 = 0），故保留原记法。

## 4. clumpFactor 差异清单（27 条，只列不修）

`"1dN+M"` 记法解析出的 clumping 恒为 1；以下条目 CE 的 clumpFactor ≠ 1，
本任务不表达（`Combat.attack` 也未消费该值，见 §8 第 3 条）：

| 怪物 id | CE min~max | CE clumpFactor | 行号 |
|---|---|---|---|
| eel | 3~7 | 2 | L1033 |
| ogre | 9~13 | 2 | L1061 |
| spider | 3~4 | 2 | L1067 |
| wraith | 6~13 | 2 | L1073 |
| troll | 10~15 | 3 | L1076 |
| naga | 7~11 | 4 | L1080 |
| salamander | 5~11 | 3 | L1082 |
| dar_blademaster | 5~9 | 2 | L1086 |
| centaur | 4~8 | 2 | L1094 |
| underworm | 18~22 | 2 | L1096 |
| kraken | 15~20 | 3 | L1102 |
| phantom | 12~18 | 4 | L1110 |
| imp | 4~9 | 2 | L1114 |
| fury | 6~11 | 4 | L1116 |
| revenant | 15~20 | 5 | L1118 |
| tentacle_horror | 25~35 | 3 | L1120 |
| dragon | 25~50 | 4 | L1123 |
| vampire | 4~15 | 2 | L1131 |
| flamedancer | 3~8 | 2 | L1133 |
| stone_guardian | 12~17 | 2 | L1141 |
| winged_guardian | 12~17 | 2 | L1143 |
| guardian_spirit | 5~12 | 2 | L1145 |
| Warden_of_Yendor | 12~17 | 2 | L1147 |
| unicorn | 2~10 | 2 | L1155 |
| ifrit | 5~13 | 2 | L1157 |
| phoenix | 4~10 | 2 | L1159 |
| mangrove_dryad | 2~8 | 2 | L1163 |

clumpFactor 影响的是伤害分布的聚拢程度（多骰求和 vs 单骰均匀），不影响 min/max
边界；若未来让 `Combat.attack` 消费 clumping，需要数据侧配合换成可表达 clump
的记法（或在 Monster 上加结构化字段），届时应以本表为清单。

## 5. {0,0,0} 条目的处理说明与风险确认（12 条）

- CE 中 `damage = {0,0,0}` 表示该怪物**没有近战攻击**（bloat 系自爆、图腾/哨兵/
  护符/蛋等纯机关体、spark turret 与 wisp 只用法术/灼烧）。web 侧原占位 `"1d1"`
  会让它们「近战 1 点」，与 CE 不符。
- 现改为 `"0d1"`：解析为 `{min: 0, max: 0, clumping: 0}`。
- **异常安全性（已逐点确认）**：
  - `clumpedRoll(0,0,0)`（CombatFormulas.ts:104）：`clumping <= 1 || min >= max`
    短路 → `rollFn(0,0)` → `rng.randRange(0,0)`（Random.ts:97-100）：
    `upperBound <= lowerBound` 直接返回 0，**不消耗 RNG、无除零、无 NaN、无抛错**。
  - `Monster.mutate`（Monster.ts:155-163）：`"0d1"` 仍匹配 `^(\d+)d(\d+)$`，
    `count=0` → `max(1, floor(0×factor)) = 1` → 记法变 `"1d1"`，与旧行为一致，
    无异常。
- **已知残留偏差（行为层，不在本任务边界内）**：`Combat.attack`（Combat.ts:154）
  有 `if (damage < 1) damage = 1` 的下限，因此数据改对之后这些怪物**命中一次仍会
  造成 1 点伤害**；CE 里它们根本不应发起近战。真正的修复需要让 {0,0,0} 怪物不
  发起近战攻击（行为层改动，涉及 Combat.ts / Monster.ts / Game.ts，均被任务禁止
  触碰）。此外 `Combat.attack` 对武器附魔/弱点/背刺等修正也大量使用
  `Math.max(1, …)`，单纯数据无法表达「零伤害近战」。

## 6. 测试与构建

### 新增测试

- `src/data/monsterDamage.test.ts`（3 用例）：
  1. 67 条怪物全部有 damage 字段；
  2. **每条** damage 经 `CombatSystem.parseDamageString` 的 min/max 与 CE 一致
     （CE 值内联于测试内 `CE_DAMAGE` 表，每条注释注明 Globals.c 行号）；
  3. 记法形态断言：非 {0,0,0} 为 `1dN(+M)`（clumping=1），{0,0,0} 为 `0d1`。
- `src/test/monster_damage_balance.test.ts`（2 用例）：平衡回归，见 §7。

### `npm test` 输出尾部（全绿；既有 70 passed 不减）

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  12 passed (12)
      Tests  75 passed | 1 expected fail | 7 todo (83)
   Start at 02:25:54
   Duration  2.58s (transform 959ms, setup 0ms, import 1.47s, tests 4.57s, environment 2ms)
```

计数说明：修复前基线为 70 passed + 1 expected fail + 7 todo = 78；
本次新增 5 条测试（3 + 2）全过 → 75 passed + 1 expected fail + 7 todo = 83。
`1 expected fail` 是 `CombatFormulas.test.ts:183` 的既有 `it.fails` 占位
（armorProtection 与 CE 公式不符的钉子，先于本任务存在），非真实失败。

### `npm run build` 输出尾部（通过）

```
dist/assets/browserAll-BoRd7uf_.js           41.30 kB │ gzip:  10.82 kB
dist/assets/RenderTargetSystem-B_i_Mhtc.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-CTri2Rpq.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-tlCewoJ1.js               857.78 kB │ gzip: 273.31 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.38s
```

（chunk 体积告警为既有状态，与本次改动无关。）

### `git diff --stat`

```
 brogue-web/src/data/monsters.json | 110 +++++++++++++++++++-------------------
 1 file changed, 55 insertions(+), 55 deletions(-)
```

仅 monsters.json 的 damage 行有增删（55±55）；diff 逐行核对全部落在
`"damage": "…"` 行，其余字段零改动（脚本以 JSON 语义等价性校验过）。
新增文件：`src/data/monsterDamage.test.ts`、`src/test/monster_damage_balance.test.ts`。

## 7. 平衡回归（3 个固定 seed × 2000 回合，修复前 vs 修复后）

方法：`src/test/harness.ts` 的 `createHeadlessGame(seed)` + `runTurns`，逐回合采样
玩家 HP，累计「正向 HP 回落」作为累计受伤量（含环境伤害，前后口径一致）。
seed = 20260913 / 424242 / 987654321（与 smoke/Random 测试同源）。两种口径：

- **a) 默认策略（任务指定口径）**：harness 默认（有相邻敌人则攻击，否则随机合法
  方向移动）。该策略永不离开 D1，只能遇到 rat/kobold/jackal 一线浅层怪。
- **b) 下楼策略（补充口径，测试侧实现，引擎零改动）**：攻击相邻敌人 → 站在下楼
  楼梯则下楼 → BFS 走向下楼楼梯 → 兜底随机移动，能真实进入深层、暴露
  ogre/wraith 等高伤害条目。

修复前基线 = 改动 monsters.json 之前、同一测试文件跑出的结果；前后唯一差异是
monsters.json。

### 修复前（旧记法）

| 口径 | seed | turnsRun | 死亡 | 累计受伤 | 受伤回合 | 最终 HP | 最深层数 |
|---|---|---|---|---|---|---|---|
| default | 20260913 | 2000 | 否 | 7 | 7 | 30/30 | D1 |
| default | 424242 | 2000 | 否 | 1 | 1 | 30/30 | D1 |
| default | 987654321 | 2000 | 否 | 2 | 2 | 30/30 | D1 |
| descend | 20260913 | 204 | **是（Killed by a Eel.）** | 39 | 23 | -1/30 | D2 |
| descend | 424242 | 1738 | **是（Killed by a Jackal.）** | 44 | 17 | 0/30 | D4 |
| descend | 987654321 | 2000 | 否 | 4 | 4 | 30/30 | D2 |

### 修复后（1dN+M / 0d1）

| 口径 | seed | turnsRun | 死亡 | 累计受伤 | 受伤回合 | 最终 HP | 最深层数 |
|---|---|---|---|---|---|---|---|
| default | 20260913 | 2000 | 否 | 2 | 2 | 30/30 | D1 |
| default | 424242 | 2000 | 否 | 3 | 3 | 30/30 | D1 |
| default | 987654321 | 2000 | 否 | 1 | 1 | 30/30 | D1 |
| descend | 20260913 | 2000 | 否 | 4 | 4 | 30/30 | D1 |
| descend | 424242 | 2000 | 否 | 1 | 1 | 30/30 | D1 |
| descend | 987654321 | 2000 | 否 | 6 | 6 | 30/30 | D2 |

### 汇总与解读

| 口径 | 修复前 | 修复后 |
|---|---|---|
| default：死亡数 / 累计受伤 | 0 / 10 | 0 / 6 |
| descend：死亡数 / 累计受伤 | **2 / 87** | **0 / 11** |

- 方向符合预期：修复后死亡 2→0，累计受伤 87→11（-87%）。
- 修复前的两例死亡正是被放大伤害直接击杀：D2 的 Eel（旧 3~21，一口十余点）在
  第 204 回合击杀玩家；D4 的 Jackal（旧 2~8）在第 1738 回合耗尽玩家。修复后这两
  条的 CE 区间为 3~7 / 2~4，同样种子下均存活满 2000 回合。
- **必须如实说明的局限**：a) 默认策略只游走 D1，对本次修复几乎不敏感（这也是
  必须补 descend 口径的原因）；b) RNG 流会因伤害区间不同而分岔（`rng.range` 的
  拒绝采样次数随区间变化），修复后 descend 三局恰好都没走到楼梯（最深 D2），
  因此修复后样本对深层怪（ogre/dragon 等）的采样有限——「修复后 0 死亡」是真实
  输出，但不宜据此外推「深层完全平衡」。聚合倍率证据仍以 §2 的 4.441× 期望放大
  为准。

## 8. 与预设/提示词不符之处（只列不修）

1. **提示词中 dragon 的 clumpFactor 笔误**：提示词举例写「CE dragon {25,50,**1**}」，
   CE 实际为 `{25, 50, **4**}`（Globals.c L1123）。min/max 无误，仅 clump 因子
   与提示词不符；本任务不修 clump，无实际影响。
2. **「Combat.attack … 不消费 parseDamageString 的返回值」表述不准**：attack 实际
   **消费了** `parseDamageString` 返回的 min/max（Combat.ts:107-113），只是把
   clumping 硬编码为 1（Combat.ts:45）、忽略了返回值中的 `clumping` 字段。
3. **harness 默认策略无法区分修复前后**：任务预设「用 harness 跑平衡回归……修复
   后应显著下降」，但默认策略永不离开 D1，浅层怪物本就没有被写错的条目
   （D1 的 rat/kobold 记法本就正确），修复前基线累计受伤也只有 10 点。为使回归
   有区分度，补充了测试侧实现的下楼策略（§7b），该口径下差异显著（87→11、死亡
   2→0）。此为测试侧补充，不违反「只改数据与新增测试」的边界。
4. **「修复前怪物伤害平均放大 4.4 倍」核验通过但口径需注明**：4.441 是「43 条
   非 {0,0,0} 不一致条目」上「旧期望 ÷ 新期望」的**算术平均**（均匀分布期望 =
   (min+max)/2，clumping=1 时成立）。若按别的加权口径（如按出现频率加权）数值会
   不同，本报告沿用与锚点吻合的算术平均口径。
5. **{0,0,0} 怪物修复后仍会造成 1 点近战伤害**（任务已预告，此处仅确认）：
   `Combat.attack` 的 `damage < 1 → 1` 下限（Combat.ts:154）所致，行为层问题，
   边界外（见 §5）。
6. **潜在后续风险（行为层，未修）**：`Monster.mutate` 的伤害调整正则
   `^(\d+)d(\d+)$`（Monster.ts:155）不再匹配 `1dN+M` 形态，变异怪的
   damageFactor 将静默跳过伤害调整（无异常，只是不生效）。若未来希望变异影响
   伤害，需要在行为/数据层另行设计（例如把 damage 拆成结构化字段）。

## 9. 边界遵守声明

- 修改的文件：仅 `src/data/monsters.json`。
- 新增的文件：`src/data/monsterDamage.test.ts`、`src/test/monster_damage_balance.test.ts`、
  本报告。
- 未触碰：Combat.ts、CombatFormulas.ts、Monster.ts、Game.ts、DetailGenerator.ts、
  Item.ts、ItemLoader.ts、Architect.ts、Gas.ts、Bolt.ts、src/data/ 下其他 json、
  全部既有测试。
- 未执行 git commit / add / push / reset / checkout；仓库内未创建临时文件
  （数据比对与替换均以 `node --input-type=module -e` 内联脚本完成）。
