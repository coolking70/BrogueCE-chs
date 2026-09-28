# X3-U8c 最终完整门禁逐文件结果

全量 234 文件：4439 passed / 0 failed / 8 skipped / 5 todo；drift 1 文件 1/1 通过。
反查 157 文件、源码读取守卫 80 文件全部覆盖。没有新增 skipped/todo。

| 文件 | 门禁 | passed | skipped | todo | 状态 | 反查 | 源码读取 |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| `src/data/armors.test.ts` | full | 7 | 0 | 0 | passed |  |  |
| `src/data/hordes.test.ts` | full | 25 | 0 | 0 | passed | 是 |  |
| `src/data/monsterBolts.test.ts` | full | 18 | 0 | 0 | passed | 是 |  |
| `src/data/monsterDamage.test.ts` | full | 3 | 0 | 0 | passed | 是 |  |
| `src/data/monsters.test.ts` | full | 4 | 0 | 0 | passed |  |  |
| `src/data/weapons.test.ts` | full | 13 | 0 | 0 | passed | 是 |  |
| `src/engine/Combat/BoltCatalog.test.ts` | full | 6 | 0 | 0 | passed | 是 | 是 |
| `src/engine/Combat/BoltContract.test.ts` | full | 10 | 0 | 0 | passed |  |  |
| `src/engine/Combat/CombatFormulas.test.ts` | full | 27 | 0 | 4 | passed | 是 |  |
| `src/engine/Core/snapshotQuantity.test.ts` | full | 1 | 0 | 0 | passed |  |  |
| `src/engine/Core/startingKit.test.ts` | full | 5 | 0 | 0 | passed |  |  |
| `src/engine/Items/itemFlavors.test.ts` | full | 6 | 0 | 0 | passed |  |  |
| `src/engine/Random.test.ts` | full | 6 | 0 | 0 | passed |  |  |
| `src/engine/UI/DetailGenerator.test.ts` | full | 5 | 0 | 0 | passed | 是 |  |
| `src/engine/UI/Discoveries.test.ts` | full | 3 | 0 | 0 | passed |  |  |
| `src/test/ai_1_scent_tracking.test.ts` | full | 5 | 0 | 0 | passed | 是 |  |
| `src/test/armor_display_effect.test.ts` | full | 16 | 0 | 0 | passed | 是 |  |
| `src/test/armor_model_effect.test.ts` | full | 2 | 0 | 0 | passed | 是 |  |
| `src/test/armor_runic_effect.test.ts` | full | 12 | 0 | 0 | passed | 是 |  |
| `src/test/b1_retire_invented.test.ts` | full | 44 | 0 | 0 | passed |  |  |
| `src/test/b2_transcription.test.ts` | full | 21 | 0 | 0 | passed |  |  |
| `src/test/b_1_weapon_specials.test.ts` | full | 16 | 0 | 0 | passed | 是 |  |
| `src/test/b_1a_identification.test.ts` | full | 34 | 0 | 0 | passed | 是 | 是 |
| `src/test/b_1b_identification_persistence.test.ts` | full | 14 | 0 | 0 | passed | 是 |  |
| `src/test/b_1c_detect_magic.test.ts` | full | 24 | 0 | 0 | passed |  |  |
| `src/test/b_2_throwing.test.ts` | full | 16 | 0 | 0 | passed | 是 |  |
| `src/test/b_4a_item_generation.test.ts` | full | 24 | 0 | 0 | passed |  |  |
| `src/test/b_4b_item_placement.test.ts` | full | 15 | 0 | 0 | passed |  |  |
| `src/test/blueprint_ce_coverage.test.ts` | full | 18 | 0 | 0 | passed |  |  |
| `src/test/blueprint_center.test.ts` | full | 7 | 0 | 0 | passed | 是 | 是 |
| `src/test/c_0_add_loops.test.ts` | full | 14 | 0 | 0 | passed |  |  |
| `src/test/c_1_room_profile.test.ts` | full | 14 | 0 | 0 | passed |  |  |
| `src/test/c_2_lakes.test.ts` | full | 17 | 0 | 0 | passed |  |  |
| `src/test/c_2_lakes_determinism.test.ts` | full | 1 | 0 | 0 | passed |  |  |
| `src/test/c_2_lakes_e2e.test.ts` | full | 6 | 0 | 0 | passed |  |  |
| `src/test/c_3_walls_doors.test.ts` | full | 15 | 0 | 0 | passed | 是 |  |
| `src/test/c_4a_0_layer_model.test.ts` | full | 20 | 0 | 0 | passed | 是 | 是 |
| `src/test/c_4a_terrain_catalog.test.ts` | full | 30 | 0 | 0 | passed | 是 | 是 |
| `src/test/c_4b_dungeon_feature.test.ts` | full | 31 | 0 | 0 | passed | 是 | 是 |
| `src/test/c_4c_promotion.test.ts` | full | 21 | 0 | 0 | passed | 是 | 是 |
| `src/test/c_5_fall_subsystem.test.ts` | full | 13 | 0 | 0 | passed | 是 |  |
| `src/test/c_6_autogenerators.test.ts` | full | 17 | 0 | 0 | passed |  |  |
| `src/test/c_7_lighting.test.ts` | full | 28 | 0 | 0 | passed | 是 | 是 |
| `src/test/c_8_connectivity.test.ts` | full | 7 | 0 | 0 | passed |  |  |
| `src/test/f_1_fire_as_terrain.test.ts` | full | 11 | 0 | 0 | passed |  |  |
| `src/test/f_2a_fire_mechanics.test.ts` | full | 12 | 0 | 0 | passed |  |  |
| `src/test/f_2b_creature_burning.test.ts` | full | 13 | 0 | 0 | passed | 是 |  |
| `src/test/f_2c_explosion.test.ts` | full | 14 | 0 | 0 | passed | 是 |  |
| `src/test/fe_1_touch.test.ts` | full | 16 | 0 | 0 | passed | 是 | 是 |
| `src/test/g_1_gas_volumetric.test.ts` | full | 16 | 0 | 0 | passed |  |  |
| `src/test/g_2_gas_df_wiring.test.ts` | full | 17 | 0 | 0 | passed |  |  |
| `src/test/g_3_gas_effects.test.ts` | full | 26 | 0 | 0 | passed | 是 |  |
| `src/test/generation_baseline.test.ts` | drift | 1 | 0 | 0 | passed |  |  |
| `src/test/horde_selection.test.ts` | full | 12 | 0 | 0 | passed |  |  |
| `src/test/horde_terrain_spawn.test.ts` | full | 10 | 0 | 0 | passed |  |  |
| `src/test/hunger_curve_sim.test.ts` | full | 3 | 0 | 0 | passed |  |  |
| `src/test/hunger_regen.test.ts` | full | 15 | 0 | 0 | passed |  |  |
| `src/test/i_1_interaction.test.ts` | full | 6 | 0 | 0 | passed | 是 |  |
| `src/test/invented_content_pool.test.ts` | full | 7 | 0 | 0 | passed |  |  |
| `src/test/monster_damage_balance.test.ts` | full | 2 | 0 | 0 | passed | 是 |  |
| `src/test/monster_stats_effect.test.ts` | full | 2 | 0 | 0 | passed | 是 |  |
| `src/test/p1_20_item_placement.test.ts` | full | 1 | 0 | 0 | passed | 是 |  |
| `src/test/p1_24_death_sink.test.ts` | full | 13 | 0 | 0 | passed | 是 |  |
| `src/test/p1_26_invariants.test.ts` | full | 5 | 0 | 0 | passed |  |  |
| `src/test/p1_27_remove_drowning.test.ts` | full | 9 | 0 | 0 | passed | 是 |  |
| `src/test/p1_28_flag_channel.test.ts` | full | 14 | 0 | 0 | passed | 是 |  |
| `src/test/p1_29_adversarial_gate.test.ts` | full | 1 | 0 | 0 | passed |  |  |
| `src/test/p1_29_lake_connectivity.test.ts` | full | 7 | 0 | 0 | passed |  |  |
| `src/test/p1_30_i18n_gate.test.ts` | full | 16 | 0 | 0 | passed | 是 | 是 |
| `src/test/p1_31_35_placement_snapshot.test.ts` | full | 10 | 0 | 0 | passed |  |  |
| `src/test/p1_33_machine_chokepoint.test.ts` | full | 7 | 0 | 0 | passed | 是 |  |
| `src/test/p1_34_loopmap_reset.test.ts` | full | 2 | 0 | 0 | passed | 是 |  |
| `src/test/p1_37_machine_flag_i18n.test.ts` | full | 9 | 0 | 0 | passed | 是 | 是 |
| `src/test/p1_42_secret_door_search.test.ts` | full | 14 | 0 | 0 | passed | 是 | 是 |
| `src/test/p1_46_keybindings.test.ts` | full | 7 | 0 | 0 | passed |  |  |
| `src/test/p2_0_seeded_rng.test.ts` | full | 6 | 0 | 0 | passed | 是 | 是 |
| `src/test/p2_1_tick_architecture.test.ts` | full | 6 | 4 | 0 | passed | 是 | 是 |
| `src/test/p2_2_real_speed.test.ts` | full | 16 | 2 | 0 | passed | 是 | 是 |
| `src/test/p2_3_objective_time.test.ts` | full | 17 | 2 | 0 | passed | 是 | 是 |
| `src/test/p2_4_animation_cadence.test.ts` | full | 13 | 0 | 0 | passed | 是 | 是 |
| `src/test/p2_6_display_settings.test.ts` | full | 19 | 0 | 0 | passed | 是 | 是 |
| `src/test/p4_10_waypoint.test.ts` | full | 7 | 0 | 0 | passed |  |  |
| `src/test/p4_1b_monster_casting.test.ts` | full | 16 | 0 | 0 | passed | 是 |  |
| `src/test/p4_2_monster_summoning.test.ts` | full | 14 | 0 | 0 | passed |  |  |
| `src/test/p4_3_special_monster_flags.test.ts` | full | 12 | 0 | 0 | passed | 是 |  |
| `src/test/p4_4_split_kamikaze.test.ts` | full | 20 | 0 | 0 | passed | 是 |  |
| `src/test/p4_5_melee_specials.test.ts` | full | 24 | 0 | 0 | passed | 是 |  |
| `src/test/p4_6_attack_geometry.test.ts` | full | 14 | 0 | 0 | passed | 是 |  |
| `src/test/p4_7_player_weapon_geometry.test.ts` | full | 17 | 0 | 0 | passed | 是 |  |
| `src/test/p4_8_scent_map.test.ts` | full | 14 | 0 | 0 | passed | 是 |  |
| `src/test/p4_9_safety_map.test.ts` | full | 8 | 0 | 0 | passed |  |  |
| `src/test/r_1_appearance.test.ts` | full | 45 | 0 | 0 | passed | 是 | 是 |
| `src/test/repo_hygiene.test.ts` | full | 2 | 0 | 0 | passed | 是 | 是 |
| `src/test/scroll_effects.test.ts` | full | 20 | 0 | 0 | passed | 是 |  |
| `src/test/smoke.test.ts` | full | 3 | 0 | 1 | passed | 是 |  |
| `src/test/t_1_tail.test.ts` | full | 9 | 0 | 0 | passed |  |  |
| `src/test/u20_inventory.test.ts` | full | 5 | 0 | 0 | passed | 是 |  |
| `src/test/u21c_flare_sidebar.test.ts` | full | 3 | 0 | 0 | passed |  |  |
| `src/test/u21c_terrain_appearance.test.ts` | full | 2 | 0 | 0 | passed |  |  |
| `src/test/u24_hardcoded_text.test.ts` | full | 3 | 0 | 0 | passed | 是 | 是 |
| `src/test/u25_machine_observation.test.ts` | full | 1 | 0 | 0 | passed |  |  |
| `src/test/u_00_new_run.test.ts` | full | 17 | 0 | 0 | passed | 是 |  |
| `src/test/u_01_instance_snapshot.test.ts` | full | 17 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_02a_rng_snapshot.test.ts` | full | 45 | 0 | 0 | passed | 是 |  |
| `src/test/u_02b_level_rng.test.ts` | full | 22 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_03_whole_run_snapshot.test.ts` | full | 14 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_03b_level_travel.test.ts` | full | 36 | 0 | 0 | passed |  |  |
| `src/test/u_04c_machine_cells.test.ts` | full | 7 | 0 | 0 | passed |  |  |
| `src/test/u_05_machine_items.test.ts` | full | 19 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_05a_item_ownership.test.ts` | full | 51 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_06_monster_damage.test.ts` | full | 37 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_07_monster_blink.test.ts` | full | 53 | 0 | 0 | passed | 是 |  |
| `src/test/u_08_terrain_bolts.test.ts` | full | 32 | 0 | 0 | passed | 是 |  |
| `src/test/u_09_learning_consumers.test.ts` | full | 72 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_10_absorption_snapshot.test.ts` | full | 40 | 0 | 0 | passed | 是 |  |
| `src/test/u_11_corpse_learning.test.ts` | full | 91 | 0 | 0 | passed | 是 |  |
| `src/test/u_12a_cast_eligibility.test.ts` | full | 4 | 0 | 0 | passed |  |  |
| `src/test/u_12b_ally_mode.test.ts` | full | 4 | 0 | 0 | passed |  |  |
| `src/test/u_13_combat_math.test.ts` | full | 40 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_14a_status_gaps.test.ts` | full | 49 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_14b_status_gaps.test.ts` | full | 97 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_15a_shattering.test.ts` | full | 19 | 0 | 0 | passed |  |  |
| `src/test/u_15b2_ring_birth.test.ts` | full | 15 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_15b_rings.test.ts` | full | 8 | 0 | 0 | passed | 是 |  |
| `src/test/u_15c_charms.test.ts` | full | 4 | 0 | 0 | passed |  |  |
| `src/test/u_15d2_armor_runic.test.ts` | full | 7 | 0 | 0 | passed | 是 |  |
| `src/test/u_15d3_runic_generation.test.ts` | full | 7 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_15d_weapon_runic.test.ts` | full | 26 | 0 | 0 | passed | 是 |  |
| `src/test/u_15e_potions.test.ts` | full | 4 | 0 | 0 | passed |  |  |
| `src/test/u_15f_food.test.ts` | full | 4 | 0 | 0 | passed | 是 |  |
| `src/test/u_16_lifecycle.test.ts` | full | 5 | 0 | 0 | passed |  |  |
| `src/test/u_17a_df_transaction.test.ts` | full | 27 | 0 | 0 | passed | 是 |  |
| `src/test/u_17b_carriers.test.ts` | full | 20 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_17c_triggers.test.ts` | full | 17 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_17d_vents.test.ts` | full | 31 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_17e_altars.test.ts` | full | 25 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_17f_carriers.test.ts` | full | 18 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_18_water_cage.test.ts` | full | 6 | 0 | 0 | passed |  |  |
| `src/test/u_18a_2_generation_terrain.test.ts` | full | 32 | 0 | 0 | passed |  |  |
| `src/test/u_18a_3_generation.test.ts` | full | 26 | 0 | 0 | passed |  |  |
| `src/test/u_18a_terrain_contracts.test.ts` | full | 24 | 0 | 0 | passed |  |  |
| `src/test/u_19a_machine_view.test.ts` | full | 32 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_19b_pending_occupancy.test.ts` | full | 18 | 0 | 0 | passed |  |  |
| `src/test/u_19c_immediate_entities.test.ts` | full | 20 | 0 | 0 | passed |  |  |
| `src/test/u_19d_machine_families.test.ts` | full | 24 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_19e_machine_families.test.ts` | full | 17 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_19f_autogen.test.ts` | full | 28 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_19f_fire.test.ts` | full | 3 | 0 | 0 | passed | 是 |  |
| `src/test/u_19f_machines.test.ts` | full | 3 | 0 | 0 | passed |  |  |
| `src/test/u_23_memory_mapping.test.ts` | full | 2 | 0 | 0 | passed |  |  |
| `src/test/u_26a_deep_baseline.test.ts` | full | 1 | 0 | 0 | passed |  |  |
| `src/test/u_26a_deep_levels.test.ts` | full | 16 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_26b_endgame.test.ts` | full | 5 | 0 | 0 | passed |  |  |
| `src/test/u_27_recording.test.ts` | full | 5 | 0 | 0 | passed | 是 |  |
| `src/test/u_r1_codec.test.ts` | full | 2 | 0 | 0 | passed |  |  |
| `src/test/u_r2_trace.test.ts` | full | 1 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_r3_trace.test.ts` | full | 1 | 0 | 0 | passed | 是 | 是 |
| `src/test/u_r4_trace.test.ts` | full | 1 | 0 | 0 | passed | 是 | 是 |
| `src/test/ui_1_rendering.test.ts` | full | 32 | 0 | 0 | passed | 是 | 是 |
| `src/test/ui_2_protection.test.ts` | full | 11 | 0 | 0 | passed | 是 | 是 |
| `src/test/v_1a_blueprint_items.test.ts` | full | 8 | 0 | 0 | passed | 是 | 是 |
| `src/test/v_1b_alternative.test.ts` | full | 9 | 0 | 0 | passed |  |  |
| `src/test/v_1c_machine_structure.test.ts` | full | 12 | 0 | 0 | passed |  |  |
| `src/test/v_2a_vestibule_return.test.ts` | full | 3 | 0 | 0 | passed |  |  |
| `src/test/v_2b_2a_placement_flags.test.ts` | full | 27 | 0 | 0 | passed |  |  |
| `src/test/v_2b_2b_blueprints.test.ts` | full | 24 | 0 | 0 | passed |  |  |
| `src/test/v_2b_3_wired.test.ts` | full | 28 | 0 | 0 | passed |  |  |
| `src/test/v_2b_4_altars.test.ts` | full | 36 | 0 | 0 | passed | 是 | 是 |
| `src/test/v_2b_5_dormant.test.ts` | full | 17 | 0 | 0 | passed |  |  |
| `src/test/v_2b_6_keys.test.ts` | full | 18 | 0 | 0 | passed |  |  |
| `src/test/v_2b_7_features.test.ts` | full | 22 | 0 | 0 | passed | 是 | 是 |
| `src/test/v_2b_8_autogen.test.ts` | full | 2 | 0 | 0 | passed |  |  |
| `src/test/v_2b_9a_carriers.test.ts` | full | 2 | 0 | 0 | passed |  |  |
| `src/test/v_2b_9b_environment.test.ts` | full | 4 | 0 | 0 | passed | 是 | 是 |
| `src/test/v_2b_9c_effects.test.ts` | full | 10 | 0 | 0 | passed | 是 | 是 |
| `src/test/v_2b_9d_dungeon_profile.test.ts` | full | 11 | 0 | 0 | passed | 是 | 是 |
| `src/test/v_2b_9e_2_autogen.test.ts` | full | 16 | 0 | 0 | passed |  |  |
| `src/test/v_2b_9e_area_machine.test.ts` | full | 44 | 0 | 0 | passed |  |  |
| `src/test/w_10_poison.test.ts` | full | 38 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_11_teleport_placement.test.ts` | full | 37 | 0 | 0 | passed | 是 |  |
| `src/test/w_12_blink_beckoning.test.ts` | full | 50 | 0 | 0 | passed | 是 |  |
| `src/test/w_13_tunneling.test.ts` | full | 43 | 0 | 0 | passed | 是 |  |
| `src/test/w_14_obstruction.test.ts` | full | 24 | 0 | 0 | passed | 是 |  |
| `src/test/w_15_shielding.test.ts` | full | 57 | 0 | 0 | passed | 是 |  |
| `src/test/w_16_conjuration.test.ts` | full | 45 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_17_domination.test.ts` | full | 42 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_18_entrancement.test.ts` | full | 67 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_19_polymorph.test.ts` | full | 53 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_20_cloning.test.ts` | full | 57 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_21_empowerment.test.ts` | full | 29 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_23_negation.test.ts` | full | 42 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_24_wand_catalog.test.ts` | full | 20 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_25_staff_catalog.test.ts` | full | 31 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_26_arcana_closure.test.ts` | full | 49 | 0 | 0 | passed | 是 |  |
| `src/test/w_2_arcana_submission.test.ts` | full | 30 | 0 | 0 | passed | 是 |  |
| `src/test/w_3_bolt_trajectory.test.ts` | full | 30 | 0 | 0 | passed | 是 |  |
| `src/test/w_4_bolt_reflection.test.ts` | full | 29 | 0 | 0 | passed | 是 |  |
| `src/test/w_5_arcana_instance.test.ts` | full | 18 | 0 | 0 | passed |  |  |
| `src/test/w_6_arcana_recharge.test.ts` | full | 28 | 0 | 0 | passed | 是 |  |
| `src/test/w_7_arcana_enchantment.test.ts` | full | 30 | 0 | 0 | passed | 是 | 是 |
| `src/test/w_8_staff_damage.test.ts` | full | 33 | 0 | 0 | passed | 是 |  |
| `src/test/w_9_directed_status.test.ts` | full | 77 | 0 | 0 | passed | 是 |  |
| `src/test/x2a_recording_checkpoint.test.ts` | full | 4 | 0 | 0 | passed | 是 |  |
| `src/test/x2b_terrain_derivation.test.ts` | full | 20 | 0 | 0 | passed | 是 | 是 |
| `src/test/x2c_hit_status_owner.test.ts` | full | 6 | 0 | 0 | passed |  |  |
| `src/test/x2d_scroll_equipment.test.ts` | full | 34 | 0 | 0 | passed | 是 |  |
| `src/test/x2e_charms.test.ts` | full | 11 | 0 | 0 | passed | 是 | 是 |
| `src/test/x2f_thrown_math.test.ts` | full | 9 | 0 | 0 | passed | 是 | 是 |
| `src/test/x2g_native_effects.test.ts` | full | 17 | 0 | 0 | passed | 是 | 是 |
| `src/test/x2h_test_mode_reachability.test.ts` | full | 1 | 0 | 0 | passed |  |  |
| `src/test/x2i_discovery_text.test.ts` | full | 4 | 0 | 0 | passed | 是 |  |
| `src/test/x2i_i18n_flow.test.ts` | full | 1 | 0 | 0 | passed | 是 | 是 |
| `src/test/x2j_monster_ai.test.ts` | full | 38 | 0 | 0 | passed | 是 |  |
| `src/test/x2k_lifecycle.test.ts` | full | 16 | 0 | 0 | passed | 是 | 是 |
| `src/test/x2l_reflected_death.test.ts` | full | 2 | 0 | 0 | passed | 是 |  |
| `src/test/x2m_lighting.test.ts` | full | 18 | 0 | 0 | passed | 是 | 是 |
| `src/test/x2n_lumenstone_description.test.ts` | full | 10 | 0 | 0 | passed |  |  |
| `src/test/x2o_horde_clump.test.ts` | full | 8 | 0 | 0 | passed | 是 | 是 |
| `src/test/x3_u1_movement_safety.test.ts` | full | 33 | 0 | 0 | passed | 是 |  |
| `src/test/x3_u2_ally_captive.test.ts` | full | 32 | 0 | 0 | passed | 是 |  |
| `src/test/x3_u3_cursed_equipment.test.ts` | full | 65 | 0 | 0 | passed | 是 |  |
| `src/test/x3_u4_auto_travel.test.ts` | full | 38 | 0 | 0 | passed | 是 |  |
| `src/test/x3_u5_commands.test.ts` | full | 44 | 0 | 0 | passed | 是 |  |
| `src/test/x3_u5_ui.test.ts` | full | 7 | 0 | 0 | passed | 是 | 是 |
| `src/test/x3_u6_messages.test.ts` | full | 51 | 0 | 0 | passed | 是 | 是 |
| `src/test/x3_u7_sidebar.test.ts` | full | 21 | 0 | 0 | passed | 是 |  |
| `src/test/x3_u8b_items.test.ts` | full | 32 | 0 | 0 | passed | 是 |  |
| `src/test/x3_u8c_combat_items.test.ts` | full | 14 | 0 | 0 | passed | 是 | 是 |
| `src/test/x3a_live_iteration.test.ts` | full | 23 | 0 | 0 | passed | 是 | 是 |
| `src/test/x3b_display_recording.test.ts` | full | 4 | 0 | 0 | passed | 是 |  |
| `src/test/x3b_item_details.test.ts` | full | 13 | 0 | 0 | passed | 是 |  |
| `src/test/x4_r1_world_catalog.test.ts` | full | 10 | 0 | 0 | passed | 是 | 是 |
| `src/test/x4_r4_item_details.test.ts` | full | 23 | 0 | 0 | passed | 是 |  |
| `src/test/x4a_movement_rendering.test.ts` | full | 21 | 0 | 0 | passed | 是 | 是 |
| `src/test/x4b_flavor_text.test.ts` | full | 9 | 0 | 0 | passed | 是 | 是 |
