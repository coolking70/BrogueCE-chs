# X3a 怪物名单消费盘点

范围是工作项目 `brogue-web/src` 的全部 `.ts`、`.vue` 生产源，包括组件、活跃表、休眠表、相邻层表、可见缓存及参数别名；测试和历史脚本的名单读数属于验证/观测载体，不作产品活体筛选改写；静态怪物目录也不当成运行时怪物表。没有修改同仓的旧 `brogueweb` 产品分支或 CE 源码。

复现：仓库根执行 `node brogue-web/scripts/x3a-inventory.mjs`。`consumer-inventory.json` 保存 AST 盘点的 **245** 个表达式（包含嵌套调用、转发和非活体引用，不是 245 个独立缺陷），覆盖 **26** 个文件；`raw-roster-references.txt` 与 `secondary-rosters.txt` 是独立全文反查，补足集合别名、指针/表成员检查和缓存。CE 的 **84** 个迭代/直接链表锚点在 `ce-consumer-inventory.json`；自动提取的 scope 只是导航提示（如 `monsterAtLoc` 的指针返回签名会归到前一函数），下表函数名与语义按原文件人工核实。

缩写：G=`src/engine/Core/Game.ts`，M=`src/entities/Monster.ts`；CE 路径均相对 `BrogueCE-master/src/brogue/`。**保留 HP 守卫**表示完成死亡事务必为 `hp=0`，该消费者已经拒绝它；不借本轮把所有 HP 检查替换为标记，以免改变事务进行中的既有调用门槛。新增迭代器本身只看 `deathProcessed`，不会把尚未完成的 `hp=0` 事务误当成 `MB_HAS_DIED`。

| web 消费点 | CE 实际访问方式/依据 | 本轮裁决 |
|---|---|---|
| MonsterAI.updateMonsterState | Monsters.c:1754，player 优先 + iterateCreatures(monsters) | **改**：玩家顺序不变，怪物排除完成死亡者；不向纯 `monsterFleesFrom` 敌我谓词硬塞 HP 规则。 |
| MonsterAI.wakeMonster | Monsters.c:1601 wakeUp，iterateCreatures | 复用新迭代器，保留原 mate HP/模式/队友守卫。 |
| MonsterBlink.closestBlinkEnemy | Monsters.c:3093 moveAlly，iterateCreatures | 复用新迭代器；原 attacks 已拒绝 HP≤0，保留其不可见性掷骰短路。 |
| MonsterBlink.buildBlinkEnemyMap | Monsters.c:3189，iterateCreatures | 同上；不改严格 `< shortest`、扫描顺序和 RNG 条件。 |
| MonsterBlink.monsterAvoidsCorridor 随从存在性 | Monsters.c:1503–1510 用 MB_LEADER/MB_FOLLOWER；Combat.c:2044–2045 死亡时 checkForContinuedLeadership；后者 Monsters.c:4090 用 iterateCreatures | **改**：web 从名单派生 leader 状态时跳过死亡随从，保留尸体关系指针。 |
| M.eligibleForCombatBuff | Monsters.c:2576 targetEligibleForCombatBuff，player+iterateCreatures | 原 `enemy.hp > 0` 拒死；不改。 |
| M.countMinions / trySummon | Monsters.c:2423/2435/2443，当前层及相邻层 iterateCreatures | 原 ally/follower 计数均 HP>0；本轮保持既有当前层计数范围，不移动生成/召唤骰。 |
| M.tryUseBolt | Monsters.c:2794，player+iterateCreatures | 候选构建 HP>0，逐目标再检查 HP；不改。 |
| M.moveEntranced 抓取者查找 | Movement.c:717 / Monsters.c:3790 iterateCreatures | HP>0 + seizing/敌对；不改。 |
| M.takeTurn 敌对相邻盟友查找 | Monsters.c:3446/3576 iterateCreatures | `willAttackTarget` 拒绝 HP≤0，之后才投不可见性骰；不改。 |
| M.takeTurn 一般盟友选敌/气味 | moveAlly 的 iterateCreatures；气味逐格查询 | 转发 closestBlinkEnemy；气味 canEnter 用 getMonsterAt，已过滤完成者。 |
| MonsterAbsorption.anyoneWantABite | Combat.c:1687/1702，iterateCreatures，两趟选择 | 原 HP>0、!deathProcessed、!isDormant；尸体是效果载荷，不过滤 decedent 参数。 |
| G.restoreLevelResidents | RogueMain.c:630 / Architect.c:3558 restoreMonster，iterateCreatures | 原 HP≤0 continue；不改。 |
| G.monstersApproachStairs | Time.c:2192 邻层 iterateCreatures | 稳定副本 + HP≤0 continue；不改。 |
| G.monsterEntersLevel 占用与旧 leader | RogueMain.c/Time.c 的 monsterAtLoc 与关系成员检查 | 占用 HP>0；死亡时既有 demotion 先断活随从关系；未把存读图成员检查改成活体序列化。 |
| G.hasCreatureAtForLight | Light.c:paintLight 的 HAS_PLAYER/HAS_MONSTER 地图旗标 | 原 HP>0；保持已有光遮挡/死亡事务边界。 |
| G.updateVision 固有、变异、祭献、燃烧光 | Light.c:240 player+iterateCreatures；:260 dormant telepathy 另表 | 两个 active 光循环均有 HP 守卫；不改，灯光与扫后相同的新守卫覆盖。未扩展既有休眠心灵光近似。 |
| G.update 可见发现、handleExamineNearest | Time.c:917 / IO.c:3824 iterateCreatures + canSeeMonster | canSeeMonster 已含 HP≤0；不改。 |
| G.performPlayerAction 开笼救援扫描 | CE Movement.c:1160–1206 useKeyAt/monsterAtLoc；格旗标在死亡时移除 | **改**：web 的邻域兼容扫描不再把已死囚犯转为盟友/purgatory 候选。未改变开锁范围规则。 |
| G.negationBlastFromPlayer | Items.c:4836 iterateCreatures | 稳定 cohort 每次 HP≤0 continue；连锁死亡不会再次施法；不改。 |
| G.discordBlastFromPlayer | Items.c:4889 iterateCreatures | 原 HP≤0 continue；不改。 |
| G.tryTriggerArmorRunic mutuality | Combat.c:983–1011，8 邻格 HAS_MONSTER + monsterAtLoc，命中时检查 MB_IS_DYING | 原候选 HP>0，takeDamage 对死者无效；不改原几何/效果范围。 |
| G.tickCreatureStatuses | Time.c:2668/2674/2681 iterateCreatures | recoverPerTick、resolveBurningDamage、resolvePoisonDamage 内部 HP 守卫；后续状态递减/僵尸 DF 循环显式 HP；不改。 |
| G.buildLungeFlailHitList | Movement.c:1030 iterateCreatures；突进按格查询 | `canStrike → playerWillAttackTarget` 检查 HP；不改。 |
| G.alliedCloneCount | Combat.c:182/192/204 各层 iterateCreatures | 原 HP>0；不改既有计数范围。 |
| G.moveEntrancedMonsters | Movement.c:717 iterateCreatures | 稳定 cohort；Monster.moveEntranced 入口 HP 门；不改。 |
| G.findLiveSeizer | Movement.c:1268 iterateCreatures | 显式 HP>0；不改。 |
| G.monstersFall | Time.c:1535 iterateCreatures | 稳定副本 + HP≤0 continue；物理换表规则不改。 |
| G.killOrphanedBoundFollowers | Time.c:2558 iterateCreatures | 原 HP>0 且 bound/leader/ally 门；不改。 |
| G.applyEnvironmentalEffects | Time.c:2674 等 iterateCreatures + instant effects | checkEntity 入口 HP≤0 return，逐次动态检查；不改。 |
| G.bindDungeonFeatureEffects creatures/instantEffects | Architect.c:evacuateCreatures / spawnDungeonFeature 格旗标、monsterAtLoc | 原 HP>0 + 非休眠，DF evacuateCreatures 只得到过滤后快照；不改。 |
| G.aggravateMonsters | Items.c:4099 iterateCreatures | 原 HP≤0 / isDormant continue；气味重写的是地格，不是怪物列表；不改。 |
| G.awakenDormantMonstersAt | Architect.c:3489 iterateCreatures(dormantMonsters) | **改**：稳定 cohort 上跳过完成死亡者，避免移动/激活尸体和额外 RNG；仍保留直接 toggle 的成员管理语义。 |
| G.demoteMonsterFromLeadership active、邻层 | Monsters.c:4116 iterateCreatures(nearbyList) | 在原 HP 门之外复用迭代器；当前层优先、绑定随从/候选顺序不变。 |
| G.demoteMonsterFromLeadership dormant、邻层 | Monsters.c:4146 iterateCreatures(candidateList) | **改**：已死休眠随从不参加解绑；活体照旧解绑。 |
| G.handleAutoExplore 邻敌及 already-seen 缓存 | Movement.c:2278 iterateCreatures，随后 adjacentFightingDir 逐格查活怪 | **改**：派生 visibleMonsters 缓存可能尚未重建，使用新迭代器复核，防止向尸体走位/记录。 |
| G.stepAutoPathInner 自动攻击/发现 | Movement.c:1851/2278 iterateCreatures；行进中格占用查询 | **改**：旧可见缓存里的尸体不得偏转或中止路径；鼠标占用仍走 getMonsterAt。 |
| TimeCoordinator.advancementLoop soonest/扣 tick/行动 | Time.c:2645/2652/2717 iterateCreatures | 所有循环原有 HP>0；行动用稳定 cohort，寄宿新生对象的调度时点不动。 |
| TimeCoordinator.playerTurnEnded safety 预构建 | Time.c:2620 iterateCreatures | 原 HP>0 + FLEEING + 可见；不改。 |
| WaypointMap.refreshWaypoint | Architect.c:3019 iterateCreatures | 原 HP≤0 continue；睡眠/固定/囚禁代价不吃尸体。 |
| SafetyMap 与 Blink safe/ally/target maps | Time.c:updateSafetyMap、Monsters.c 对各格 HAS_MONSTER 查询 | world.monsterAt/getMonsterAt；完成者不占格，保留 DYING 占用；不改。 |
| ScentMap、M 跟味路径 | Time.c:scentDistance、Monsters.c:scentDirection 按地格 | ScentMap 本身不读怪物表；M 的 canEnter 委托 getMonsterAt，已测方向与 RNG 扫前后一致。 |
| LevelTravel.travelDistanceMap/scheduleLevelFollowers/travelPlacement | RogueMain.c:startLevel / Time.c:monstersApproachStairs iterateCreatures + 距离图/占用 | 原 HP 门；不改。 |
| CreaturePlacement.canPlaceCreature/teleportCandidates | Grid.c:getQualifyingPathLocNear、CE 各安置调用的地图旗标 | 原 HP>0、非休眠等调用专用门；保持 X2k 安置合同，不全局替换为 HP-independent 迭代器。 |
| CreaturePlacement.captiveItemDropCandidates | Monsters.c:makeMonsterDropItem 不禁止 HAS_MONSTER | 不读怪物占用，允许死亡者原格落物；不改。 |
| Cloning.cloneLocation / Conjuration.bladeSpawnLocation | Monsters.c:cloneMonster、Items.c conjuration 的 HAS_MONSTER | 原 HP>0/!isDormant；不改。 |
| ItemUseCoordinator.boltWorldFor | Items.c:getImpactLoc/zap 按格读取 HAS_MONSTER | 原 HP>0/!isDormant；不改既有碰撞口径。 |
| BlinkTargeting.blinkTargetPreview | Items.c:getImpactLoc 按格占用 | 原 HP>0/!isDormant/hidden 门；不改。 |
| BoltTargeting.arcanaTargetCandidates 及中间阻挡 | Items.c:5935–6032 目标类别 + getImpactLoc | 候选 HP 门、可见门，中间阻挡 HP>0；不改。 |
| GameCanvas.render / render_game_to_text（两个 script 块均读） | IO.c:refreshSideBar，格占用/visibility；UI 并非直接保留所有链表项 | canSeeMonster、canDirectlySeeMonster、canDisplayMonster / monsterAppearance 的 HP 门；不改。 |
| MonsterSidebar.visibleMonsterRows / Sidebar.vue 转发 | IO.c:3824 iterateCreatures + visibility | 原 canSeeMonster；不改。 |
| AgentControls.vue 辅助状态 | web 专属呈现入口；遵循与侧栏一致的活体名单合同 | **改**：跳过完成死亡者，实际 DOM 断言无 HP=0 行；不改变其原距离/隐藏信息策略。 |
| MonsterVisibility canSee/direct/display | CE 可见判断结合 iterateCreatures/格旗标调用 | 原 HP 门；死亡文案专用 canSeeMonsterAtDeath 另行绕开该门，保持不动。 |

## 必须访问原表的非活体消费者

| web 消费点 | CE/既有载体依据 | 保留理由 |
|---|---|---|
| G.killMonster / triggerDeathFeatures / removeDeadMonsters | Combat.c:1934–2045 同步事务；RogueMain.c:951–980 **直接 creatureListNode 链表** | 必须找到死者才能做 drop/DF、清扫及 purgatory；不套活体迭代器，不提前摘链。 |
| G.getMonsterAt | Monsters.c:2050–2070 先读 HAS_MONSTER，再 iterateCreatures；Combat.c:2007–2015 死亡位与占用同步切换 | 保留 `hp>0 || (dyingMonsters.has(m) && !m.deathProcessed)`，死亡事务内仍可见占用，完成后消失。 |
| G.resurrectAlly 的 purgatory 排序 | CE Monsters.c:2899 使用 iterateCreatures，但 RogueMain.c:968 **入 purgatory 时已清 MB_HAS_DIED** | web X2k 载体保留 deathProcessed，复活时清除；因此保留原 purgatory 读取，不能机械套新 helper。 |
| MonsterLifecycle.ownedMonsterList / notifyMonsterDeath | web 所有权与 X2k 通知层，无 CE JS Proxy 对应物 | 所有实例均需绑定 owner，memberships 包含死者才能幂等重入；保留原表。 |
| G.generateDepth 的 mapToMe 清理、层引用 | 缓存清理/换层图维护 | 不做活体决策、不投骰；保留所有实例的图关联。 |
| G.summonMinionsFor 摘下 summoner/回退、G.toggleMonsterDormancy | CE removeCreature/prependCreature 显式表变更 | 身份移除/寄宿不是死亡，保留物理操作；外围活体扫描已核查。 |
| G.resetTestRoom、GenerationCoordinator.remove/createMachineRuntime | test 场景恢复、机器失败回滚/携物所有权事务 | 原名单身份集合必须完整；不能因死者过滤丢载荷或改变生成事务。 |
| EntitySnapshot、WholeRunSnapshot、G.snapshotRunState/toSnapshot/loadSnapshot/restoreMonsterLeaders | U01/U03 的完整实体图合同，含 leader/carried/purgatory/history | 序列化、反序列化、ID 高水位、历史可见记录均保留原表，不把快照当活体集合。 |
| GenerationCoordinator.placeStairs 的位置预留集合 | Architect.c:3690–3743 楼梯位置、地图旗标；web 还合并待实现的机器 itemSpawns/monsterSpawns | 这是构造期位置预留集合，原 `monsters.map(loc)` / `dormantMonsters.map(loc)` **没有 HP 门**。按本轮不移动生成流约束保持；独立只读插桩执行原 U26a D1–40 基线，165 次楼梯事务的 active+dormant 完成死亡数全部为 0，基线仍过。不声称任意手造生成预留载荷也等价于 CE 活体查询。 |
| GenerationCoordinator.populateLevel 的 beforeIds/trace、createMachineRuntime 回滚；GenerationPlacement 占用 | Architect.c/buildAMachine/startLevel 的生成与事务产物 | 运行时 hasMonster/生成距离等原 HP 门已排死亡者；trace、pending、回滚携物及休眠旗标重建是生成事务载体，保留且不增加骰。 |
| G.findTerrainSpawnLocation/findMinionSpawnSpot/summonMonstersAroundPlayer | 原格占用 getMonsterAt、休眠 HP 门及 CreaturePlacement | 检查最终被调 helper，无遗漏裸活体扫描；生成流保持原样。 |
| Polymorph.knownPolymorphSpecies/polymorphSpecies、G.resolveBlueprintMonster | 静态 `monsters.json` 原型目录 | 不是 Monster 实例/活体表，不过滤。 |
| DetailGenerator.effectAt、i18n/注释中的 monsters | 数值/目录文案，不读取当前 game.monsters | AST/全文命中是文字或静态元数据，排除假阳性。 |

保留边界：这是“已完成死亡事务对象是否参与活体判断”的盘点，不声称将原来有登记的跨层召唤计数、光照近似、所有寻路、生成构造或 CE 内存链表 API 逐指令移植。CE 函数的游标会预取 next；web generator 在每次访问时复核完成标记，发生嵌套死亡时不会把已经完成的对象重新交给消费者。会改变成员关系的新增调用（DF 唤醒）仍用原稳定 cohort；未改变玩家/怪物顺序、召唤插入或 TimeCoordinator 的调度队列。
