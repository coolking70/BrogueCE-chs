# X2h：公开 test 模式退池可达性

依据：`x2h.prompt.md` §0 指向的 X-1 §4 N09、§7.1；CE 身份以 `BrogueCE-master`、D2 退池清单、`invented_content_pool.test.ts`、`RETIRED_INVENTED_BLUEPRINT_IDS` 和数据中的 `excludeFromGeneration` 交叉核定。合同：菜单公开 test 模式保留教学展陈，但展陈不得产生 web 自创物品、符文或蓝图；直接构造定义仍保留，正常自然生成不变。

## 1. 展陈盘点与处置

每 9 层循环一次分类；房间网格最多 48 间，因此敌人与蓝图只显示目录的前 48 项。下表“CE”指身份对应 CE，**不宣称效果实现或测试场景构造与 CE 完全一致**。除特别指出的退池项外，表中列出的可见条目均为 CE 原生身份。

| 测试层 / 类别 | 实际可见目录与身份 | web 自创旧展陈、处置 |
|---|---|---|
| D1 武器，15 | dagger, whip, spear, rapier, sword, mace, axe, flail, broadsword, war_pike, war_hammer, dart, war_axe, incendiary_dart, javelin | `halberd` 移除；其余 CE。 |
| D2 魔杖，9 | wand_of_teleportation, wand_of_slowness, wand_of_polymorphism, wand_of_negation, wand_of_domination, wand_of_beckoning, wand_of_plenty, wand_of_invisibility, wand_of_empowerment | `wand_of_fire`、`wand_of_lightning` 移除；CE 火/闪电示例仍可在 D5 的 `staff_of_fire`、`staff_of_lightning` 找到。 |
| D3 卷轴，13 | scroll_of_enchantment, scroll_of_identify, scroll_of_teleportation, scroll_of_magic_mapping, scroll_of_remove_curse, scroll_of_recharging, scroll_of_protect_weapon, scroll_of_protect_armor, scroll_of_negation, scroll_of_sanctuary, scroll_of_shattering, scroll_of_discord, scroll_of_summon_monsters | `scroll_of_amnesia` 移除；其余 CE。 |
| D4 药水，16 | potion_of_life, potion_of_strength, potion_of_fire_immunity, potion_of_invisibility, potion_of_levitation, potion_of_telepathy, potion_of_haste, potion_of_detect_magic, potion_of_descent, potion_of_incineration, potion_of_poison, potion_of_confusion, potion_of_paralysis, potion_of_hallucination, potion_of_darkness, potion_of_creeping_death | `potion_of_healing` 移除；`potion_of_life` 是 CE 的生命示例。`potion_of_poison` = CE caustic gas（B-4a 反转），`potion_of_creeping_death` = CE lichen；`potion_of_darkness` 虽暂不进自然池，仍属 CE，保留于教学展陈。后两种的效果实现边界见 X-1 N07。 |
| D5 其他，42 | 护甲：leather_armor, scale_mail, chain_mail, banded_mail, splint_mail, plate_mail；法杖：staff_of_lightning, staff_of_fire, staff_of_poison, staff_of_tunneling, staff_of_blinking, staff_of_entrancement, staff_of_obstruction, staff_of_discord, staff_of_conjuration, staff_of_healing, staff_of_haste, staff_of_protection；戒指：ring_of_clairvoyance, ring_of_stealth, ring_of_regeneration, ring_of_transference, ring_of_light, ring_of_awareness, ring_of_wisdom, ring_of_reaping；护符：charm_of_health, charm_of_protection, charm_of_speed, charm_of_fire_immunity, charm_of_invisibility, charm_of_telepathy, charm_of_levitation, charm_of_shattering, charm_of_guardian, charm_of_teleportation, charm_of_recharging, charm_of_negation；钥匙：iron_key, cage_key, crystal_orb；护身符：amulet_of_yendor | `staff_of_light` 移除；CE 光源可用 `ring_of_light` 展示。钥匙类虽有自然池排除项，仍是 CE 机器道具，保持展陈。未实现护符效果不在本任务内。 |
| D6 地形，6 | WATER_SHALLOW, WATER_DEEP, GRASS, FOLIAGE, LAVA, CHASM | 均为 CE 地形身份，无自创条目。 |
| D7 敌人，48 | rat, kobold, jackal, eel, monkey, bloat, pit_bloat, goblin, goblin_conjurer, goblin_mystic, goblin_totem, pink_jelly, toad, vampire_bat, arrow_turret, acid_mound, centipede, ogre, bog_monster, ogre_totem, spider, spark_turret, wisp, wraith, zombie, troll, ogre_shaman, naga, salamander, explosive_bloat, dar_blademaster, dar_priestess, dar_battlemage, acidic_jelly, centaur, underworm, sentinel, dart_turret, kraken, lich, phylactery, pixie, phantom, flame_turret, imp, fury, revenant, tentacle_horror | 均有 CE monsterCatalog 对应；67 种全目录无 web 自创怪物（见 `monster_stats_merge_report.md` 与 `invented_content_pool_report.md`）。 |
| D8 蓝图，48 | reward_treasure_room (CE3), reward_pedestal_permanent (CE4), reward_pedestal_consumable (CE5), reward_kennel (CE10), reward_commutation (CE6), reward_mixed_library (CE1), reward_single_category_library (CE2), reward_resurrection_altar (CE7), reward_statuary (CE15), vestibule_locked (CE16), vestibule_secret_door (CE17), vestibule_flammable_barricade (CE19), vestibule_statue_doorway (CE20), vestibule_pit_trap_field (CE23), vestibule_secret_lever (CE18), vestibule_throwing_tutorial (CE22), vestibule_beckoning_obstacle (CE24), vestibule_guardian_obstacle (CE25), key_poison_gas (CE40), key_pit_trap (CE35), key_secret_room (CE27), key_nested_library (CE26), key_throwing_tutorial_cage (CE28), trap_paralysis_revealed (CE67), trap_paralysis_hidden (CE68), vestibule_statue_monster (CE21), key_rat_trap_dormant (CE29), key_explosive_trap (CE41), key_statuary (CE43), key_worm_trap (CE50), key_turret_trap (CE56), area_trick_statue (CE69), area_worm (CE70), reward_chained_allies (CE9), reward_vampire_lair (CE11), reward_legendary_ally (CE12), key_fun_with_fire (CE30), key_thief_area (CE33), key_burning_grass (CE42), key_guardian_gauntlet (CE45), key_guardian_corridor (CE46), key_sacrifice_altar (CE47), key_beckoning_obstacle (CE49), key_zombie_crypt (CE53), key_worm_tunnels (CE55), key_boss_secret_room (CE57), ce_58_bloodwort (CE58), ce_59_shrine (CE59) | 11 个 `RETIRED_INVENTED_BLUEPRINT_IDS` 从展陈移除，定义与正常资格门保留。48 间上限使其余 22 个 CE 蓝图仍未显示；不把“目录存在”误写成“玩家可见”。展陈只投射首个地形/物品/怪物 feature，不等于真正建成机器。 |
| D9 符文，14 | 武器：paralyzing (= CE paralysis), quietus, speed, confusion, force, slaying, mercy；护甲：reflection, dampening, mutuality, respiration, absorption, reprisal, immunity；靶怪均为 CE troll | dagger 上的 `venom`、`vampirism` 和 leather_armor 上的 `vitality` 移除。其余 CE 符文足以展示武器/护甲符文操作。 |

D10–D40 继续按上述 9 类循环。物品实例的 `identityId` / `consumableId`、`runicType`，以及测试房新增的 `blueprintId` 是可执行守卫的检查面；钥匙实例原本没有种类 ID，盘点用展陈数据行与名称。D8 的 `blueprintId` 只记录测试房所用定义，不触碰真实蓝图选择或生成。

D8 移除的 web 自创蓝图逐项为：`reward_library`、`reward_consumables`、`vestibule_flammable`、`vestibule_guardian`、`vestibule_pit_traps`、`key_rat_trap`、`key_fire_trap`、`key_flood_trap`、`key_web_room`、`key_lava_moat`、`key_boss`；数据行、feature 与自然模式资格拒绝均保留。原展陈对蓝图只投射首个 feature，本来就不能证明其机器在测试房里可建成。

## 2. 修改与验证

`Game.generateTestDepth` 的物品列表对自创品使用既有 gen 池；D4 对 CE 原生但因功能待补而退自然池的 darkness 作明确例外；钥匙等 CE 机器条目沿用全量展陈。D9 使用既有 CE 符文池；D8 过滤 11 个已退蓝图并记录房间蓝图 ID。没有修改数据定义、自然池、`blueprintQualifies`、`GenerationCoordinator` 正常路径或任何生成基线。

`x2h_test_mode_reachability.test.ts` 以菜单发出的 mode payload 建局，逐层从 D1 到 D40 经真实 `stairs_down` 操作，检查地面、背包与重置快照的物品 ID/符文，检查每间 D8 房的蓝图 ID，并实际拾取物品。`scripts/x2h-browser.mjs` 在 Edge 中点击真实菜单的 test 选项与“新游戏”，再走同一 40 层和拾取链。CE 正向样本断言防止清空展陈的假绿。

反查闭包由全量 `npm test` 覆盖：P1-30 的 i18n 源码扫描、U24 文案、`invented_content_pool` 正常池、B-4a/b、V 系列机器、MainMenu/App 及其他读源码守卫均未改动。另以 `test:drift` 单独验证原深层基线；未重捕获 fixture。

反事实：先在当前代码上定向跑 B-1a、B-1c、P4-10、UR2、UR4 五个既有文件，结果 **5 文件各有 1 失败，62 项通过**；随后仅把 `Game.ts` 暂换为 `HEAD` 原字节，其他代码与测试不动，同一命令 **5 文件、67 项全过**，最后在 `finally` 中原字节恢复（SHA-256 `0ff259c8899a09ed640c2d14704349f3b2591594696c1179532943d59994d753`）。见 [当前结果](x2h-evidence/current-five.txt)与 [原版结果](x2h-evidence/baseline-five.txt)。这证明五处红灯由 test 展陈改动触发；不是原版就红的旧债。

其中 UR2 把 test D1 的旧地面物品、实例 ID、数量和 RNG 固定成完整快照；UR4 把 test 层整图及随机状态固定成快照。恢复这些旧值会恢复已退内容，违背本任务合同。B-1a、B-1c、P4-10 的随机实例/寻路断言也依赖旧展陈消耗后的流位。按任务书“守卫靠旧规则才绿时先反事实证明、只修前提、交验收方裁决”，本轮**不改旧守卫、不重捕获 UR 快照、不用兼容分支让公开 test 模式回流自创内容**；把这五处固定旧展陈的前提提交验收方裁决。新守卫独立检查公开合同，定向 1/1 通过。

最终复跑：`npm run build` 退出 0；`npm run test:drift` 1/1 通过，见 [漂移日志](x2h-evidence/drift.txt)；真实菜单 Edge 验证 D1–D40、9 类、5 次拾取、0 页面错误，退出 0。完整 `npm test` **跑完**，206 文件中 201 通过、5 失败，3855 项通过、5 项失败、8 跳过、5 todo，退出 1；五个失败恰为上述反事实定位的 B-1a、B-1c、P4-10、UR2、UR4，没有新失败，见 [全量日志](x2h-evidence/final-npm-test.txt)。X2h 新守卫在全量中通过，另定向复跑 1/1 通过。

交付检查：`git diff --check` 通过；本轮新增/修改的文本与证据均为 LF，无 CRLF；`git status` 只有 `Game.ts` 修改及本报告、X2h 守卫、浏览器脚本和证据目录新增。未暂存、未提交 git。五个旧守卫需由验收方裁决旧 test 展陈固定快照的前提；本轮没有为追求旧快照全绿而恢复退池内容。

## 验收方裁决（5 处旧前提）

执行方已证明 5 处在 HEAD `Game.ts` 上全过、仅因 test 展陈改动而红。验收方处理：
- **B-1a / B-1c / P4-10**：夹具隐含前提随全局 RNG 位置变化失效，均显式构造原注释所述前提，断言不改——B-1a 剑显式 `runicType=undefined`（"无符文"）；B-1c 戒指显式 `isCursed=false`（U15b-2 起 CE 出生 16% 诅咒）；P4-10 到达后换点为 CE 合法语义（Monsters.c:3608–3615），换点时从新目标重新计量，持目标期间仍严格下坡。三文件 65/65。
- **UR2 / UR4 黄金 trace**：单变量归因——仅撤回 X2h `Game.ts` → 旧夹具 2/2 通过；以 X2h 代码按原 `UR2_CAPTURE=1` / `UR4_CAPTURE=1` 入口重录并复验 2/2。UR2 `4d6b6246…→d4a298b2…`，UR4 `86609968…→06f44e78…`。
