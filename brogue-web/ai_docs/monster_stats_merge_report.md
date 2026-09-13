# 怪物真实战斗数值接线报告（P1-1）

日期：2026-09-14
任务：把 `monsters_ce2.json` 的 accuracy / defense / regen / moveSpeed / attackSpeed
五个字段合并进运行时数据表 `src/data/monsters.json`，并逐条对照 Brogue CE 源码
（`BrogueCE-master/src/brogue/Globals.c` 的 `monsterCatalog`）校验。

## 结论（TL;DR）

- 67 条怪物全部并入五字段，**逐条对照 CE 零差异**（修正清单为空，见 §3）；
- `git diff` 为 **335 行纯新增、0 删改**，冲突规则（既有字段绝不被覆盖）以 diff 为证；
- 效果实测：legacy（合并前语义）玩家命中率 **100.0%**（164/164）→ wired（真实数值）
  **98.7%**（155/157），累计受伤 **296 → 268（-9.5%）**；定向接敌 troll(def=70)
  30 次挥击仅 9 中（30%）——**defense 确实进入命中掷骰，防御系统接上了**；
- `npm test`：**70 passed**（原 64 全保留 + 新增 6），`npm run build` 全绿；
- 已删除 `monsters_ce.json`、`monsters_ce2.json`（删除前复查全仓库无 import）。

## 1. 改动文件

```
 brogue-web/src/data/monsters.json     |  335 ++++++++   （M，纯新增 67×5 字段）
 brogue-web/src/data/monsters_ce.json  | 1465 --------  （D，死文件，含损坏数据）
 brogue-web/src/data/monsters_ce2.json | 1561 --------  （D，合并后即为死文件）
 3 files changed, 335 insertions(+), 3026 deletions(-)

 新增：
 scripts/merge_monster_stats.cjs          （合并 + --check-ce/--dump-ce 校验）
 src/data/monsters.test.ts                （数据表回归，4 用例）
 src/test/monster_stats_effect.test.ts    （前后效果采样，2 用例）
 ai_docs/monster_stats_merge_report.md    （本报告）
```

未触碰任何禁改文件（Monster.ts、Game.ts、Combat.ts、CombatFormulas.ts、
DetailGenerator.ts 等），未执行任何 git 写操作。

## 2. 合并方式与冲突规则落实

`scripts/merge_monster_stats.cjs` 以 `id` 为键，从 `monsters_ce2.json` 取五个数值字段，
插入到每条怪物 `damage` 字段之后；**只新增、绝不覆盖**既有字段，ce2 的
`color`（字符串）等其他字段一律不带过来。合并结果 `git diff` 为 335 行纯新增
（67 条 × 5 字段）、0 删改，即冲突规则的机械证明。

五字段在 `monsters.json` 中此前一处都不存在（合并前脚本断言过为 0 处已存在），
`Monster.ts:105-109` 的 `?? 默认值`（acc=100/def=0/regen=0/双速=100）此前对全部
67 条生效——这正是本次要消除的状态。

ce2 删除后，merge 模式会明确报错退出（exit 2）并提示改用
`--check-ce <Globals.c>` 做长期校验；`--check-ce` / `--dump-ce` 不依赖 ce2，
可随仓库长期使用。

## 3. 逐条对照 CE 校验（任务核心）

**结果：335 个数值（67 条 × 5 字段）与 CE 全部一致，修正清单为空（0 条）。**

ce2 本就是忠实的拷贝，合并即正确。为排除"我的解析器与当年生成 ce2 的
parser2.cjs 犯同一种列序错误、错误互相抵消"的可能，做了三重独立验证：

1. **结构体定义**（`Rogue.h:2172` `creatureType`）确认列序为
   `maxHP, defense, accuracy, damage{...}, turnsBetweenRegen(=web regen),
   movementSpeed(=moveSpeed), attackSpeed`；
2. **当年生成 ce2 的 parser2.cjs 是完全不同的解析实现**（花括号配平 + 顶层逗号
   切分 tokenizer，tokens[4..10] 取数），与我的正则解析器同列序、同结果；
3. **人工抽查 14 条**（rat/jackal/eel/monkey/ogre/bog_monster/troll/wraith/
   dragon/golem/Warden_of_Yendor/unicorn/mangrove_dryad/goblin_warlord）与
   Globals.c 原文逐字吻合，含边界值：bog_monster acc=**5000**、troll regen=**1**、
   Warden acc=**300**、dragon acc=**250**。

67 条逐条对照全表见 **附录 A**（`--dump-ce` 输出，含每条的 Globals.c 行号）。
另：67 条怪物在 CE 表中全部找到对应行（CE 表含玩家 "you" 共 68 行，已跳过玩家行），
无 web 自创怪物。

`monsters.test.ts` 固化了 6 只指定怪物的黄金值硬断言（注释标注 Globals.c 行号）：
rat(L1030)、kobold(L1031)、jackal(L1032)、eel(L1033)、ogre(L1061)、troll(L1076)。

## 4. hp / damage 与 CE 差异清单（只列不修）

**hp（CE maxHP）：67 条全部一致，0 差异。**

**damage（CE damage range 的 min/max）：12 处不一致，全部同一模式——**
CE 写 `{0,0,0}`（不攻击）的怪物，web 侧写成了占位 `"1d1"`：

| 怪物 id | web damage | CE damage | Globals.c 行号 |
|---|---|---|---|
| bloat | "1d1" | {0,0,0} | L1037 |
| pit_bloat | "1d1" | {0,0,0} | L1039 |
| goblin_totem | "1d1" | {0,0,0} | L1047 |
| ogre_totem | "1d1" | {0,0,0} | L1065 |
| spark_turret | "1d1" | {0,0,0} | L1069 |
| wisp | "1d1" | {0,0,0} | L1071 |
| explosive_bloat | "1d1" | {0,0,0} | L1084 |
| sentinel | "1d1" | {0,0,0} | L1098 |
| phylactery | "1d1" | {0,0,0} | L1106 |
| eldritch_totem | "1d1" | {0,0,0} | L1149 |
| mirrored_totem | "1d1" | {0,0,0} | L1151 |
| phoenix_egg | "1d1" | {0,0,0} | L1161 |

按任务要求**只列入报告、未修改**（这些怪物在 CE 中 damage {0,0,0} 表示"没有
近战攻击"，web 若改 0 会牵动 Combat 的伤害下限逻辑，需单独排期）。
CE damage 的 clumpFactor 第三元 web 侧不存，未参与比对。

## 5. 合并前后效果对比（证明 defense 生效）

### 方法学

`src/test/monster_stats_effect.test.ts`，`createHeadlessGame` + `runTurns`，
16 个固定 seed（77701..77716）× 500 回合 × 两种模式配对：

- **legacy**：每回合把场上全部怪物的五字段运行时规范化回合并前构造默认值
  （acc=100/def=0/regen=0/双速=100，与 `Monster.ts:105-109` 的 `??` 默认逐项一致）
  ——在运行时精确复现"数据未接线"的语义；
- **wired**：真实数值（即合并后现状）。

两模式策略相同（相邻有敌则攻击；否则向本层下行楼梯推进，踩楼梯即下楼），
差异完全来自五字段本身。

**为什么用聚合而非单局**：引擎 `Monster.ts:291/293/482/484` 的游荡逻辑使用未播种的
`Math.random()`，同 seed 单局不可复现（见 §7）。单局对比会被遭遇时机的随机抖动
淹没，聚合 16 局后信号清晰。

### 结果

| 指标 | legacy（合并前语义） | wired（真实数值） |
|---|---|---|
| 局数 / 总回合 | 16 / 5684 | 16 / 6122 |
| 玩家死亡 | 5 | 4 |
| 玩家攻击次数 | 164 | 157 |
| 命中 | **164（100.0%）** | **155（98.7%）** |
| 累计受伤 | **296** | **268（-9.5%）** |
| 受伤回合数 | 115 | 99 |
| 击杀 | 74 | 70 |
| 对 def>0 怪物的攻击 | 0 | 8（全部打在 eel def=27 上，6 中 2 失手） |

按目标分布：legacy 打过的 Eel 因 defense 被规范化为 0 而 7/7 全中；wired 的
Eel(def=27) 8 攻 6 中（CE 理论命中率 0.987^27 ≈ 70%，与 75% 相符）。
wired 受伤下降的直接原因：rat/kobold acc=80、jackal acc=70（合并前恒 100），
怪物命中玩家的概率被真实压低。

### 定向接敌（deterministic-ish 补充证据）

把一只清醒 troll（defense=70，Globals.c:1076，HUNTING 状态规避沉睡 auto-hit）
反复放到玩家相邻格近战 30 次：**9 中 / 30（30.0%）**。CE 公式理论命中率
0.987^70 ≈ 40.2%；30 次全中的概率约 1e-12，排除"defense 未参与掷骰"。
该用例与聚合用例均已进入 `npm test`，作为接线回归长期守护。

另（初期观测，未进正式测试）：合并前用最初版采样策略、seed 12345 单局 500 回合，
玩家 11 攻 11 中（100%）、受伤 7，attacksOnDefended=0——与上表 legacy 侧结论一致。

## 6. 验收自测输出

`npm test`（64 passed 基线不降反增至 70；1 expected fail 与 7 todo 为既有基线，未动）：

```
 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  10 passed (10)
      Tests  70 passed | 1 expected fail | 7 todo (78)
   Start at  01:55:37
   Duration  2.29s (transform 790ms, setup 0ms, import 1.19s, tests 2.70s, environment 2ms)
```

`npm run build`：

```
 dist/assets/index-DzyDoCHX.js               857.72 kB │ gzip: 273.33 kB
 (!) Some chunks are larger than 500 kB after minification. …（既有警告）
 ✓ built in 1.34s
```

## 7. 与预设不符之处（只列不修）

1. **"accuracy 0-300" 区间预设不成立**：CE bog_monster 的 accuracy=5000
   （Globals.c:1063，设计上的"必定抓握"哨兵值）。以 CE 为准保留 5000，
   `monsters.test.ts` 对其余 66 条断言 0-300、对 bog_monster 单点硬断言 =5000。
   （上限恰好踩线的另一条：Warden_of_Yendor acc=300。）
2. **"固定 seed 各跑 500 回合对比"的单局不可复现**：`Monster.ts` 游荡逻辑使用
   `Math.random()`（L291/293/482/484；另 `Creature.ts:24` 的 id 亦然），harness
   注释中"最终状态只由 (seed, mode) 决定"的前提对怪物游荡不成立。Monster.ts 在
   禁改清单内未动；方法学改为 16 seed 配对聚合 + 定向接敌（§5）。附带说明：合并后
   无法再用"文件旧态"跑合并前基线，legacy 侧改用运行时字段规范化，与构造默认值
   逐项一致，语义等价。
3. **修正清单为空**：提示词预期 ce2 可能有与 CE 不一致之处，实测 335 个数值零差异
   （经 §3 三重验证确认非解析假象）。无需任何修正。
4. **moveSpeed / attackSpeed 仍不进调度**：与任务背景一致，唯一消费点仍是
   DetailGenerator 的展示；jackal 双倍速、ogre 半速攻击要等调度系统接入后才真实
   生效。regen 不同——`Monster.takeTurn`（Monster.ts:183-189）真实消费，
   troll(regen=1)/kraken(1)/ifrit(1)/bog_monster(3)/underworm(3) 等已真实回血。
5. **damage 12 处占位差异**（§4）：CE `{0,0,0}` vs web `"1d1"`，按要求只列不修。
6. **根目录历史脚本失效**：`merge_monsters.cjs`、`parser2.cjs`、`tmp_parser.cjs`
   以绝对路径读写两个 ce 文件（一次性生成脚本，非 import，不影响构建/测试）。
   ce 文件删除后它们不可再跑；不在本次允许修改清单内，未动。

## 附录 A：67 条逐条对照表（`--dump-ce` 输出）

格式：`json值=CE值`；L 行号为 Globals.c monsterCatalog 表体行号。

| # | id | acc | def | regen | move | atk | Globals.c | 一致 |
|---|----|-----|-----|-------|------|-----|-----------|------|
| 1 | rat | 80=80 | 0=0 | 20=20 | 100=100 | 100=100 | L1030 | ✅ |
| 2 | kobold | 80=80 | 0=0 | 20=20 | 100=100 | 100=100 | L1031 | ✅ |
| 3 | jackal | 70=70 | 0=0 | 20=20 | 50=50 | 100=100 | L1032 | ✅ |
| 4 | eel | 100=100 | 27=27 | 5=5 | 50=50 | 100=100 | L1033 | ✅ |
| 5 | monkey | 100=100 | 17=17 | 20=20 | 100=100 | 100=100 | L1035 | ✅ |
| 6 | bloat | 100=100 | 0=0 | 5=5 | 100=100 | 100=100 | L1037 | ✅ |
| 7 | pit_bloat | 100=100 | 0=0 | 5=5 | 100=100 | 100=100 | L1039 | ✅ |
| 8 | goblin | 70=70 | 10=10 | 20=20 | 100=100 | 100=100 | L1041 | ✅ |
| 9 | goblin_conjurer | 70=70 | 10=10 | 20=20 | 100=100 | 100=100 | L1043 | ✅ |
| 10 | goblin_mystic | 70=70 | 10=10 | 20=20 | 100=100 | 100=100 | L1045 | ✅ |
| 11 | goblin_totem | 0=0 | 0=0 | 0=0 | 100=100 | 300=300 | L1047 | ✅ |
| 12 | pink_jelly | 85=85 | 0=0 | 0=0 | 100=100 | 100=100 | L1049 | ✅ |
| 13 | toad | 90=90 | 0=0 | 10=10 | 100=100 | 100=100 | L1051 | ✅ |
| 14 | vampire_bat | 100=100 | 25=25 | 20=20 | 50=50 | 100=100 | L1053 | ✅ |
| 15 | arrow_turret | 90=90 | 0=0 | 0=0 | 100=100 | 250=250 | L1055 | ✅ |
| 16 | acid_mound | 70=70 | 10=10 | 5=5 | 100=100 | 100=100 | L1057 | ✅ |
| 17 | centipede | 80=80 | 20=20 | 20=20 | 100=100 | 100=100 | L1059 | ✅ |
| 18 | ogre | 125=125 | 60=60 | 20=20 | 100=100 | 200=200 | L1061 | ✅ |
| 19 | bog_monster | 5000=5000 | 60=60 | 3=3 | 200=200 | 100=100 | L1063 | ✅ |
| 20 | ogre_totem | 0=0 | 0=0 | 0=0 | 100=100 | 400=400 | L1065 | ✅ |
| 21 | spider | 90=90 | 70=70 | 20=20 | 100=100 | 200=200 | L1067 | ✅ |
| 22 | spark_turret | 100=100 | 0=0 | 0=0 | 100=100 | 150=150 | L1069 | ✅ |
| 23 | wisp | 100=100 | 90=90 | 5=5 | 100=100 | 100=100 | L1071 | ✅ |
| 24 | wraith | 120=120 | 60=60 | 5=5 | 50=50 | 100=100 | L1073 | ✅ |
| 25 | zombie | 120=120 | 0=0 | 0=0 | 100=100 | 100=100 | L1075 | ✅ |
| 26 | troll | 125=125 | 70=70 | 1=1 | 100=100 | 100=100 | L1076 | ✅ |
| 27 | ogre_shaman | 100=100 | 40=40 | 20=20 | 100=100 | 200=200 | L1078 | ✅ |
| 28 | naga | 150=150 | 70=70 | 10=10 | 100=100 | 100=100 | L1080 | ✅ |
| 29 | salamander | 150=150 | 70=70 | 10=10 | 100=100 | 100=100 | L1082 | ✅ |
| 30 | explosive_bloat | 100=100 | 0=0 | 5=5 | 100=100 | 100=100 | L1084 | ✅ |
| 31 | dar_blademaster | 160=160 | 70=70 | 20=20 | 100=100 | 100=100 | L1086 | ✅ |
| 32 | dar_priestess | 100=100 | 60=60 | 20=20 | 100=100 | 100=100 | L1088 | ✅ |
| 33 | dar_battlemage | 100=100 | 60=60 | 20=20 | 100=100 | 100=100 | L1090 | ✅ |
| 34 | acidic_jelly | 115=115 | 0=0 | 0=0 | 100=100 | 100=100 | L1092 | ✅ |
| 35 | centaur | 175=175 | 50=50 | 20=20 | 50=50 | 100=100 | L1094 | ✅ |
| 36 | underworm | 160=160 | 40=40 | 3=3 | 150=150 | 200=200 | L1096 | ✅ |
| 37 | sentinel | 0=0 | 0=0 | 0=0 | 100=100 | 175=175 | L1098 | ✅ |
| 38 | dart_turret | 140=140 | 0=0 | 0=0 | 100=100 | 250=250 | L1100 | ✅ |
| 39 | kraken | 150=150 | 0=0 | 1=1 | 50=50 | 100=100 | L1102 | ✅ |
| 40 | lich | 175=175 | 80=80 | 0=0 | 100=100 | 100=100 | L1104 | ✅ |
| 41 | phylactery | 0=0 | 0=0 | 0=0 | 100=100 | 150=150 | L1106 | ✅ |
| 42 | pixie | 100=100 | 90=90 | 20=20 | 50=50 | 100=100 | L1108 | ✅ |
| 43 | phantom | 160=160 | 70=70 | 0=0 | 50=50 | 200=200 | L1110 | ✅ |
| 44 | flame_turret | 150=150 | 0=0 | 0=0 | 100=100 | 250=250 | L1112 | ✅ |
| 45 | imp | 225=225 | 90=90 | 10=10 | 100=100 | 100=100 | L1114 | ✅ |
| 46 | fury | 200=200 | 90=90 | 20=20 | 50=50 | 100=100 | L1116 | ✅ |
| 47 | revenant | 200=200 | 0=0 | 0=0 | 100=100 | 100=100 | L1118 | ✅ |
| 48 | tentacle_horror | 225=225 | 95=95 | 1=1 | 100=100 | 100=100 | L1120 | ✅ |
| 49 | golem | 225=225 | 70=70 | 0=0 | 100=100 | 100=100 | L1121 | ✅ |
| 50 | dragon | 250=250 | 90=90 | 20=20 | 50=50 | 200=200 | L1123 | ✅ |
| 51 | goblin_warlord | 100=100 | 17=17 | 20=20 | 100=100 | 100=100 | L1127 | ✅ |
| 52 | black_jelly | 130=130 | 0=0 | 0=0 | 100=100 | 100=100 | L1129 | ✅ |
| 53 | vampire | 120=120 | 60=60 | 6=6 | 50=50 | 100=100 | L1131 | ✅ |
| 54 | flamedancer | 120=120 | 80=80 | 0=0 | 100=100 | 100=100 | L1133 | ✅ |
| 55 | spectral_blade | 150=150 | 0=0 | 0=0 | 50=50 | 100=100 | L1137 | ✅ |
| 56 | spectral_sword | 150=150 | 0=0 | 0=0 | 50=50 | 100=100 | L1139 | ✅ |
| 57 | stone_guardian | 200=200 | 0=0 | 0=0 | 100=100 | 100=100 | L1141 | ✅ |
| 58 | winged_guardian | 200=200 | 0=0 | 0=0 | 100=100 | 100=100 | L1143 | ✅ |
| 59 | guardian_spirit | 200=200 | 0=0 | 0=0 | 100=100 | 100=100 | L1145 | ✅ |
| 60 | Warden_of_Yendor | 300=300 | 0=0 | 0=0 | 200=200 | 200=200 | L1147 | ✅ |
| 61 | eldritch_totem | 0=0 | 0=0 | 0=0 | 100=100 | 100=100 | L1149 | ✅ |
| 62 | mirrored_totem | 0=0 | 0=0 | 0=0 | 100=100 | 100=100 | L1151 | ✅ |
| 63 | unicorn | 175=175 | 60=60 | 20=20 | 50=50 | 100=100 | L1155 | ✅ |
| 64 | ifrit | 175=175 | 75=75 | 1=1 | 50=50 | 100=100 | L1157 | ✅ |
| 65 | phoenix | 175=175 | 70=70 | 0=0 | 50=50 | 100=100 | L1159 | ✅ |
| 66 | phoenix_egg | 0=0 | 0=0 | 0=0 | 100=100 | 150=150 | L1161 | ✅ |
| 67 | mangrove_dryad | 175=175 | 60=60 | 6=6 | 100=100 | 100=100 | L1163 | ✅ |

共 67 条；全部与 CE 一致 ✅
