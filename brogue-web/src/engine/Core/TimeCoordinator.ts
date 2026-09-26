/** CE objective time and environment scheduling. No Game instance crosses this boundary. */
import type { Game } from './Game';
import type { Grid } from '../Map/Grid';
import type { Pos } from '../../types';
import type { PromotionUpdateResult } from '../Map/Promotion';
import type { Monster } from '../../entities/Monster';
import type { Item } from '../Items/Item';
import type { StatusId } from '../../entities/Creature';
import { ItemCategory } from '../Items/Item';
import { rng } from '../Random';
import { logger } from '../Systems/Logger';
import i18next from 'i18next';
import { DCOLS, DROWS } from '../Map/Grid';
import { MonsterState } from '../../entities/Monster';
import { obstructsScent } from '../Map/Scent';
import { resetDFMessageEligibility } from '../Map/DungeonFeature';
import { TM_PROMOTES_ON_CREATURE, TM_PROMOTES_ON_PLAYER_ENTRY } from '../Map/TerrainCatalog';
import { promoteLayersWithMechFlag, runPromotionUpdate } from '../Map/Promotion';

const SPAWN_FUSE_MIN = 125;
const SPAWN_FUSE_MAX = 175;

export interface WorldPort {
    readonly grid: Game['grid'];
    readonly player: Game['player'];
    readonly monsters: Game['monsters'];
    readonly items: Game['items'];
    readonly environment: Game['environment'];
    readonly waypoints: Game['waypoints'];
    readonly scent: Game['scent'];
    readonly fov: Game['fov'];
    readonly levels: Game['levels'];
    readonly stats: Game['stats'];
}

export interface ClockPort {
    ticksTillUpdateEnvironment: number;
    absoluteTurnNumber: number;
    monsterSpawnFuse: number;
    lastPromotionUpdate: PromotionUpdateResult | null;
    pendingCaughtFireCells: Pos[];
    needsRender: boolean;
    readonly displacementTrapDepressions?: WeakMap<Grid, Set<number>>;
    readonly mode: Game['mode'];
    readonly playerFalling: boolean;
    readonly isGameOver: boolean;
    readonly animationPauseMs: number;
    poisonedDuringTurn: boolean;
    readonly currentLevelDepth: number | null;
    updatedSafetyMapThisTurn: boolean;
    searchingCharge: number;
    justSearched: boolean;
    readonly animationEnabled: boolean;
    lastDamageSource: string;
}

export interface EffectsPort {
    objectiveTimeBlock(): void;
    playerFalls(): void;
    isAutoTraveling(): boolean;
    sweepDeepWaterItem(creature: Game['player'] | Monster, ticks: number): void;
    monsterTakeTurn(monster: Monster, stealthRange: number): void;
    updateEnvironment(): void;
    tickArcanaResources(): void;
    processIncrementalAutoID(): void;
    spawnPeriodicHorde(): void;
    applyEnvironmentalEffects(target?: Monster, objective?: boolean): void;
    tickCreatureStatuses(): void;
    applyNauseaFromTerrain(creature: Game['player']): void;
    getStatusLabel(status: StatusId): string;
    logHungerTransition(transition: ReturnType<Game['player']['consumeHungerTransition']> & string): void;
    consumeFood(item: Item, prompt: boolean): boolean;
    playerTurnEnded(): void;
    monstersApproachStairs(): void;
    wpContext(): ReturnType<Game['wpContext']>;
    monstersFall(): void;
    keyOnTileAt(x: number, y: number): boolean;
    getMonsterAt(x: number, y: number): Monster | undefined;
    fallFloorItems(): void;
    burnFloorItems(): void;
    driftFloorItems(): void;
    commuteFloorItems(): void;
    killOrphanedBoundFollowers(): void;
    removeDeadMonsters(): void;
    syncEquipmentStatuses(): void;
    updateVision(): void;
    calculateStealthRange(): number;
    updateSafetyMap(): void;
    awarenessBonus(): number;
    searchForSecrets(strength: number): void;
    beginAdvancement(stealthRange: number): void;
    advancementLoop(stealthRange: number): Generator<number, void, void>;
    finishTurnEpilogue(): void;
    triggerGameOver(victory: boolean, reason: string): void;
}

export interface TimePorts { world: WorldPort; clock: ClockPort; effects: EffectsPort }

export function* advancementLoop(ports: TimePorts, stealthRange: number): Generator<number, void, void> {
        // CE Time.c:2471：fastForward 是 playerTurnEnded 内的局部变量，
        // 置位后本回合不再进入暂停分支（E1-修订：锁存，至多暂停一次）
        let fastForward = false;
        while (ports.world.player.ticksUntilTurn > 0) {
            let soonestTurn = ports.world.player.ticksUntilTurn;
            for (const m of ports.world.monsters) {
                if (m.hp > 0 && m.ticksUntilTurn < soonestTurn) {
                    soonestTurn = m.ticksUntilTurn;
                }
            }
            // CE Time.c:2652：客观时间门是 soonestTurn 的第三候选。
            if (ports.clock.ticksTillUpdateEnvironment < soonestTurn) {
                soonestTurn = ports.clock.ticksTillUpdateEnvironment;
            }

            for (const m of ports.world.monsters) {
                if (m.hp > 0) m.ticksUntilTurn -= soonestTurn;
            }

            // CE Time.c:2653-2655：客观时间门推进，归零则 +100 并执行客观块。
            ports.clock.ticksTillUpdateEnvironment -= soonestTurn;
            if (ports.clock.ticksTillUpdateEnvironment <= 0) {
                ports.clock.ticksTillUpdateEnvironment += 100;
                ports.effects.objectiveTimeBlock();
                // C-5：CE Time.c:2866-2871——客观块内（环境瞬时结算）置位的
                // 玩家坠落旗标在本圈循环立即结算（CE 的 do-while 每圈在
                // applyInstantTileEffectsToCreature(&player) 之后检查）。
                if (ports.clock.playerFalling) {
                    ports.effects.playerFalls();
                    return;
                }
                // CE Time.c:2713-2715：岩浆/毒气等致死后立即退出推进
                if (ports.clock.isGameOver || ports.world.player.hp <= 0) return;
                // CE Time.c:2704-2707：仅当玩家本次动作慢于一个标准回合
                //（>100 tick；此刻玩家 tick 尚未递减，口径与 CE 一致）才暂停。
                // 自动寻路/探索对应 rogue.playbackFastForward——锁存但不暂停。
                if (ports.world.player.ticksUntilTurn > 100 && !fastForward) {
                    fastForward = true;
                    if (!ports.effects.isAutoTraveling()) {
                        yield ports.clock.animationPauseMs; // pauseAnimation(25, PAUSE_BEHAVIOR_DEFAULT)
                    }
                }
            }

            // CE Time.c:2720-2745：归零怪物行动。行动耗时按类型落账：
            // 攻击/施法出口在 Monster.takeTurn 内已置 attackSpeed（含
            // MONST_CAST_SPELLS_SLOWLY ×2）；移动/跳过（麻痹/俘虏/入迷等
            // takeTurn 早退）留 <= 0，由这里统一置 movementSpeed（CE
            // Time.c:2731 的不行动口径）。注意此处不 refreshSpeeds——公有
            // moveSpeed/attackSpeed 是"当前值"，直接写即生效（legacy 回置
            // 依赖此语义），重算反而会覆盖外部写入。
            // E1-修订：怪物行动不 yield——常规动作一次性跑完后统一渲染
            // （CE 连"豺狼 50 tick 走两步"也不单独成帧）。
            for (const m of ports.world.monsters) {
                if (ports.clock.isGameOver) break; // CE Time.c:2721 的 gameHasEnded 守卫
                if (m.hp > 0 && m.ticksUntilTurn <= 0) {
                    // CE Time.c:2725-2733 withholds the action BEFORE
                    // monstersTurn/absorption, even though that inner function
                    // updates absorption before its own status checks.
                    if (!m.hasStatus('entranced') && !m.hasStatus('paralyzed') && !m.isCaged
                        && !m.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION')) ports.effects.monsterTakeTurn(m, stealthRange);
                    if (m.ticksUntilTurn <= 0) {
                        m.ticksUntilTurn = m.movementSpeed;
                    }
                    if (m.hp > 0) ports.effects.sweepDeepWaterItem(m, m.ticksUntilTurn);
                }
            }

            ports.world.player.ticksUntilTurn -= soonestTurn;
            if (ports.clock.isGameOver) return; // CE Time.c:2756-2758
        }
    }

export function objectiveTimeBlock(ports: TimePorts): void {
        ports.clock.absoluteTurnNumber++;
        ports.effects.tickArcanaResources();

        // B-1a：CE Time.c:2664 processIncrementalAutoID——护甲/戒指的穿戴熟悉度
        // 在客观时间块内扣减（每 100 tick 恰好 1，与 rechargeItemsIncrementally(1)
        // 同源）。门槛 1000/1500 见 ItemLoader.ARMOR/RING_DELAY_TO_AUTO_ID。
        ports.effects.processIncrementalAutoID();

        // Time.c:2666 / Monsters.c:1128：每 100 tick monsterSpawnFuse--，
        // 归零触发周期刷怪并重置 fuse（CE 触发在 decrementPlayerStatus 尾部）
        if (ports.clock.mode !== 'test') {
            ports.clock.monsterSpawnFuse--;
            if (ports.clock.monsterSpawnFuse <= 0) {
                ports.effects.spawnPeriodicHorde();
                ports.clock.monsterSpawnFuse = rng.randRange(SPAWN_FUSE_MIN, SPAWN_FUSE_MAX);
            }
        }

        // Let environment update
        // F-2b：环境瞬时结算从块尾上移到晋升驱动之前，使块内次序对齐 CE
        // 客观块的怪物轨：applyInstantTileEffectsToCreature（Time.c:2671，
        // 踩火上状态/蹚水灭火/着火生物点燃所踩格）先于
        // decrementMonsterStatus（:2677，燃烧伤害结算）。落地燃烧状态机后
        // 该次序有实质语义：踩火当块"先挂状态、随后结算掉血"；蹚水当块
        // "先扑灭、结算段空转不掉血"。（CE 玩家轨是 per-action 的
        // playerTurnEnded 伤害 :2581 + 块尾 tile :2698；web 按 P2-3 既有的
        // 合并口径与怪物轨并轨，块内"环境→递减"对两轨取 CE 怪物序。
        // 差异登记：合并后玩家着火的首块伤害比 CE 提前一个动作出现。）
        ports.effects.applyEnvironmentalEffects(undefined, true);

        // F-2b：燃烧伤害结算在 tickCreatureStatuses 内（CE Time.c:2581-2591 /
        // Monsters.c:1877-1901），随本调用在环境段之后执行。
        ports.effects.tickCreatureStatuses();

        ports.effects.updateEnvironment();

        // AI-1：CE Time.c:2698——客观块内玩家所站格的 TM_PROMOTES_ON_CREATURE
        // 晋升（applyInstantTileEffectsToCreature(&player)）发生在 updateEnvironment
        // 的晋升段（:2695）**之后**：OPEN_DOOR 自带 promoteChance=10000
        // （Globals.c:329，rand_range(0,10000)<10000 ≈ 必然关门），玩家踩着门时
        // 晋升段先把开着的门关回，踩门晋升随即再次打开——净效果是"玩家站在
        // 门上时门保持开着，走开后门才在身后关上"（CE 原味）。web 此前唯一的
        // 踩门开门点在移动分支（handleSpecialTileEntry，先于本块的晋升驱动），
        // 开门被同一回合的环境晋升立即回弹——门西侧的气味（updateScent 的
        // T_OBSTRUCTS_SCENT 掩码穿不过关着的门）因此比 CE 少刷新一轮。此处按
        // CE 顺序补踩门晋升；promoteTile 本体无 RNG（Promotion.ts），不移流。
        const playerStepPromotions = promoteLayersWithMechFlag(ports.world.grid, ports.world.player.x, ports.world.player.y, TM_PROMOTES_ON_CREATURE | TM_PROMOTES_ON_PLAYER_ENTRY);
        if (playerStepPromotions.length > 0) {
            ports.clock.lastPromotionUpdate!.promotions.push(...playerStepPromotions);
            if (playerStepPromotions.some((r) => r.mutated)) ports.clock.needsRender = true;
        }
        // U14a: CE player exposure follows the objective decrement and gas update.
        ports.effects.applyNauseaFromTerrain(ports.world.player);

        // （F-2b：applyEnvironmentalEffects 已上移到晋升驱动之前——见块首注释。
        // 燃烧/毒气等对生物的结算因此使用本块火/气演化**之前**的状态，与 CE
        // :2671 怪物 tile 段先于 updateEnvironment :2695 的取态一致。）

        const expiredImmunities = ports.world.player.tickTemporaryImmunities();
        for (const im of expiredImmunities) {
            logger.log(i18next.t('status.player.immunity_off', { status: ports.effects.getStatusLabel(im), defaultValue: `Your immunity to ${ports.effects.getStatusLabel(im)} fades.` }), '#cccccc');
        }

        // CE Time.c:2213-2220 calls checkNutrition only outside paralysis.
        ports.world.player.tickNutrition();
        const hungerTransition = ports.world.player.consumeHungerTransition();
        if (hungerTransition && ports.world.player.nutrition > 1) {
            ports.effects.logHungerTransition(hungerTransition);
        }
        if (!ports.world.player.hasStatus('paralyzed') && ports.world.player.nutrition <= 1) {
            // Time.c:949-963 scans pack order, not food type or nutritional value.
            const food = ports.world.player.inventory.items.find(i => i.category === ItemCategory.FOOD);
            if (food) {
                const name = (food as Item & { consumableId?: string }).consumableId === 'mango'
                    ? 'mango' : 'ration of food';
                logger.log(i18next.t('food.auto_eat', {
                    food: name, defaultValue: `Unable to control your hunger, you eat a ${name}.`,
                }), '#ffcc44');
                if (ports.effects.consumeFood(food, false)) {
                    // CE calls playerTurnEnded within checkNutrition. The pending player
                    // ticks are consumed by that nested turn, with no new action delay.
                    ports.effects.playerTurnEnded();
                }
            } else if (ports.world.player.nutrition === 1) {
                ports.world.player.nutrition = 0;
                ports.world.player.refreshHungerState();
                ports.effects.logHungerTransition('starving');
            }
        }

        // P4-10：滚动 waypoint 刷新（CE Time.c:2710-2714）——客观时间块的
        // 最后一步（CE 里在 monstersApproachStairs 之后）。每 100 tick 恰好
        // 重算一个 waypoint；全量重建只在关卡生成/重访时发生。
        if (ports.clock.isGameOver || ports.world.player.hp <= 0) return;
        ports.effects.monstersApproachStairs();
        ports.world.waypoints.rollingRefresh(ports.effects.wpContext());
    }

export function updateEnvironment(ports: TimePorts): void {
        // C-5：CE updateEnvironment 的第一条语句（Time.c:1597 monstersFall）
        // ——100-tick 客观块内的渊上怪物在此坠落（先于晋升/火/气各段）。
        ports.effects.monstersFall();
        for (let x = 0; x < ports.world.grid.width; x++) for (let y = 0; y < ports.world.grid.height; y++) {
            ports.world.grid.getCell(x, y)!.exposedToFire = 0;
        }

        // G-1：CE Time.c:1600-1616——先全场探测 GAS 层非空，非空才
        // `updateVolumetricMedia()` 连调**两次**（:1606 注释 "// update gases
        // twice"；一次调用 = 一轮 8 邻体积均分，两轮 = 气体每回合推进约
        // 2 格、消散期望也 ×2——QUICK 档约 −1.0/回合、SLOW 档约 −0.4）。
        // 探测守卫同时保住无气体回合的 RNG 流：updateVolumetricMedia 每格
        // 每轮各消耗一次随机舍入掷骰，空跑一回合就要白烧 2×DCOLS×DROWS 次
        // 抽取并移动后续一切随机事件（CE 的探测就是干这个的）。
        if (ports.world.environment.hasVolumetricGas()) {
            ports.world.environment.updateGases();
            ports.world.environment.updateGases();
        }

        // C-4c：CE updateEnvironment 的晋升段（Time.c:1619-1684）——两趟随机
        // 晋升 + 记账趟。位置对应 CE 客观块里的 updateEnvironment（:2695，
        // 在 decrementPlayerStatus 之前）；web 的 updateFires/updateGases 承担
        // CE 的火/气体段，CE 的"晋升在火之前"次序据此保持。
        // F-2a：CE 的 CAUGHT_FIRE_THIS_TURN 在点燃瞬间生效（Architect.c:3235），
        // 下一 updateEnvironment 的晋升段据此跳过新火格的衰老掷骰（:1625）。
        // web 的旗标等价物归 Game 所有：玩家动作期间 ignite/igniteForced 攒下
        // 的登记必须在本块晋升驱动**之前**并入 skip 集，否则新点的火会被
        // 立即衰老（实测：起火当块即变 EMBERS、永不蔓延）。
        const queuedFire = ports.world.environment.takeNewlyCaughtFire();
        const caughtFireSkip = queuedFire.length > 0
            ? [...ports.clock.pendingCaughtFireCells, ...queuedFire]
            : ports.clock.pendingCaughtFireCells;
        ports.clock.lastPromotionUpdate = runPromotionUpdate(ports.world.grid, {
            keyOnTileAt: (x, y) => ports.effects.keyOnTileAt(x, y),
            caughtFireCells: caughtFireSkip,
        });
        // F-2a：CE :1665-1668 的记账趟语义——上回合遗留的起火登记在此清空，
        // 只有记账趟之后 WITHOUT_KEY 晋升新点的火存活到下一回合。
        ports.clock.pendingCaughtFireCells = ports.clock.lastPromotionUpdate.caughtFireRemaining;
        if (ports.clock.lastPromotionUpdate.renderDirty) {
            ports.clock.needsRender = true;
        }
        // G-1：晋升链若接出了 GAS 层 DF（Architect.c:3384 volume 累加走
        // Cell.volume），镜像须对账一次。当前目录尚无已接线的 GAS DF
        // （归 G-2），本分支今天不可达——防御性对账，接线后即为活路径。
        if (ports.clock.lastPromotionUpdate.promotions.some((p) => (p.spawn?.gasVolumeAdded ?? 0) > 0)
            || ports.clock.lastPromotionUpdate.withoutKeyPromotions.some((p) => (p.spawn?.gasVolumeAdded ?? 0) > 0)) {
            ports.world.environment.syncGasMirror();
        }

        // CE PRESSURE_PLATE_DEPRESSED clears only after the tile becomes empty.
        const depressed = ports.clock.displacementTrapDepressions?.get(ports.world.grid);
        if (depressed) for (const key of depressed) {
            const x = key % DCOLS, y = Math.floor(key / DCOLS);
            if (!(ports.world.player.x === x && ports.world.player.y === y) && !ports.effects.getMonsterAt(x, y)
                && !ports.world.items.some(item => item.loc.x === x && item.loc.y === y)) depressed.delete(key);
        }

        // Let environment update
        // F-2a：updateFires 即 CE updateEnvironment 的火段（Time.c:1688-1700，
        // Promotion.runFireUpdate）。火段新登记的起火格（新点的火 + 上一玩家
        // 动作里 ignite/igniteForced 攒下的队列）并入 pendingCaughtFireCells，
        // 下一客观块的晋升驱动据此跳过它们的衰老掷骰（CE :1625 一格一回合
        // 至多晋升/衰老一次的语义）。遗留集不清丢：CE 的旗标活到下一记账趟。
        const fireCaught = ports.world.environment.updateFires(ports.clock.pendingCaughtFireCells);
        if (fireCaught.length > 0) {
            ports.clock.pendingCaughtFireCells = [...ports.clock.pendingCaughtFireCells, ...fireCaught];
        }
        // Explosive contact is synchronous in the DF transaction. Drain the
        // environment's compatibility observation queue without replaying damage.
        ports.world.environment.takeExplosiveSpawnCells();
        ports.effects.fallFloorItems();
        ports.effects.burnFloorItems();
        ports.effects.driftFloorItems();
        ports.effects.commuteFloorItems();
    }

export function playerTurnEnded(ports: TimePorts): void {
        resetDFMessageEligibility(ports.world.grid);
        ports.clock.poisonedDuringTurn = ports.world.player.hasStatus('poisoned');
        ports.effects.killOrphanedBoundFollowers();
        ports.effects.removeDeadMonsters();

        // C-5：CE Time.c:2480-2486——玩家坠落在回合一切其余结算之前
        //（handleXPXP 之后、monstersFall 与推进循环之前）。playerFalls 内部
        // 会先让怪物随落（monstersFall，Time.c:1124），随后整段 return：
        // 坠落回合没有气味刷新、没有怪物推进。
        if (ports.clock.playerFalling) {
            ports.effects.playerFalls();
            return;
        }

        // C-5：CE Time.c:2486-2492——每个玩家回合末怪物坠落（注释原文：
        // 走得比环境更新更快的怪物不能悬在渊上行动）。CE :2492 位于
        // updateSafetyMap/气味等主观块之前；web 对应插在此处。
        ports.effects.monstersFall();

        ports.effects.syncEquipmentStatuses();

        // C-7 收尾轮补的每回合视野刷新：CE 里 updateVision 由每个动作结算
        // 路径 eager 调用（Movement.c:1942 移动 / Combat.c:802,968 攻击 /
        // Items.c:5509,5551 等），故 Time.c:2610 主观块读 currentStealthRange
        // 时 pmap 光照/IS_IN_SHADOW 恒新鲜。web 旧状只挂渲染钩子，headless
        // 或"动作已提交、渲染未跑"的窗口里光照是陈旧的——潜行会按玩家旧
        // 位置的暗态误判（p4_9 T1/T5 实证）。全程零 RNG 消费，不动生成流。
        ports.effects.updateVision();

        const stealthRange = ports.effects.calculateStealthRange();

        // CE Time.c:2604-2609：== 0 时累加 movementSpeed（攻击路径已在
        // playerRecoversFromAttacking 里累加过 attackSpeed，不会进此分支）；
        // < 0 分支对应 CE 的免费回合残留（player.ticksUntilTurn = -1）。
        ports.world.player.refreshSpeeds();
        if (ports.world.player.ticksUntilTurn === 0) {
            ports.world.player.ticksUntilTurn += ports.world.player.movementSpeed;
        } else if (ports.world.player.ticksUntilTurn < 0) {
            ports.world.player.ticksUntilTurn = 0;
        }

        // ---- P4-8：气味（CE Time.c:2506-2510 + Time.c:2610，主观玩家时间块）----
        // 每玩家回合恰好一次：先推进 scentTurnNumber（隐身 +10，否则 +3，对应
        // Time.c:2506-2509），再整图重刷气味（updateScent，Time.c:2610——CE 里
        // 两处都在 playerTurnEnded 内、怪物推进循环之前）。挂在 100-tick 客观块
        // 是错误实现：haste（50 tick/动作）下会漏刷、slowed（200 tick/动作）下
        // 会一回合刷两次。
        ports.world.scent.turnNumber += ports.world.player.hasStatus('invisible') ? 10 : 3;
        if (ports.world.scent.turnNumber > 20000) {
            ports.world.scent.resetTurnNumber();
            // CE Time.c:2924: roll back every visited floor's values as well.
            for (const [depth, level] of ports.world.levels) {
                if (depth !== ports.clock.currentLevelDepth) level.scent?.resetTurnNumber();
            }
        }
        ports.world.scent.update(
            ports.world.grid,
            ports.world.player.loc.x,
            ports.world.player.loc.y,
            // CE 半径为 DCOLS * FP_FACTOR（Time.c:770-771，等效无圆形截断）；
            // web 取 DCOLS + DROWS ≥ 地图对角线，同样不截断任何格。
            ports.world.fov.computeFOVMask(ports.world.player.loc.x, ports.world.player.loc.y, DCOLS + DROWS, obstructsScent)
        );

        // ---- P4-9：safety map 的回合期管理（CE Time.c:2616-2626，主观玩家块、
        // 怪物推进之前）----先清"本回合已重算"闩锁；再扫描怪物表，若存在所在格
        // 在玩家 FOV 内的逃跑怪则主动预更新一次并停（break）——本回合内其余
        // 逃跑怪（含看不见玩家的）都复用这张图，getSafetyMap 不再重算。
        ports.clock.updatedSafetyMapThisTurn = false;
        for (const m of ports.world.monsters) {
            if (m.hp > 0 && m.state === MonsterState.FLEEING &&
                ports.world.grid.getCell(m.loc.x, m.loc.y)?.isVisible) {
                ports.effects.updateSafetyMap();
                break;
            }
        }

        // ---- P1-42：每步低强度自动搜索（CE Time.c:2544-2552，主观玩家块、
        // 怪物推进之前）----
        // 站上任何一格只搜一次（Cell.autoSearched = CE SEARCHED_FROM_HERE，
        // Rogue.h:1090）；awarenessBonus 由戒指有效附魔给出，基础强度 30、
        // 半径 3。其后的充能清零：主动搜索只在连续回合累积，上一动作不是
        // 搜索（justSearched 为 false）则充能作废——CE Time.c:2550-2552。
        {
            const playerCell = ports.world.grid.getCell(ports.world.player.loc.x, ports.world.player.loc.y);
            if (ports.effects.awarenessBonus() > -30 && playerCell && !playerCell.autoSearched) {
                ports.effects.searchForSecrets(ports.effects.awarenessBonus() + 30);
                playerCell.autoSearched = true;
            }
            if (!ports.clock.justSearched && ports.clock.searchingCharge > 0) {
                ports.clock.searchingCharge = 0;
            }
        }

        // CE Time.c:2635: gradual terrain follows search/scent/safety setup,
        // immediately before the objective-time advancement loop.
        ports.effects.sweepDeepWaterItem(ports.world.player, ports.world.player.ticksUntilTurn);
        if (ports.clock.animationEnabled && !ports.effects.isAutoTraveling()) {
            ports.effects.beginAdvancement(stealthRange);
            return;
        }

        const iter = ports.effects.advancementLoop(stealthRange);
        let step = iter.next();
        while (!step.done) step = iter.next();
        ports.effects.finishTurnEpilogue();
    }

export function finishTurnEpilogue(ports: TimePorts): void {
        // Deaths from monster combat/environment resolve at this turn boundary;
        // removeDeadMonsters handles item, DF, passenger and leadership in order.
        ports.effects.removeDeadMonsters();

        // 主观饥饿结算：饥饿伤害 / 回血（CE Time.c:2523-2541，每玩家动作一次）
        const recovery = ports.world.player.recoverPerTurn(ports.clock.poisonedDuringTurn);
        if (recovery === 'starving') {
            ports.clock.lastDamageSource = 'starvation';
        }

        if (ports.clock.mode === 'wizard') {
            // Wizard mode in stage-1 is intentionally permissive.
            ports.world.player.hp = ports.world.player.maxHp;
        }

        ports.world.stats.turns++;

        // P1-42：CE Time.c:2874-2875——回合末清 justRested/justSearched。
        // justSearched 必须在下一动作前归 false，"连续回合充能"的判定
        // （playerTurnEnded 充能清零分支）才有意义。
        ports.clock.justSearched = false;

        if (ports.world.player.hp <= 0 && !ports.clock.isGameOver) {
            let deathReason: string;
            if (ports.clock.lastDamageSource && ports.clock.lastDamageSource !== 'fire' && ports.clock.lastDamageSource !== 'steam' && ports.clock.lastDamageSource !== 'creeping death' && ports.clock.lastDamageSource !== 'starvation' && ports.clock.lastDamageSource !== 'poison' && ports.clock.lastDamageSource !== 'caustic gas') {
                deathReason = i18next.t('death.killed_by', { monster: ports.clock.lastDamageSource, defaultValue: `Killed by a ${ports.clock.lastDamageSource}.` });
            } else if (ports.clock.lastDamageSource === 'fire') {
                deathReason = i18next.t('death.burned', { defaultValue: 'Burned to death.' });
            } else if (ports.clock.lastDamageSource === 'thorned vines') {
                deathReason = i18next.t('death.vines', { defaultValue: 'Killed by thorned vines.' });
            } else if (ports.clock.lastDamageSource === 'steam') {
                deathReason = i18next.t('death.scalded', { defaultValue: 'Scalded to death by steam.' });
            } else if (ports.clock.lastDamageSource === 'creeping death') {
                deathReason = i18next.t('death.creeping_death', { defaultValue: 'Consumed by creeping death.' });
            } else if (ports.clock.lastDamageSource === 'starvation') {
                deathReason = i18next.t('death.starved', { defaultValue: 'Starved to death.' });
            } else if (ports.clock.lastDamageSource === 'poison') {
                deathReason = i18next.t('death.poisoned', { defaultValue: 'Died of poison.' });
            } else if (ports.clock.lastDamageSource === 'caustic gas') {
                // G-3：POISON_GAS 按 CE 是直接伤害（T_CAUSES_DAMAGE），死因
                // 引 tile description（Time.c:622-625 "Killed by %s"，
                // "a cloud of caustic gas"）。
                deathReason = i18next.t('death.caustic_gas', { defaultValue: 'Killed by a cloud of caustic gas.' });
            } else {
                deathReason = i18next.t('death.unknown', { defaultValue: 'Killed by unknown causes.' });
            }
            ports.effects.triggerGameOver(false, deathReason);
        }

        ports.clock.needsRender = true;
    }
