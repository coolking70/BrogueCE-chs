# Brogue JS/TS 重构与现代化架构规划

考虑到原版 Brogue 是一个基于 C 语言的经典 Roguelike 游戏（依赖大量结构体数组、深度嵌套的状态变异以及特定的终端/SDL渲染），要将其完全移植并升级为一个跨平台、支持国际化(i18n)、易于扩展玩法（MOD系统）以及画面自适应的现代化 Web 游戏，我们需要进行一次彻底的架构重建。

以下是重构计划的整体规划：

## 1. 技术栈选型

我们需要在保持游戏核心逻辑严谨性的同时，利用现代 Web 技术来满足自适应、扩展性和国际化的需求。

* **核心语言：** **TypeScript (TS)**
  * *原因*：相比原生 JS，TS 提供的强类型能够极大地减轻由于原版 C 代码移植过程中可能产生的类型错乱和越界错误，尤其是处理网格(Grid)、实体(Entity)和状态管理时。
* **构建工具：** **Vite**
  * *原因*：极速的模块热替换(HMR)和开箱即用的 TS/Assets 支持，适合构建纯正的前端 Web 应用。
* **渲染引擎：** **PIXI.js / 原生 HTML5 Canvas**
  * *原因*：Brogue 的彩色字符渲染和光影效果（Light.c）非常复杂，直接用 DOM 渲染会造成极大性能瓶颈。建议主游戏区域使用 PixiJS 或原生 Canvas，外层 UI 手册、图鉴、日志使用 DOM。
* **UI 层：** **Vue 3 或 React**
  * *原因*：用于构建游戏主菜单、背包(Inventory)、设置界面以及国际化文本组件，方便进行弹窗和响应式布局适配（Flexbox / CSS Grid）。
* **架构模式：** **ECS (Entity-Component-System) 或 状态驱动(State-Driven)**
  * *原因*：C 版使用的是全局 Struct 数组 (如 `monsters`, `items`)。转换为 ECS 架构能够极大地解耦“光照”、“移动”、“战斗”逻辑，也方便后续模块化扩展（MOD）注入新的# 重写 Brogue Web 版本的核心系统

## 阶段 8：物品互动与背包系统 (Items & Inventory UI)

在完成了核心引擎驱动渲染、光照计算以及外层状态栏之后，我们需要进入传统的 Roguelike 核心交互环节：背包管理与物品交互。

### Proposed Changes

#### `src/components/InventoryOverlay.vue` [NEW]
- **Summary**: 一个基于 Vue 的透明浮层组件，覆盖在 Canvas 上方。
  - 需要监听 `game.player.inventory.items` 数组。
  - 动态渲染对应的字母快捷键 (如 `a) Dagger`, `b) Chain Mail`)。
  - 提供分类 (Weapons, Armor, Potions, Scrolls 等) 取决于原版 Brogue 的显示方式。
  - 绑定鼠标点击事件和键盘对应字母事件，实现快速选择交互。

#### `src/App.vue` [MODIFY]
- **Summary**: 引入并挂载 `InventoryOverlay`。
- 根据一个全局的 `isInventoryOpen` 状态 (`ref` 变量) 来决定是否展示。

#### `src/engine/Input.ts` [MODIFY]
- **Summary**: 处理键盘键位分发。
  - 新增监听按键 `i` (打开背包)、`e` (装备)、`d` (丢弃) 等。
  - 当 `isInventoryOpen` 为 true 时，按键应被拦截并派发给 Inventory 菜单逻辑，而不是触发行走。

#### `src/engine/Items/Inventory.ts` [MODIFY]
- **Summary**: 确保 Player 能够拥有和管理装备位 (Weapon Slot, Armor Slot, Ring Slots)。

#### `src/engine/Core/Game.ts` [MODIFY]
- **Summary**:
  - `handlePlayerAction` 需要处理类似 `'equip'`, `'drop'` 指令。
  - 管理游戏状态机拦截机制 (如果在菜单中，阻止 `timeSystem` 推进或怪物行动)。

### Verification Plan
- 测试按 `i` 键能否正确呼出半透明的物品列表层。
- 测试打开背包时使用方向键是否会被拦截阻止移动。
- 能否点击某件物品将其从背包转移到 "Equipped" 状态，并在 UI 上标出行亮或特殊图标。

### (2) 国际化 (i18n)
* 继续使用 i18next-vue。所有物品名字、日志、怪物描述统一使用类似 `i18n.t('item.sword.desc')` 或直接翻译 Key 的形式。
* 支持动态资源加载：预留语言文件热切换机制。目前已有的 `zh_CN.json` 作为基础中文包。

### (3) 玩法拓展与 MOD 支持 (Extensibility)
* **数据表外存化：** 原先定义在 C 语言结构体或常量里的数据（如武器伤害、怪物血量生成概率等）全部抽离为 `data/monsters.json` (可选), `data/weapons.json` 等。
* **事件钩子(Event Hooks)：** 建立一个全局的 EventBus。

## 阶段 9：基于武器的战斗系统 (Weapon Combat Mechanics)

目前的 `CombatSystem` 仅实现了基础的 `1d4` 的硬编码。真实玩家在装备(Itemized)了武器和护甲后，实际伤害会有巨大变动。我们需要实现真实的属性映射与装备加成。

### Proposed Changes

#### `src/engine/Random.ts` [MODIFY]
- **Summary**: 添加可以解析 DND 风格骰子字符串的方法 `rollD(diceString: string)`，比如 `"2d4"` -> 返回 2 个 D4 的总和，或者 `"1d4+1"`。

#### `src/entities/Player.ts` [MODIFY]
- **Summary**:
  - `getBaseDamage()`: 玩家空手伤害应该仍然受某个底值影响。
  - `getWeaponDamage()`: 如果 `equippedWeapon` 存在且包含 `damage`，则使用新算法解析武器骰子。

#### `src/engine/Combat/Combat.ts` [MODIFY]
- **Summary**:
  - 更新 `attack(attacker: Creature, defender: Creature)` 函数。
  - 判断如果是 `Player` 攻击，检查其 `equippedWeapon.damage`，用以替代默认的 `1d4`。
  - 暂时先不全面接入武器的重量/要求力量减免 (Penalty)，先搭好 `1d4/2d4` 基础计算框架，并在 Log 中明确提示 ("Hit the [Monster] for 8 damage with Macing")。
  
### Verification Plan
- 测试拿起 Dagger 并 Equip，然后撞向怪物，控制台日志应该显示造成的伤害，且数值范围要匹配 `weapons.json` 中的 `1d4` 等数据。
- 拿起 Sword (2d4)，伤害数值应该有明显提升。

## 阶段 10：扩展怪物阵营与掉落机制 (Expanded Roster and Loot Drops)

为了让地牢具有可玩性，我们需要根据楼层（Depth）动态生成对应强度的怪物，并在探索和杀敌时获得金币或装备奖励。

### Proposed Changes

#### `src/data/monsters.json` [NEW]
- **Summary**: 创建外部怪物数据库字典。定义多种基本怪物（如 Rat, Jackal, Kobold, Goblin 等），包含它们的字符(`char`)、颜色(`color`)、血量(`hp`)、伤害解析式(`damage` 如 `1d3`) 和生成深度要求(`minDepth`, `maxDepth`)。

#### `src/entities/Monster.ts` [MODIFY]
- **Summary**: 修改构造函数，通过查询 `monsters.json` 构建对应 ID 的怪物属性。
- 增加背包/掉落池（`inventory` 或 `lootDrop` 参数），当怪物被杀死时（`takeDamage` 或 `die()`），遍历掉落池将 Item 解构到全局的 `Game.items` 列表中。

#### `src/engine/Generator/Architect.ts` (或 `Spawner.ts`) [MODIFY]
- **Summary**: 在地图生成完毕（Rooms 和 Corridors 连通后），遍历空闲的 Floor Tile：
  - **Spawn Monsters**: 根据当前的 `Depth` 从 `monsters.json` 筛选符合生成的候选名单并随机投入。
  - **Spawn Loot**: 在地图隐蔽角落随机投入随机抽取的武器、防具或金矿 (Gold)。

#### `src/engine/Core/Game.ts` [MODIFY]
- **Summary**:
  - 处理金币拾取逻辑直接转化为 Player 的 `gold` 数值，其他物理物品放入 Player Inventory。
  
### Verification Plan
- 生成地图后开启视野，确认是否随机散布了 Kobolds 和 Goblins。
- 击败携带武器的 Goblin 后，尸体处是否留下了装备，踩上去按 `Pickup` 能否加入背包。

## 阶段 11：消耗品机制与随机鉴定 (Potions and Scrolls)

Brogue 的灵魂机制之一是充满未知的消耗品。这一阶段我们引入药水 (Potions) 和卷轴 (Scrolls)，并实现最基础的作用逻辑（如回血、传送、探图）。

### Proposed Changes

#### `src/data/consumables.json` (或 `potions.json`, `scrolls.json`) [NEW]
- **Summary**: 定义基础的神奇物品。比如 `potion_of_life` (生命药水)、`potion_of_descent` (下沉药水)、`scroll_of_teleportation` (传送卷轴)。

#### `src/engine/Items/ItemLoader.ts` [MODIFY]
- **Summary**:
  - `spawnPotion(id)` 和 `spawnScroll(id)` 方法。
  - **Identified System**: 每次 `new Game()` 时，随机映射颜色/未鉴定名字到底层 ID 上。例如将 “红色的药水” 随机绑定到 `potion_of_life`。初始拿到的物品名字叫 `Red Potion`，喝下后解锁图鉴，全局变更为 `Potion of Life`。

#### `src/components/InventoryOverlay.vue` [MODIFY]
- **Summary**:
  - 当选中的物品 Category 为 `POTION` 时，Action 面板显示 `[q] Quaff (饮用)` 代替 Equip。
  - 当选中的物品 Category 为 `SCROLL` 时，Action 面板显示 `[r] Read (阅读)`。

#### `src/engine/Core/Game.ts` & `src/entities/Player.ts` [MODIFY]
- **Summary**:
  - 添加 `quaffItem(item)` 和 `readItem(item)` 逻辑。
  - 消耗品被使用后从 Inventory 移除。
  - 根据其底层 ID 触发特效（例：`potion_of_life` -> `player.hp = player.maxHp`，并在 MessageLog 输出绿字）。

### Verification Plan
- 在地图上生成一瓶未鉴定的药水，捡起后在背包中显示 "Red Potion"。
- 选中饮用后，玩家血量发生变化，且由于鉴定成功，日志输出相应的提示，此后所有同类药水均显示真实名称。

---

## 阶段 7 (重设计)：现代化 UI 视觉升级与打磨 (UI Design & Polish)

此阶段之前，我们已经跑通了大部分机制并在侧边栏、背包实现了数据绑定，但视觉上仍较为原始。接下来需要摒弃基础的占位符样式，升级为符合现代 Web 审美的“高端暗黑地牢” UI（例如微玻璃态、高对比度荧光色、现代字体排印）。

### Proposed Changes

#### 全局 CSS 与字体结构 [NEW/MODIFY]
- **Summary**: 在 `index.html` 或构建管线中引入现代 Google 字体（例如 `Inter` 作为 UI 主字体，`Fira Code` 或 `JetBrains Mono` 作为等宽终端字体）。
- 设定完善的 Dark Theme 调色板变量 (CSS Variables)。

#### `src/components/Sidebar.vue` [MODIFY]
- **Summary**:
  - **血条重绘**: 采用带有内发光、平滑宽度渐变 (`transition: width 0.3s ease-out`) 的现代化 Health Bar。
  - **角色面板**: 引入金币 (Gold)、当前层级 (Depth)、饥饿度 (Nutrition) 等状态的模块化卡片布局。
  - **日志美化 (Message Log)**: 优化滚动条样式，最新消息使用高亮亮色，历史消息使用柔和变暗的色阶衰减。

#### `src/components/InventoryOverlay.vue` [MODIFY]
- **Summary**:
  - 材质改为深度毛玻璃 (`backdrop-filter: blur(12px)`)，搭配带有微弱反光的边框。
  - 行列表 Hover 增加动态流光反馈；动作按钮 (Quaff, Drop 等) 提供更好的圆弧与色彩警示度设计。

### Verification Plan
- 在浏览器中检视页面，确认侧边栏和浮层的设计能否带来远超当前“极简原生态”的冲击力，达到令人赞叹 (Wow) 的现代品质。
- 保证交互操作跟原图逻辑一样顺畅。

---

## 阶段 13：深入机制修复与楼层持久化 (Deep Fixes & Persistent Depths)

根据上阶测试，针对自动探索、界面数据绑定及楼层刷新等存在体验断层，我们需要实施结构化修补。

### Proposed Changes

#### `src/engine/Core/Game.ts` [MODIFY]
- **Summary**:
  - `handlePlayerAction('pickup')`: 替换原生 `console.log` 为 `logger.log()`，将拾取信息打印至右侧 Sidebar 的讯息历史中。
  - **Auto-Explore**: 升级 `handleAutoExplore()` 与 `stepAutoPath()`：如果遇到怪中止，保留 `this.autoPath` 而不将其置空。并在 BFS 中排除无法抵达或已经探索的死角。
  - **Persistent Depth Generator**: 将原先 `this.grid = architect.generateLevel()` 的一过性覆盖，改为定义 `levels: Map<number, { grid: Grid, items: Item[], monsters: Monster[], fov: FOVSys }>` 这种持久化快照方式。当下楼时查 Map 缓存，若命中则从缓存中恢复原本楼层数据而不是全新生成。

#### `src/components/Sidebar.vue` [MODIFY]
- **Summary**:
  - 从硬编码 `Depth: {{ 1 }}` 改为挂载对 `game.depth` 的状态监测与渲染。
  - 增添全局的最大宽度或者 Flex 保护，防止游戏 Canvas 内容被右方 `Sidebar` 挤占遮盖。

### Verification Plan
- 测试按 `x` 进行寻路，遇到老鼠中止，击杀老鼠后再次按 `x` 能继续未竟的探索路径。
- 测试从 2 层爬回 1 层，1 层应当保留之前的地形挖掘与扔在地上的无关装备。
- 测试拾取道具，Sidebar 上的 Message Log 会真实显现。

---

## 阶段 14：自动探索与战斗逻辑深化 (Auto-Explore & Auto-Attack Refinements)

### Proposed Changes

#### `src/engine/Core/Game.ts` [MODIFY]
- **Auto-Attack via 'x'**: 
  - 在 `handleAutoExplore()` 开始时，先检查相邻一格是否有存活的怪物。如果存在多个，则按照 `hp` 从低到高排序选取首个目标。
  - 直接调用移动指令产生攻击回合 (`this.handlePlayerAction('move', {x: dx, y: dy})`) 并返回，阻止后续长途寻路逻辑。
- **Item Spotting Interrupt & Target**:
  - 添加 `ignoredItemsForExplore: Set<Item>` 控制打断。与怪物的发现中断类似，首次发现视野内的物品打断寻路，下次按 `x` 继续时将其忽略。
  - 修改 `handleAutoExplore()` BFS 的终止判定：除了遇到 `!isExplored` 格子外，如果格子上有未领取的 `Item` (且当前玩家未站在上面)，也可以作为 `target` 终结 BFS 循环。

### Verification Plan
- 在敌人身旁按 `x` 验证是否触发了自动攻击。
- 测试探索途中视野初次扫描到药水等掉落物是否会引起暂停。
- 暂停后再按 `x` 确保可以导航走到物品位置。

---

## 阶段 15：未鉴定机制与进阶物品系统 (Identification & Advanced Items)

Brogue 的肉鸽深度极大程度上源于不透明的物品系统与强弱博弈。本阶段将补齐此系统：

### Proposed Changes

#### `src/engine/Core/Game.ts` [MODIFY]
- **物品鉴定 (Identification)**:
  - 修改 `quaffItem` (喝药水) 和 `readScroll` (读卷轴) 逻辑。在物品发挥作用时，先调用 `ItemLoader.identify((item as any).consumableId)` 注册到已鉴定字典。
  - 修改日志输出，使得首次使用时会显示顿悟，例如：`"You quaff the Red Potion. It was a Potion of Strength!"`。
- **力量惩罚 (Strength Penalties)**:
  - 维护玩家的基础 `.strength` (由于 Brogue 原版设定，玩家力量随着进度成长，装备也有高低要求)。
  - 当装备 `weapon` 或 `armor` 时，若 `player.strength < item.strengthRequired`，在攻击判定 (Combat) 中引入减益 (例如命中率下降，或者攻击耗时成倍增加)。

#### `src/engine/Items/Item.ts` & `ItemLoader.ts` [MODIFY]
- 扩展 `Item` 类，支持 `isCursed: boolean` 和 `isEnchanted: boolean`，并可以在生成装备 (`spawnWeapon`, `spawnArmor`) 时通过一定概率 (RNG) 附魔或下咒。
- 为物品（尤其是武器、防具、戒指）添加随机的前缀加强/诅咒修饰系统 (-1, +2 等)。

#### `src/components/InventoryOverlay.vue` [MODIFY]
- **卸下诅咒限制**: 当玩家尝试脱下 (Unequip) 标记为 `isCursed` 的装备时，系统拦截并弹窗/飘字提示 `"You cannot unequip a cursed item!"`，强制玩家继续穿着直到拥有解除诅咒的卷轴。
- **力量需求UI警示**: 在鼠标悬浮或列表展示上，若当前力量低于装备要求，用红色高亮显示要求数值，并显示警告标语。

### Verification Plan
- 生成一层包含各类药水、卷轴的地图。拾取后最初查看物品栏，确认显示的是 "Red Potion" 或 "Silver Potion" 等乱码风味文本。
- 喝下一瓶药水，验证日志正确揭示真实名字，并且后续捡到的同类别药水会直接显示为例如 "Potion of Healing"。
- 生成一件被诅咒的武器并装备，尝试卸下，确认卸下按钮失效或拒绝弹出警告。

---

## 阶段 16：环境互动与气体蔓延机制 (Environment & Gas Mechanics)

环境互动是 Brogue 的核心生态系统，本阶段将实装基础的气体和连带燃烧反应：

### Proposed Changes

#### `src/engine/Map/EnvironmentManager.ts` (或新增 `GasManager`) [NEW/MODIFY]
- **气体系统 (Gas System)**:
  - 建立统一的网格叠加层（如 `gases: GasPattern[]` 或格子上的 `gasDensity` 属性）。
  - 支持气体类型：毒气 (Caustic Gas)、混乱迷雾 (Confusion Gas)、蒸汽 (Steam)。
  - 在每回合 `runMonsterTurns()` 同步进行 `updateGases()` 计算：气体向四周空旷地格扩散蔓延，同时随时间降低中心浓度并衰减消散。
- **燃烧蔓延 (Fire Propagation)**:
  - 在 `EnvironmentManager` 或网格单元中添加 `isBurning` 状态。
  - 草地 (`Grass`) 被点燃后，每回合向相邻的非燃烧草地蔓延，并在燃烧几回合后化为灰烬 (`Ashes/Charcoal` 地形)。
  - 若火源接触到水面 (`Water`)，或是燃烧剧烈时，产生蒸汽气体 (Steam)。

#### `src/engine/Core/Game.ts` & `Combat.ts` [MODIFY]
- **投石与药水投掷 (Throwing)**:
  - 新增投掷动作 `handlePlayerAction('throw', {loc})`，允许将包裹里的药水丢向指定地格引爆。
  - 投掷火药类、毒气类药水作为环境反应的启动源。
- **环境计算伤害 (Environmental Damage)**:
  - 在回合结束时遍历所有在气体中的 Entity 并执行对应效果（如处于毒气中每回合持续扣血）。
  - 处于燃烧草网格内的人物受到火焰伤害。

#### `src/components/GameCanvas.vue` [MODIFY]
- **气体特效渲染**: 对有气体的单元格采用特定的半透明色彩与字符混合（例如紫色半透明漂浮代表毒气，暗红色闪动代表火焰）。目前可通过动态切换单元格 `color` 和 `backgroundColor` 实现视觉警告。

### Verification Plan
- 测试生成一片草丛，在此处丢出（或调用 Debug）燃烧效果，验证火势是否逐回合蔓延，几回合后留下焦土。
- 处在毒气中的单位能否正确计算受到持续伤害（通过 UI Log 确认）。
- 确保气体在扩散一定范围后随回合逐渐稀释、消散。

---

## 阶段 17：饥饿机制与休整恢复 (Hunger Mechanics & Resting)

Brogue 作为典型的 Roguelike，需要使用“饥饿钟” (Food Clock) 来逼迫玩家不断探索更深的地层，而不是在绝对安全的区域无限挂机回血。

### Proposed Changes

#### `src/entities/Player.ts` [MODIFY]
- 添加 `nutrition` 属性（可设定满值为 `12000`）。
- 每次 `timeSystem` 推移一个完整回合，`nutrition` 减去固定数值（如 `-1` ）。
- 添加 `healRate`与回血计算：基于一定回合数后玩家自动恢复 `1` 点生命值。其回合数取决于饥饿状态，例如 Satiated 状态极快，Hungry 状态变慢，Starving 状态不回血反而扣血。

#### `src/data/consumables.json` [MODIFY]
- 在消耗品库中分类新增 `ration_of_food`（干粮块）。

#### `src/components/InventoryOverlay.vue` [MODIFY]
- 当选中食物分类时，出现 `[e] Eat` 的选项，调用核心消耗逻辑（将 nutrition 设置回安全阈值），并在日志打印提示。

#### `src/components/Sidebar.vue` [MODIFY]
- 监测 `player.nutrition`，并在侧栏界面根据不同临界值（Satiated, Hungry, Starving, Fainting）渲染相应的字符串与色彩。

#### `src/engine/Input.ts` & `src/engine/Core/Game.ts` [MODIFY]
- 完善监听按键 `.` (Wait) 以在原点度过1个回合(Tick)。

### Verification Plan
- 连续按空白处等待几百个回合，查看 Sidebar 的 Nutrition 状态是否会依次突变发黑并最终导致 `Starving` 扣血。
- 食用干粮后立马重置为绿色的 `Satiated`。

---

## 阶段 18：隐蔽计算与怪物警觉 (Stealth & Enemy Awareness)

原版 Brogue 的重要战术深度来源于怪物的视听觉侦测与玩家的暗杀绕道策略。这一阶段需要剥离原先傻瓜化的一见人就冲上来的 AI，增加潜行动作空间。

### Proposed Changes

#### `src/entities/Monster.ts` [MODIFY]
- 给基底 Monster 添加状态属性: `ASLEEP` | `WANDERING` | `HUNTING`。
- 在地图生成投放到地牢时，按一定概率 (例如 70%) 决定大部分普通怪物生成出厂时处于 `ASLEEP` 熟睡。

#### `src/engine/Core/Game.ts` [MODIFY]
- 潜行检测范围 (Stealth Radius)：写一个核心计算函数 `calculateStealthRange(player)`，依据处于亮水/暗影环境、所穿装甲负担等级，返回当前被发现距离。
- 在 `runMonsterTurns()` 中：
    - `ASLEEP`: 原地不动。如果玩家处于怪物的视野直线内且进入了刚才计算的 `stealth radius`（或者由于战斗发出了巨大声响），怪物转为 `HUNTING`。
    - `WANDERING`: 随机朝空旷的未探查地砖游荡。如果能看到玩家并检测到玩家，转为 `HUNTING`。

#### `src/components/GameCanvas.vue` [MODIFY]
- 动态状态识别：当该实体 `state === ASLEEP`，修改其精灵(Spirte) 渲染方式（如 `alpha = 0.5`），或者额外绘制一个漂浮的蓝/白色 `z` 作为未惊醒提示。

### Verification Plan
- 生成一堆熟睡的 Jackal，靠近它们时观察头顶是否带有休眠标识，且不会在几十个区块外立刻主动追击主人公。
- 当走入足够近格以内（潜行被破），或者发起近战造成声波攻击后，它们转为红色的亮色状态并追击。

---

## 4. 重构实施步骤 (Roadmap)

我们建议按照以下步骤，从下而上逐步替换代码：

* **阶段 1：工程基建 (Project Setup)**
  * 搭建 Vite + TypeScript + 基础渲染器(Pixi.js/Canvas)。
  * 配置 ESLint 与 i18n 系统工作流。
* **阶段 2：世界法则与网格 (World & Grid)**
  * 将 `Rogue.h` 的数据结构翻译为 TS Interfaces。
  * 移植 `Grid.c`、视野(FOV) 和 Dijkstra 寻路算法，确保基础地图能够在页面上渲染出来（可以先用纯色方块代替彩色 ASCII）。
* **阶段 3：地牢生成器 (Dungeon Generation)**
  * 逐行移植并测试 `Architect.c` 的房间拆分、走廊连接、湖泊生成逻辑。这是 Brogue 最核心的魅力之一。
* **阶段 4：实体与交互 (Entities & Core Loop)**
  * 建立回合制事件队列 (`Time.c` 的等效物)。
  * 实现 Player 和 Monster 的渲染、移动。
  * 移植 `Combat.c` 实现基础的碰撞与攻击判定。
* **阶段 5：物品装备与系统完善 (Items & Systems)**
  * 结合外部 JSON 配置，实现完整的背包系统和物品交互 (`Items.c`)。
  * 移植复杂的魔法系统和环境互动（如气体燃烧、蔓延）。
* **阶段 6：光影与渲染打磨 (Lighting & Visuals)**
  * 完全还原原版 `Light.c` 中极具特色的动态光照和色彩混合机制。
* **阶段 7：外层 UI 与自适应 (UI & Responsive)**
  * 制作基于 Vue/React 或纯 CSS 的游戏界面。
  * 实现触控操作适配。

## User Review Required
请您查看上述架构与实现路线图。如果您认可该方向，我们可以执行以下操作：
1. 先创建前端工程（例如：`vite-brogue` 项目）。
2. 在该工程中搭建最初始的骨架（目录结构，配置文件，TS 支持）。
3. 我们将根据路线图一步一步完成特定模块的迁移。

请问是否需要我对某一个方向（如渲染方案还是MOD模块架构）进行更深度的补充，还是我们现在就可以按照这个思路将任务分解存放到 `task.md` 中，并开始初始化前端基础工程？
