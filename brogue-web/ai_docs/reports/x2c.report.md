# X2c：legacy 命中状态归属

基准为本工作树 `BrogueCE-master/src/brogue/Globals.c:1025–1170`、`Combat.c:425–534, 1385–1406`、`Monsters.c:58–153`。未提交 git，未改生成流、`test:drift` 或深层基线。

## CE 核对与数据裁决

逐行查 `src/data/monsters.json` 的 67 个自然条目、CE `monsterCatalog` 的 `flags`/`abilityFlags`/DF，并核对命中实施代码。仅三种带 `onHitStatus`，八种带 `statusImmunities` 或 `statusResistTurns`。下表把每种含状态字段的自然物种列全；CE 没有通用状态免疫或按回合减时字段，因此这些 JSON 值均是 web 自创。实例和 polymorph 仍投影这些值供数据/快照结构使用，状态判定入口不让自然默认值发挥效果；运行期显式赋予的其他免疫/抗性仍按既有来源工作。

| 自然物种 | legacy 字段 | CE 对应行及裁决 |
|---|---|---|
| rat | immune confused；paralyzed -1 | `Globals.c:1031` 仅 `DF_URINE`，无状态免疫/减时位；不生效。 |
| kobold | confused on hit；paralyzed -2、hallucinating -1 | `Globals.c:1032` 无 `MA_HIT_*` 或其他状态能力；混乱命中及抗性不生效。 |
| jackal | immune confused；hallucinating/paralyzed -1 | `Globals.c:1033` 仅 `DF_URINE`；不生效。 |
| goblin | paralyzed on hit；immune hallucinating；confused -2 | `Globals.c:1041–1042` 为 `MA_ATTACKS_PENETRATE`、`MA_AVOID_CORRIDORS`，没有麻痹命中；legacy 状态不生效，矛几何仍保留。 |
| ogre | immune confused/hallucinating；paralyzed/confused -3 | `Globals.c:1060–1061` 为 `MA_ATTACKS_STAGGER`、`MA_AVOID_CORRIDORS`；无通用状态抗性。 |
| troll | paralyzed/confused -2 | `Globals.c:1075–1076` 无状态免疫/减时能力；不生效。 |
| centaur | paralyzed -1 | `Globals.c:1094–1095` 为 `BOLT_DISTANCE_ATTACK`，无麻痹抗性；不生效。 |
| vampire | paralyzed on hit；immune poisoned；confused/hallucinating -2 | `Globals.c:1130–1131` 为 `MA_TRANSFERENCE`、`MA_DF_ON_DEATH`、召唤/进入召唤与 `DF_BLOOD_EXPLOSION`，没有麻痹命中或毒免疫；legacy 状态不生效，原生吸血/死亡 DF 等出口保留。 |

CE 真正的接触状态来自能力位，例如 toad 的 `MA_HIT_HALLUCINATE`（`Globals.c:1052–1053`）、spider 的 `MA_POISONS`（:1067–1068）、centipede/dart turret 的 `MA_CAUSES_WEAKNESS`（:1058–1059/:1098–1099）。`Combat.ts:273–325` 已将毒和虚弱施于实际 defender；本轮把幻觉出口也覆盖怪物目标。`MA_HIT_BURN`、`MA_HIT_DEGRADE_ARMOR`、`MA_HIT_STEAL_FLEE` 及 `MA_DF_ON_DEATH` 各自独立，不能拿 legacy 通用状态替代；本轮不扩大这些能力的既有实现边界。

67 个自然条目均有 `goldDropChance`/`itemDropChance` 键，其中 66 种至少一个非零，jackal 双零。这些字段全部是 web 自创的概率，不对应 CE 掉落。CE `Monsters.c:133–153` 仅在 `itemPossible` 且有 `MONST_CARRY_ITEM_25/100` 时，从 `monsterItemsHopper` 取预生成物放入 `carriedItem`；对应自然物种为 goblin_conjurer、goblin_mystic、dar_blademaster、dar_priestess、dar_battlemage、lich、goblin_warlord（25）及 dragon（100），均**不是** JSON 数值的同义转换。其余带掉落字段的物种是 rat、kobold、jackal、eel、monkey、bloat、pit_bloat、goblin、goblin_totem、pink_jelly、toad、vampire_bat、arrow_turret、acid_mound、centipede、ogre、bog_monster、ogre_totem、spider、spark_turret、wisp、wraith、zombie、troll、ogre_shaman、naga、salamander、explosive_bloat、acidic_jelly、centaur、underworm、sentinel、dart_turret、kraken、phylactery、pixie、phantom、flame_turret、imp、fury、revenant、tentacle_horror、golem、black_jelly、vampire、flamedancer、spectral_blade、spectral_sword、stone_guardian、winged_guardian、guardian_spirit、Warden_of_Yendor、eldritch_totem、mirrored_totem、unicorn、ifrit、phoenix、phoenix_egg、mangrove_dryad。`Monster.ts:305–306` 实例仍默认 0，构造器不复制 JSON 概率；`Game.dropMonsterLoot` 遗留出口因此不会按自然 JSON 概率产生金币或物品。没有改实例默认值，也没有实现 CE hopper。

## 代码与目标归属

- `Monster.hasEffectiveOnHitStatus()` 把自然 kobold/goblin/vampire 的三条无 CE 对应能力的 legacy 命中关掉，字段仍保留于 JSON、实例及快照结构。`Game.applyStatusToMonster` 在实际状态判定时排除对应的自然目录默认免疫/减时；构造、polymorph 和快照字段继续保留。
- `Game.applyMonsterOnHitStatus(target, attackerName, status, duration)` 按目标分派。玩家继续走玩家临时免疫/状态消息，怪物走怪物状态施加；任何非本局玩家、非怪物对象都不会误写本局玩家。
- 盟友普通近战删除了对玩家 helper 与怪物 helper 的双重调用；怪物几何攻击、discordant 近战和玩家近战、BE_ATTACK/POISON_DART 的命中路径均把实际受击者传入。`MA_HIT_HALLUCINATE` 对怪物目标也走同一目标入口。BE_DAMAGE 法伤不携带近战 rider；反射在 bolt travel 已选定真实目标。玩家投掷的状态出口仍以碰撞目标执行，不经过怪物 legacy helper。

## 验证

新增 `src/test/x2c_hit_status_owner.test.ts` 六项：三种数据留形但无实际命中状态；seed 1212 盟友 kobold 打 rat 时玩家不被混乱；helper 怪物目标不污染玩家；toad 原生幻觉在盟友普通攻击、距离攻击中落到 rat；合成 `MA_HIT_HALLUCINATE` 与 goblin 矛几何组合验证远处受击怪物的归属。既有 `p4_6_attack_geometry`、`u_06_monster_damage` 定向回归随同运行。反射的定向状态接收者已有 `w_9_directed_status` 守卫，普通/几何/远程目标另由本轮和既有守卫覆盖。

| 门禁 | 最终结果 |
|---|---|
| 定向 X2c + polymorph 字段守卫 | 7 passed；另 `u_01_instance_snapshot` 字段覆盖守卫单独通过。 |
| UR3 当前代码复核 | 1 passed；首次全量运行中途版的 hash 差异未在最终代码复现，没有重录黄金 trace。 |
| `npm run build` | `vue-tsc -b`、Vite build 退出 0。 |
| `npm test` 最终完整复跑 | **202 文件通过；3793 passed、8 skipped、5 todo；退出 0**。含任务书所列 p1_30、U24、U01/U03、U06、U12a/b、U13、p4_*、w_*、invented_content_pool、monster_stats_effect 和读源码守卫。 |
| `npm run test:drift` 最终复跑 | 1 文件、1 项通过；退出 0。 |
| 工作树 | `git diff --check` 通过；HEAD `70f7dc4439f84772a8aa51c9f6cd36a4e0f93058`；改动仅三份运行时代码、新 X2c 测试及本报告；五个改动/新增文本均 0 个 CRLF；未提交 git。 |

首次全量运行在边改边跑期间完整结束，198 文件通过、4 文件失败。四处失败分别是：曾临时增加未登记的 `legacyStatusImmunities` 实例字段触发 U01 快照守卫；曾临时不投影自然默认免疫触发 W19 polymorph 守卫与 X2c 新断言；同一中途版本使 UR3 全层 hash 改变。随后仅调整实现前提：保留字段投影，状态消费时排除无 CE 依据的自然默认值，且不增加实例字段；对应单测和 UR3 均单独转绿，最终完整复跑全绿。没有改守卫、`test:drift`、深层基线或黄金 trace。
