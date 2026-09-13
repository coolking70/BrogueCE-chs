# Brogue JS/TS 重构与现代化架构任务清单

## 阶段 1：工程基建 (Project Setup)
- [x] 1.1 初始化 Vite + TypeScript 前端基础工程 (`npm create vite@latest`)。
- [x] 1.2 配置 ESlint, Prettier 和 tsconfig 严格模式。
- [x] 1.3 引入 i18next 支持国际化架构，并载入现存的 `zh_CN.json` 作为基础中文包。
- [x] 1.4 安装渲染所需基础库 (如 `pixi.js` 或配置原生 `Canvas 2D` 环境)。
- [x] 1.5 搭建初步应用外壳，结合 Vue/React (如果需要) 制作可以自适应宽高的主要游戏画板(Canvas Container)。

## 阶段 2：世界法则与网格结构 (World & Grid)
- [x] 2.1 将 `Rogue.h`, `Globals.h` 等常数与结构体翻译并抽象为 TS Interface/Classes (如 `Entity`, `Cell`, `Color`, `Position`)。
- [x] 2.2 实现核心坐标体系类 (`Grid`/`Map`)，支持网格级数据读取写入（例如：`map.getCell(x, y)`）。
- [x] 2.3 移植和优化基础的随机数生成逻辑算法 (RNG)，确保能重现同一个 Seed 的地牢 (`SeedCatalog.c`)。
- [x] 2.4 实现 Field of View (FOV) 与寻路算法 (移植 `Dijkstra.c`)。

## 阶段 3：地牢生成器 (Dungeon Generation)
- [x] 3.1 梳理并重写 `Architect.c` 的宏观生成流。
- [x] 3.2 实现房间分割、走廊挖掘逻辑。
- [x] 3.3 实现各种地形(Terrain)生成机制，如：洞穴、湖泊、熔岩等。
- [x] 3.4 基础地牢在画布能够初级渲染出基本色彩形状（ASCII 色块调试用）。

## 阶段 4：实体与交互 (Entities & Core Loop)
- [x] 4.1 核心循环 (`Time.c`)：重构由回合驱动的事件与逻辑滴答(Tick)机制。
- [x] 4.2 定义 ECS 或者基础 Entity 模型，创建 `Player` 对象。
- [x] 4.3 移植玩家输入监听，能对方向键与自适应 UI 点击按钮发出移动(Move)指令 (`Movement.c`)。
- [x] 4.4 移植 `Combat.c` 战斗系统雏形，包含基础攻击概率与伤害计算公式。
- [x] 4.5 移植 `Monsters.c` 的基础 AI 与生成 (`GlobalsBase.c` - `monsTemplate`)。

## 阶段 5：物品装备与系统完善 (Items & Systems)
- [x] 5.1 数据外置：将武器、防具、卷轴等数据转移至分离的 JSON 配置。
- [x] 5.2 背包系统与交互 (`Items.c`)，拾取、丢弃及 UI 展示。
- [x] 5.3 魔法与环境系统，例如毒气散播、火焰燃烧、光照机制。
- [x] 5.4 扩展支持插件 API(MOD 系统) 的基本事件总线 (EventBus)。

## 阶段 6：光影与渲染打磨 (Lighting & Visuals)
- [x] 6.1 完全还原 `Light.c` 中的发光体机制和色值平滑过渡算法。
- [x] 6.2 美化并补齐所有需要展示在画面的文字 UI 和特效 (如飘字伤害)。
- [ ] 6.3 针对高分辨率屏幕，实现平滑的 Tile 纹理支持或高清矢量版 ASCII。

## 阶段 7：外层 UI 与自适应响应 (UI & Responsive)
- [x] 7.1 侧边栏/底部栏状态信息显示（血量、饥饿度、当前层级等）。
- [x] 7.2 日志系统 (Log) 并在界面实时更新打印（支持 i18n 多语言）。
- [x] 7.3 PC 鼠标悬停支持 (Hover Inspect) 查看环境信息。
- [x] 7.4 手机端触屏点击自动寻路与方向控制按钮。

## 阶段 8：物品互动与背包系统 (Items & Inventory UI)
- [x] 8.1 实现按键 `i` 或点击 UI 按钮打开/关闭背包面板 (Inventory Overlay)。
- [x] 8.2 渲染背包物品列表，支持按字母分类并读取 `zh_CN.json` 本地化名称。
- [x] 8.3 物品的基础互动逻辑：装备 (Equip)、卸下 (Unequip) 和投掷 (Throw)。
- [x] 8.4 UI 与状态机结合，确保在打开背包时暂停外部游戏时间 (Time System)。

## 阶段 6：光影与视野系统 (Lighting & FOV)
- [x] 6.1 分析并重构基础 FOV 射线投射算法 (Raycasting)。
- [x] 6.2 实现动态光源 (Dynamic Lights)，包括主角视野光源、火把墙壁固定光源、发光生物光源等。
- [x] 6.3 实现基于距离的光照衰减算法 (Light Attenuation) 和阴影投射。
- [x] 6.4 更新 PixiJS 渲染层 `GameCanvas.vue`，利用计算出的光照模型渲染彩色渐变的迷雾效果，实现 Brogue 标志性的暗色动态探索氛围。

## 阶段 9：基于武器的战斗系统 (Weapon Combat Mechanics)
- [x] 9.1 实现 D&D 风格字符解析函数 (例如 `"1d4"`, `"2d4+1"`) 至 `Random.ts`。
- [x] 9.2 在核心 `Combat.attack` 函数中将基于武器伤害（Weapon modifiers）加入战斗公式替代默认木手。
- [x] 9.3 结合 `MessageLog` 正确展示装备攻击与防守判定文案。

## 阶段 10：扩展怪物阵营与掉落机制 (Expanded Roster and Loot Drops)
- [x] 10.1 创建外部怪物数据库字典 `monsters.json` 包含 Rat, Jackal, Kobold, Goblin 基础数据。
- [x] 10.2 重构 `Game.populateLevel` 在地图空余 Floor 按当前 Depth 随机分配敌人。
- [x] 10.3 重构 `Game.populateLevel` 在地图随机散落少许武器。
- [x] 10.4 完善击杀判定，依据 `goldDropChance` 和 `itemDropChance` 在怪物死亡坐标掉落装备/金币。

## 阶段 11：消耗品机制与随机鉴定 (Potions and Scrolls)
- [x] 11.1 创建 `consumables.json` 定义生命药水、传送卷轴等基础神器。
- [x] 11.2 实现 `ItemLoader.initConsumables()` 随机混淆算法，为药水分配随机颜色，为卷轴分配随机咒语名。
- [x] 11.3 在 `Game.populateLevel` 中加入药水和卷轴的地牢自然掉落逻辑。
- [x] 11.4 升级 `InventoryOverlay.vue` 以支持 `[q] Quaff` (饮用) 和 `[r] Read` (阅读) 专用交互入口。
- [x] 11.5 完善 `Game.quaffItem` 与 `readItem`：触发后销毁物品，打印功效日志，并解锁该物品的全局图鉴 (Identification)。

## 阶段 12：核心细节打磨与楼层系统 (Core Polish & Depth Progression)
- [x] 12.1 修复物品拾取无日志提示的问题 (`handlePlayerAction` - pickup)。
- [x] 12.2 完善物品鉴定：修改 `Item` 的 displayName/displayColor `Getter`，使得已鉴定的药水/卷轴在地上或背包里能正确显示真名和真实颜色。
- [x] 12.3 修复 UI 遮挡：将 `App.vue` 中的 Canvas 容器限制正确，使用 Pixi `resizeTo` 父容器避免在小窗口下被右侧栏遮挡。
- [x] 12.4 FOV 初见提示 (Discovery Logging)：记录视野中新出现的怪物或特定物品，日志输出 "You see a Jackal."。
- [x] 12.5 高亮地表交互物：在 `GameCanvas.vue` 渲染环节给地上的物品和敌人添加简单的呼吸动画缓冲或亮度提升。
- [x] 12.6 自动探索 (Auto-Explore)：绑定 `x` 键，实现 Dijkstra 路径规划到最近的未知区域 (Unexplored Cell)。
- [x] 12.7 楼层与深度系统 (Depth Progress)：生成阶段在当前层加入上下楼梯 (`<`, `>`)；触发后重新 `populateLevel()` 并提升/降低 Depth 难度。

## 阶段 13：深入机制修复与楼层持久化 (Deep Fixes & Persistent Depths)
- [x] 13.1 拾取日志位置修复：确保 `Picked up ...` 打印到 UI MessageLog，而不是仅仅输出在 `console.log`。
- [x] 13.2 右侧 UI 遮挡修复：彻底排查 `Sidebar.vue` 宽度，确保 `App.vue` 或 `GameCanvas` 留出足够的 padding/margin 以防止地图最右侧内容被压盖。
- [x] 13.3 楼层持久化 (Persistent Map)：重构 `Game.ts` 的 `generateDepth()`，实现 `Map<number, LevelData>` 来缓存曾经探索过的楼层状态，确保上下楼梯能回到原本的地图布局和怪物分布。
- [x] 13.4 Sidebar 深度数据层绑定：修复 `Sidebar.vue` 中写死的 `Depth: {{ 1 }}`，使其响应 `Game.depth` 变化。
- [x] 13.5 自动探索 (Auto-Explore) 的中断与寻路逻辑升级：
  - [x] A: 遇到怪物必须“暂停”而不是“清空”寻路目标，等怪物被击败/离开后按 `x` 继续走到原来的目标如果它还是黑的。
  - [x] B: 确保能遍历整层地图所有可探索角落，直到**完全没有** Unexplored Cell 时才弹窗提示完毕。

## 阶段 14：自动探索与战斗逻辑深化 (Auto-Explore & Auto-Attack Refinements)
- [x] 14.1 自动攻击 (Auto-Attack)：按下 `x` 且有敌人相邻时，直接对相邻敌人发起攻击（优先血量最低），不弹框提示发现敌人。
- [x] 14.2 物品发现打断：自动探索视野中初次发现可用物品时，需要暂停探索并给出提示。
- [x] 14.3 探索目标优先级调整：将散落在地上的未拾取物品也作为 BFS 的有效目标，使得按 `x` 能够自动走过去拾取。
- [x] 14.4 自动拾取与快捷键优化：自动探索到达物品位置时触发自动拾取（Auto-pickup）；上下楼梯快捷键解绑合并，支持全角半角 `< > , . 《 》 ， 。` 单独响应。
- [x] 14.5 视野外记忆驻留 (FOV Memory)：修改渲染器和鼠标悬浮提示，使之前见过的梯子保持亮度，物品变为暗色并在鼠标指向时提示 `You remember seeing...`。
- [x] 14.6 鼠标点击智能移动：鼠标点击地图空地时自动寻路，遇到挡路敌人自动攻击；无视野外或已记忆物品时的停顿打扰，点击物品时自动拾取。

## 阶段 15：未鉴定机制与进阶物品系统 (Identification & Advanced Items)
- [x] 15.1 物品鉴定逻辑：在 `ItemLoader` 和 `Game.ts` 的药水/卷轴使用流程中挂载 `.identify` 接口并输出顿悟日志。
- [x] 15.2 诅咒与附魔：在 `Item.ts` 扩展 `isCursed`, `enchantment` 属性，并在 `ItemLoader` 生成装备时赋予随机词缀。
- [x] 15.3 力量需求与战斗惩罚：为角色添加基础力量，在攻击判定或行动中对比装备的 `strengthRequired` 进行惩罚。
- [x] 15.4 UI 响应：`InventoryOverlay.vue` 拦截诅咒道具脱下操作，强化力量需求未满足时的视觉警告。


## 阶段 16：环境互动与气体蔓延机制 (Environment & Gas Mechanics)
- [x] 16.1 投掷机制基础：允许玩家将物品当做投掷物使用，实装 `throwItem` 使得药水碎裂在指定地格。
- [x] 16.2 气体与燃烧核心：在 `EnvironmentManager.ts` 中构建气体散布算法、浓度衰减，以及草丛延烧到焦土的规则。
- [x] 16.3 特殊状态惩罚与结算：所有存活生物（含玩家）处于燃烧地格或毒气覆盖地格时承受持续环境伤害。
- [x] 16.4 视觉与渲染升级：更新 `GameCanvas.vue` 实现气体/火焰滤镜，直观呈现不同类型气体的覆盖范围和险情。

## 阶段 17：饥饿机制与休整恢复 (Hunger Mechanics & Resting)
- [x] 17.1 玩家营养值属性：引入核心属性 `nutrition` (最大值与起始饥饿度)，随回合流逝稳定下降。
- [x] 17.2 食物消耗品：在 `consumables.json` 定义 `ration_of_food`，在背包层支持 `[e] Eat` 食用动作恢复 `nutrition`。
- [x] 17.3 饥饿状态反馈：在右侧 `Sidebar.vue` 实时展示玩家饥饿状态 (Satiated, Hungry, Starving, Fainting)，饥饿后随回合缓慢扣血。
- [x] 17.4 地牢发呆与休整：完善在原点按 `.` (Wait) 操作，允许玩家消耗极少现实时间度过回合来回血（以飞速消耗食物为代价），在遭遇敌人或满血时打断。

## 阶段 18：隐蔽计算与怪物警觉 (Stealth & Enemy Awareness)
- [x] 18.1 怪物状态机：怪物分离出 `Asleep`（沉睡）, `Wandering`（游荡）, `Hunting`（追击）三种状态判定。
- [x] 18.2 潜行范围判定：根据玩家环境光照亮度与回合动作，实时计算并显示玩家被发现的潜行检测范围。
- [x] 18.3 视觉警觉反馈：在 `GameCanvas.vue` 中对沉睡中的怪物添加特定的视觉标识（如降低透明度或头顶 `z` 标志），未惊醒前不会主动进攻玩家。
