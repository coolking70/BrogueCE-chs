# X3-U8b 实际执行清单

全部单 worker。83 文件首轮为 1839 passed / 1 failed / 4 skipped / 4 todo；修正后以全部直接调用反查与固定回归组复验结果覆盖对应文件，未将首轮宣称为 exit 0。表中标明最后验证来源；另有两轮 test:drift 均通过。

| 文件 | 最后验证 | 结果 | 通过 | 失败 | skip | todo |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| src/data/armors.test.ts | 83 文件首轮 | passed | 7 | 0 | 0 | 0 |
| src/data/weapons.test.ts | 83 文件首轮 | passed | 13 | 0 | 0 | 0 |
| src/engine/Combat/CombatFormulas.test.ts | 83 文件首轮 | passed | 27 | 0 | 0 | 4 |
| src/engine/Core/startingKit.test.ts | 83 文件首轮 | passed | 5 | 0 | 0 | 0 |
| src/test/armor_display_effect.test.ts | 83 文件首轮 | passed | 16 | 0 | 0 | 0 |
| src/test/armor_model_effect.test.ts | 83 文件首轮 | passed | 2 | 0 | 0 | 0 |
| src/test/armor_runic_effect.test.ts | 83 文件首轮 | passed | 12 | 0 | 0 | 0 |
| src/test/b_1_weapon_specials.test.ts | 83 文件首轮 | passed | 16 | 0 | 0 | 0 |
| src/test/b_1a_identification.test.ts | 修正后复验 | passed | 34 | 0 | 0 | 0 |
| src/test/b_1b_identification_persistence.test.ts | 83 文件首轮 | passed | 14 | 0 | 0 | 0 |
| src/test/b_1c_detect_magic.test.ts | 83 文件首轮 | passed | 24 | 0 | 0 | 0 |
| src/test/b_2_throwing.test.ts | 83 文件首轮 | passed | 16 | 0 | 0 | 0 |
| src/test/b_4a_item_generation.test.ts | 83 文件首轮 | passed | 24 | 0 | 0 | 0 |
| src/test/b_4b_item_placement.test.ts | 83 文件首轮 | passed | 15 | 0 | 0 | 0 |
| src/test/c_7_lighting.test.ts | 83 文件首轮 | passed | 28 | 0 | 0 | 0 |
| src/test/fe_1_touch.test.ts | 修正后复验 | passed | 16 | 0 | 0 | 0 |
| src/test/i_1_interaction.test.ts | 修正后复验 | passed | 6 | 0 | 0 | 0 |
| src/test/p1_30_i18n_gate.test.ts | 修正后复验 | passed | 16 | 0 | 0 | 0 |
| src/test/p1_42_secret_door_search.test.ts | 83 文件首轮 | passed | 14 | 0 | 0 | 0 |
| src/test/p2_2_real_speed.test.ts | 83 文件首轮 | passed | 16 | 0 | 2 | 0 |
| src/test/p2_3_objective_time.test.ts | 修正后复验 | passed | 17 | 0 | 2 | 0 |
| src/test/p4_7_player_weapon_geometry.test.ts | 83 文件首轮 | passed | 17 | 0 | 0 | 0 |
| src/test/t_1_tail.test.ts | 83 文件首轮 | passed | 9 | 0 | 0 | 0 |
| src/test/u_01_instance_snapshot.test.ts | 83 文件首轮 | passed | 17 | 0 | 0 | 0 |
| src/test/u_03_whole_run_snapshot.test.ts | 修正后复验 | passed | 14 | 0 | 0 | 0 |
| src/test/u_03b_level_travel.test.ts | 修正后复验 | passed | 36 | 0 | 0 | 0 |
| src/test/u_05_machine_items.test.ts | 83 文件首轮 | passed | 19 | 0 | 0 | 0 |
| src/test/u_05a_item_ownership.test.ts | 83 文件首轮 | passed | 51 | 0 | 0 | 0 |
| src/test/u_06_monster_damage.test.ts | 83 文件首轮 | passed | 37 | 0 | 0 | 0 |
| src/test/u_11_corpse_learning.test.ts | 83 文件首轮 | passed | 91 | 0 | 0 | 0 |
| src/test/u_13_combat_math.test.ts | 83 文件首轮 | passed | 40 | 0 | 0 | 0 |
| src/test/u_14a_status_gaps.test.ts | 83 文件首轮 | passed | 49 | 0 | 0 | 0 |
| src/test/u_14b_status_gaps.test.ts | 修正后复验 | passed | 97 | 0 | 0 | 0 |
| src/test/u_15b_rings.test.ts | 83 文件首轮 | passed | 8 | 0 | 0 | 0 |
| src/test/u_15b2_ring_birth.test.ts | 修正后复验 | passed | 15 | 0 | 0 | 0 |
| src/test/u_15d_weapon_runic.test.ts | 83 文件首轮 | passed | 26 | 0 | 0 | 0 |
| src/test/u_15d2_armor_runic.test.ts | 83 文件首轮 | passed | 7 | 0 | 0 | 0 |
| src/test/u_15d3_runic_generation.test.ts | 83 文件首轮 | passed | 7 | 0 | 0 | 0 |
| src/test/u_17d_vents.test.ts | 83 文件首轮 | passed | 31 | 0 | 0 | 0 |
| src/test/u_17e_altars.test.ts | 83 文件首轮 | passed | 25 | 0 | 0 | 0 |
| src/test/u_17f_carriers.test.ts | 83 文件首轮 | passed | 18 | 0 | 0 | 0 |
| src/test/u_18_water_cage.test.ts | 83 文件首轮 | passed | 6 | 0 | 0 | 0 |
| src/test/u_19b_pending_occupancy.test.ts | 83 文件首轮 | passed | 18 | 0 | 0 | 0 |
| src/test/u_19c_immediate_entities.test.ts | 83 文件首轮 | passed | 20 | 0 | 0 | 0 |
| src/test/u_26a_deep_levels.test.ts | 83 文件首轮 | passed | 16 | 0 | 0 | 0 |
| src/test/u_27_recording.test.ts | 修正后复验 | passed | 5 | 0 | 0 | 0 |
| src/test/u_r2_trace.test.ts | 修正后复验 | passed | 1 | 0 | 0 | 0 |
| src/test/u_r3_trace.test.ts | 修正后复验 | passed | 1 | 0 | 0 | 0 |
| src/test/u_r4_trace.test.ts | 修正后复验 | passed | 1 | 0 | 0 | 0 |
| src/test/u20_inventory.test.ts | 83 文件首轮 | passed | 5 | 0 | 0 | 0 |
| src/test/u24_hardcoded_text.test.ts | 修正后复验 | passed | 3 | 0 | 0 | 0 |
| src/test/v_1a_blueprint_items.test.ts | 83 文件首轮 | passed | 8 | 0 | 0 | 0 |
| src/test/v_2b_4_altars.test.ts | 83 文件首轮 | passed | 36 | 0 | 0 | 0 |
| src/test/v_2b_9c_effects.test.ts | 83 文件首轮 | passed | 10 | 0 | 0 | 0 |
| src/test/v_2b_9d_dungeon_profile.test.ts | 83 文件首轮 | passed | 11 | 0 | 0 | 0 |
| src/test/v_2b_9e_2_autogen.test.ts | 83 文件首轮 | passed | 16 | 0 | 0 | 0 |
| src/test/w_12_blink_beckoning.test.ts | 83 文件首轮 | passed | 50 | 0 | 0 | 0 |
| src/test/w_15_shielding.test.ts | 83 文件首轮 | passed | 57 | 0 | 0 | 0 |
| src/test/w_2_arcana_submission.test.ts | 83 文件首轮 | passed | 30 | 0 | 0 | 0 |
| src/test/w_21_empowerment.test.ts | 83 文件首轮 | passed | 29 | 0 | 0 | 0 |
| src/test/w_4_bolt_reflection.test.ts | 83 文件首轮 | passed | 29 | 0 | 0 | 0 |
| src/test/w_6_arcana_recharge.test.ts | 83 文件首轮 | passed | 28 | 0 | 0 | 0 |
| src/test/x2a_recording_checkpoint.test.ts | 修正后复验 | passed | 4 | 0 | 0 | 0 |
| src/test/x2b_terrain_derivation.test.ts | 83 文件首轮 | passed | 20 | 0 | 0 | 0 |
| src/test/x2d_scroll_equipment.test.ts | 83 文件首轮 | passed | 34 | 0 | 0 | 0 |
| src/test/x2e_charms.test.ts | 83 文件首轮 | passed | 11 | 0 | 0 | 0 |
| src/test/x2f_thrown_math.test.ts | 83 文件首轮 | passed | 9 | 0 | 0 | 0 |
| src/test/x2h_test_mode_reachability.test.ts | 83 文件首轮 | passed | 1 | 0 | 0 | 0 |
| src/test/x2j_monster_ai.test.ts | 83 文件首轮 | passed | 38 | 0 | 0 | 0 |
| src/test/x3_u1_movement_safety.test.ts | 修正后复验 | passed | 33 | 0 | 0 | 0 |
| src/test/x3_u2_ally_captive.test.ts | 修正后复验 | passed | 32 | 0 | 0 | 0 |
| src/test/x3_u3_cursed_equipment.test.ts | 修正后复验 | passed | 65 | 0 | 0 | 0 |
| src/test/x3_u4_auto_travel.test.ts | 修正后复验 | passed | 38 | 0 | 0 | 0 |
| src/test/x3_u5_commands.test.ts | 修正后复验 | passed | 44 | 0 | 0 | 0 |
| src/test/x3_u5_ui.test.ts | 修正后复验 | passed | 7 | 0 | 0 | 0 |
| src/test/x3_u6_messages.test.ts | 修正后复验 | passed | 51 | 0 | 0 | 0 |
| src/test/x3_u7_sidebar.test.ts | 83 文件首轮 | passed | 21 | 0 | 0 | 0 |
| src/test/x3_u8b_items.test.ts | 修正后复验 | passed | 32 | 0 | 0 | 0 |
| src/test/x3b_display_recording.test.ts | 83 文件首轮 | passed | 4 | 0 | 0 | 0 |
| src/test/x3b_item_details.test.ts | 83 文件首轮 | passed | 13 | 0 | 0 | 0 |
| src/test/x4_r4_item_details.test.ts | 83 文件首轮 | passed | 23 | 0 | 0 | 0 |
| src/test/x4a_movement_rendering.test.ts | 修正后复验 | passed | 21 | 0 | 0 | 0 |
| src/test/x4b_flavor_text.test.ts | 83 文件首轮 | passed | 9 | 0 | 0 | 0 |
