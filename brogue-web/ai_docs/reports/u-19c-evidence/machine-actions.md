# U19c 完整机器场景：玩家操作 → 结果

固定完整蓝图场景，逐台使用即时 entity adapter；不修改蓝图 feature/资格/频率。为隔离交互，观察者放在操作位置；攻击场景将可伤害目标设为 1 HP、提高玩家命中。read 走 UI 同款 executeItemCommand/readItem；其余由真实浏览器按键输入。它们是行为测试，不证明自然生成中每台谜题均可解。

| CE | 蓝图 | seed/size | 玩家操作 | 结果 | 截图 |
|---|---|---|---|---|---|
| 3 | reward_treasure_room | 1/0 | pickup | item transferred | [图](browser-ce3.png) |
| 4 | reward_pedestal_permanent | 1/0 | pickup | item transferred | [图](browser-ce4.png) |
| 5 | reward_pedestal_consumable | 1/0 | pickup | item transferred | [图](browser-ce5.png) |
| 10 | reward_kennel | 1/0 | pickup | item transferred | [图](browser-ce10.png) |
| 1 | reward_mixed_library | 1/0 | pickup | item transferred | [图](browser-ce1.png) |
| 2 | reward_single_category_library | 1/0 | pickup | item transferred | [图](browser-ce2.png) |
| 15 | reward_statuary | 1/0 | pickup | item transferred | [图](browser-ce15.png) |
| 16 | vestibule_locked | 1/0 | pickup | item transferred | [图](browser-ce16.png) |
| 19 | vestibule_flammable_barricade | 1/0 | pickup | item transferred | [图](browser-ce19.png) |
| 20 | vestibule_statue_doorway | 1/0 | pickup | item transferred | [图](browser-ce20.png) |
| 24 | vestibule_beckoning_obstacle | 1/0 | move | immune monster: HP unchanged | [图](browser-ce24.png) |
| 25 | vestibule_guardian_obstacle | 1/0 | move | immune monster: HP unchanged | [图](browser-ce25.png) |
| 40 | key_poison_gas | 1/0 | pickup | item transferred | [图](browser-ce40.png) |
| 35 | key_pit_trap | 1/0 | pickup | item transferred | [图](browser-ce35.png) |
| 27 | key_secret_room | 1/0 | pickup | item transferred | [图](browser-ce27.png) |
| 26 | key_nested_library | 1/0 | pickup | item transferred | [图](browser-ce26.png) |
| 21 | vestibule_statue_monster | 1/0 | read | dormant awakened | [图](browser-ce21.png) |
| 29 | key_rat_trap_dormant | 1/0 | pickup | item transferred | [图](browser-ce29.png) |
| 41 | key_explosive_trap | 1/0 | pickup | item transferred | [图](browser-ce41.png) |
| 43 | key_statuary | 1/0 | pickup | item transferred | [图](browser-ce43.png) |
| 50 | key_worm_trap | 1/0 | pickup | item transferred | [图](browser-ce50.png) |
| 56 | key_turret_trap | 1/0 | pickup | item transferred | [图](browser-ce56.png) |
| 69 | area_trick_statue | 1/0 | read | dormant awakened | [图](browser-ce69.png) |
| 70 | area_worm | 1/0 | read | dormant awakened | [图](browser-ce70.png) |
| 9 | reward_chained_allies | 1/0 | pickup | item transferred | [图](browser-ce9.png) |
| 11 | reward_vampire_lair | 1/0 | move | dormant awakened | [图](browser-ce11.png) |
| 12 | reward_legendary_ally | 1/0 | pickup | item transferred | [图](browser-ce12.png) |
| 30 | key_fun_with_fire | 1/0 | pickup | item transferred | [图](browser-ce30.png) |
| 33 | key_thief_area | 1/0 | move | monster killed | [图](browser-ce33.png) |
| 42 | key_burning_grass | 1/0 | pickup | item transferred | [图](browser-ce42.png) |
| 45 | key_guardian_gauntlet | 1/0 | pickup | item transferred | [图](browser-ce45.png) |
| 46 | key_guardian_corridor | 1/0 | move | immune monster: HP unchanged | [图](browser-ce46.png) |
| 49 | key_beckoning_obstacle | 1/0 | pickup | item transferred | [图](browser-ce49.png) |
| 53 | key_zombie_crypt | 1/0 | pickup | item transferred | [图](browser-ce53.png) |
| 55 | key_worm_tunnels | 1/0 | pickup | item transferred | [图](browser-ce55.png) |
| 57 | key_boss_secret_room | 1/0 | move | monster killed | [图](browser-ce57.png) |
| 59 | ce_59_shrine | 1/0 | pickup | item transferred | [图](browser-ce59.png) |
| 71 | ce_71_sentinels | 1/0 | move | monster killed | [图](browser-ce71.png) |
| 31 | ce_31_environment | 1/0 | pickup | item transferred | [图](browser-ce31.png) |
| 34 | ce_34_environment | 1/0 | pickup | item transferred | [图](browser-ce34.png) |
| 36 | ce_36_environment | 1/0 | pickup | item transferred | [图](browser-ce36.png) |
| 37 | ce_37_environment | 1/0 | move | monster killed | [图](browser-ce37.png) |
| 38 | ce_38_environment | 1/0 | pickup | item transferred | [图](browser-ce38.png) |
| 39 | ce_39_environment | 1/0 | pickup | item transferred | [图](browser-ce39.png) |
| 44 | ce_44_environment | 1/0 | move | immune monster: HP unchanged | [图](browser-ce44.png) |
| 65 | ce_65_environment | 1/0 | read | dormant awakened | [图](browser-ce65.png) |
| 66 | ce_66_environment | 1/0 | read | dormant awakened | [图](browser-ce66.png) |
| 32 | key_fire_trap_room | 1/0 | pickup | item transferred | [图](browser-ce32.png) |
| 51 | key_mud_pit | 1/0 | pickup | item transferred | [图](browser-ce51.png) |
| 54 | key_haunted_house | 1/0 | pickup | item transferred | [图](browser-ce54.png) |
| 13 | reward_goblin_warren | 1/0 | move | monster killed | [图](browser-ce13.png) |
| 14 | reward_sentinel_sanctuary | 1/0 | pickup | item transferred | [图](browser-ce14.png) |
| 8 | reward_outsourced_item | 2/0 | pickup | item transferred | [图](browser-ce8.png) |

CE28/47/52 在正确领养输入下未建成，未伪造产物；原因保留在 scenes.json。
