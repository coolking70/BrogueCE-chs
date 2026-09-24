Original prompt: 请参考brogue-web/ai_docs目录下的ai工作文件，为我继续完善这个js重构项目

## 2026-09-24 U01：实例快照丢字段

- 执行 u-01.prompt.md；按用户裁决采用 v2 实例 schema，不实现旧档迁移；W24/W25 flavor 兼容不动。
- 全枚举 Item、Creature、Monster、Player；新增 EntitySnapshot 字段合同，普通/变形/克隆共用，ID 图两阶段恢复。玩家饥饿事件与当前速度、物品 flags/钥匙/投掷组/符文目标、怪物历史 safety map/等待/携带图原样保存。
- 字段覆盖守卫检查 AST 声明和实际 own properties。实体深比较独立于编解码字段表；验证穿刺/突进、钥匙消耗、行动时机、死亡掉落和下一步状态消费者。
- 定向首轮因版本号误改到录像出口撞红，已修回且录像合同未改；定向 350 项通过。全品类新夹具 food 误写 foods 已修正。浏览器实际菜单保存→刷新→继续、穿刺与携带掉落通过；技能 canvas 导出黑图不作为视觉通过，使用有头整页截图核验。
- 最终 R∪S、build、drift、逐文件结果及冻结 SHA-256 见 ai_docs/reports/u-01.report.md / u-01-evidence。后续 U02 RNG、U03 多层与 Game 状态、U05a 产物所有权问题未扩入。
- 首次完整冻结：build/drift 通过，123 文件中 3 例失败（W25/W26 剩余的旧档缺计时器/容量推断，及 W5 改写夹具漏显式 E=0）。全部归档 prefinal-legacy-fixtures；仅调整这三个测试的相关片段，flavor 兼容和正常往返/零 RNG 守卫保持。最终从 build 完整重跑（8 workers），不拼接首次结果。自然生成补充覆盖休眠 wraith、携物 stone_guardian、绑定钥匙及地面 flags 武器，图比较通过。

## 2026-03-07 (胜负闭环完善 Win/Loss Game Loop)

### Bug 修复
- **Stats 持久化**：`GameSnapshot` 接口新增 `stats` 字段，`toSnapshot()`/`loadSnapshot()` 现在保存和恢复 kills/gold/turns/maxDepth
- **Depth 26 下楼梯**：修复 depth 26 仍然生成 STAIRS_DOWN 的问题，现在 depth 26 是最深层

### 死亡原因追踪
- **lastDamageSource 字段**：新增 `Game.lastDamageSource` 追踪最后伤害来源
- Monster.ts：怪物近战/远程攻击命中时设置 `lastDamageSource = monster.name`
- Game.ts：环境伤害（火焰/蒸汽/窒息孢子/饥饿）各自设置对应 lastDamageSource
- **具体死因**：`triggerGameOver` 现在根据 lastDamageSource 生成具体死因：
  - "被 [怪物名] 杀死。"
  - "溺死在深水中。" / "被岩浆焚化。" / "被火焰烧死。"
  - "被蒸汽烫死。" / "被蔓延的死亡孢子吞噬。"
  - "饿死了。" / "中毒身亡。"

### 胜利结算页面增强
- **GameEndOverlay.vue** 全面重写：
  - 新增得分（Score）显示：gold + 深度奖励 + 击杀奖励 + 物品价值，胜利翻倍
  - 新增背包物品列表，显示物品颜色和附魔值
  - 统计标签简化
  - 页面可滚动（适应长物品列表）
- **triggerGameOver** 现在捕获 `gameOverInventory` 和 `gameOverScore`

### i18n 中文翻译
- 新增 10 个死因翻译 key（death.*）
- 新增 endgame.score、endgame.inventory 翻译
- 更新 game.entrance_blocked 为更好的中文文案（水晶拱门）
- 更新 game.win 翻译

### 构建验证
- `npm run build` (`vue-tsc -b && vite build`) ✓ 784 modules · 零错误 · 2.59s

### 变更文件
| 文件 | 变更内容 |
|------|---------|
| `Game.ts` | stats 持久化、lastDamageSource、具体死因、depth 26 无下楼梯、gameOverInventory/Score |
| `Monster.ts` | 近战/远程攻击设置 lastDamageSource |
| `GameEndOverlay.vue` | 得分、物品列表、布局重写 |
| `zh_CN.json` | 死因翻译、结算页翻译、入口文案更新 |

## 2026-03-07 (hover/detail/translation fixes)

- 参考 `ai_docs/hover_detail_translation_fixes.md` 修复 hover 与详情交互缺失：
  - `Game.ts`：
    - 新增 `handleInspectAt(x, y)`，支持按地图坐标查看可见怪物/物品详情。
    - `updateHover()` 改为使用 i18next 文案，物品 hover 改用 `displayName`，避免未鉴定卷轴/法杖泄露真名。
    - 新增 `getTerrainName()`，补全所有 `TerrainType` 的中文显示名。
  - `GameCanvas.vue`：
    - 阻止 canvas 默认右键菜单。
    - 地图 `pointerup` 右键改为调用 `game.handleInspectAt(...)`，左键原移动/寻路逻辑保持不变。
  - `InventoryOverlay.vue`：
    - 新增“查看详情”按钮，调用 `generateItemDetail()` 写入 `activeGame.inspectTarget`。
  - `Sidebar.vue`：
    - 将 hover 相关周边硬编码英文标签替换为中文（深度/生命/食物/状态/行动日志、饥饿状态）。
  - `zh_CN.json`：
    - 新增 `hover.*`、`terrain.*`、`item.inspect` 相关翻译 key。

- 待验证：
  - 若后续继续做交互回归，可补充真实关卡中的右键怪物详情 smoke case（当前已用浏览器内注入测试物品覆盖右键/hover/背包链路）

- 验证结果：
  - `npm run build` 通过（`vue-tsc -b && vite build` 成功）。
  - 使用 web-game Playwright client 做 smoke：
    - 从主菜单进入游戏成功；
    - `render_game_to_text()` 正常输出；
    - 无新增 console/page errors；
    - headless 截图仍为全黑，延续该仓库已知 WebGL/截图环境限制。
  - 使用额外 Playwright 定向脚本验证：
    - 在 test 模式下注入未鉴定药水到玩家脚下与背包；
    - hover 文案为 `金色药水、你，位于地面`，确认使用 `displayName`，未泄露真名 `治疗药水`；
    - 地图右键可打开详情面板，标题为 `金色药水`；
    - 背包“查看详情”按钮可打开详情面板；
    - 打开背包后查看详情不会关闭背包，`render_game_to_text().mode === 'inventory'`。

## 2026-03-04

- **Stage 4 收尾**（怪物抗性矩阵 + 玩家临时免疫 buff + i18n 清理）：
  - `monsters.json`：为 Rat/Kobold/Jackal/Goblin 补全 `statusImmunities` 和 `statusResistTurns`
  - `arcana.json`：新增 `charm_of_protection`（minDepth 4，cooldown 320）
  - `Player.ts`：`temporaryImmunities` 系统——`grantTemporaryImmunity()`、`tickTemporaryImmunities()`
  - `Game.ts`：
    - `useArcanaItem` 新增 charm_of_protection 分支（随机 15 turn 状态免疫）
    - `applyMonsterOnHitStatus` 先检查 `player.temporaryImmunities`
    - `runMonsterTurns` 每回合 tick 临时免疫并记录过期日志
    - 迁移 15 处硬编码英文日志至 i18next key + zh_CN 翻译
  - `GameSnapshot`：新增 `player.temporaryImmunities` 和 monster `abilities` 字段以持久化

- **Stage 5 地形机关**（TRAP / SECRET_DOOR / PRESSURE_PLATE）：
  - `Grid.ts`：新增 3 个 TerrainType；Cell 增 `trapType` 和 `isDiscovered`
  - `Architect.ts`：`placeTraps(depth)` 按深度散布陷阱（d3+）、秘密门（d4+）、压力板（d5+）
  - `Game.ts`：`triggerTrap()`（毒气/传送/火焰）、`triggerPressurePlate()`（半径3链式触发）、`teleportPlayerRandom()`、相邻秘密门30%自动发现
  - `GameCanvas.vue`：新增 TRAP(^)、SECRET_DOOR(#)、PRESSURE_PLATE(_) 视觉渲染
  - `zh_CN.json`：5个 `trap.*` i18n key

- **Stage 6 怪物 Roster 扩充**（10只怪物 + 能力旗标系统）：
  - `monsters.json`：新增 bat/snake/ogre/troll/centaur/vampire（含各自抗性矩阵）
  - `Monster.ts`：`MonsterAbility` 类型 + 行为钩子：
    - **flying**：路径规划忽略水/熔岩地形
    - **regenerating**：每10回合自动回1 HP
    - **ranged**：视线2-8格内执行远程攻击
    - **poisonous**：复用 onHitStatus 机制
  - `zh_CN.json`：6 个 monster 名称翻译 + combat.monster_ranged_hits key

- **构建验证**：`vue-tsc -b && vite build` ✓ 765 modules transformed · 零错误 · 2.54s

## 2026-03-03

- Stage 0/1 kickoff (parity plan execution started):
  - Added `Game.startNewGame({ seed, mode })` with mode support (`normal/easy/wizard`) and deterministic seed capture (`currentSeed`).
  - Added save/load snapshot APIs: `Game.toSnapshot()` and `Game.loadSnapshot()`.
  - Added stage-1 main menu UX in App:
    - New game (optional seed)
    - Mode select (normal/easy/wizard)
    - Save current game
    - Continue from localStorage
    - Save metadata preview in menu (depth/mode/seed/time)
    - Delete save action
  - Fixed menu save-state reactivity:
    - `hasSave/saveInfo` now update immediately after save/delete/load via a reactive `storageTick`.
  - Smoke-verified menu flow in browser automation:
    - New game -> open menu -> save -> metadata visible -> delete save -> continue disabled.
  - Added planning document `ai_docs/parity_plan.md` with CE gap matrix and phased checklist.

- Combat log fix:
  - Added monster attack logging in `Monster.takeTurn()` so enemy hits/misses now appear in the right-side ACTION LOG.
  - Added matching floating text on player when monsters hit/miss, and a death log when HP drops to 0.
  - Internationalized those combat messages via i18next keys (`combat.*`) and added zh_CN translations.

- Completed stage 8.4 ("pause external game time when inventory is open"):
  - Added `Game.isTimePaused()` and used it from render loop.
  - `GameCanvas` ticker now exits early while inventory is open, so auto-path stepping and floating text ticks are paused.
- Fixed input conflict for `.` key:
  - Introduced contextual action `wait_or_stairs_down`.
  - `.` / `。` now descends only when standing on downstairs, otherwise it performs wait/rest.
  - Kept explicit `>` / `》` as direct stairs-down action.
- Added automation hooks expected by the web-game workflow:
  - `window.advanceTime(ms)` deterministic stepping wrapper.
  - `window.render_game_to_text()` concise JSON state for Playwright-based checks.
- Synced planning docs:
  - Marked `ai_docs/task.md` item `8.4` as done.
- Verification:
  - Ran skill client: `node ~/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js ...`.
  - Captured `output/web-game/state-0.json` and `state-1.json`; state output valid and movement reflected in text.
  - Screenshots `shot-0.png/shot-1.png` are fully black in headless mode (likely WebGL capture limitation in this environment); keep text-state checks as source of truth for now.
  - Ran a direct Playwright assertion script to verify inventory pause: opening inventory keeps player position fixed even after `ArrowLeft` + `advanceTime`.

## Notes / TODO for next agent

- TypeScript strict-mode cleanup has started (imports/visibility/inventory typing fixes landed), but `npm run build` is still blocked mainly by:
  - (Done in this round) `src/components/GameCanvas.vue` Pixi v8 typings incompatibilities
  - (Done in this round) `src/engine/Generator/*` nullability issues
  - (Done in this round) `src/engine/Map/Pathfinding.ts` nullability/typing issues
- If continuing UX polish, next high-value doc item is stage `6.3` (HD tile/texture path for high-resolution displays).

## 2026-03-03 (continued)

- Completed Stage 0 TypeScript build unblock:
  - `npm run build` now passes (`vue-tsc -b && vite build` successful).
  - Fixed Pixi v8 typing mismatches in `src/components/GameCanvas.vue`:
    - Replaced invalid `new TextStyle({ ...baseStyle })` clone pattern with shared `baseStyleOptions`.
    - Updated entity fill typing to accept both string/number color sources.
    - Migrated interactive shadow setup to Pixi v8 `dropShadow` object shape.
    - Removed obsolete `baseTexture` destroy option in app teardown.
  - Fixed strict null checks in:
    - `src/engine/Map/Pathfinding.ts` (2D array column assertions and directional index non-null usage)
    - `src/engine/Generator/Architect.ts` (room column guards + safe frequency fallback)
    - `src/engine/Generator/RoomBuilder.ts` (column indexing assertions)

- Validation:
  - Build: passed.
  - Ran Playwright skill client against `http://127.0.0.1:5173` for 2 iterations.
  - `output/web-game/state-0.json` and `state-1.json` valid; player moved from x=38 to x=37.
  - `output/web-game/shot-0.png` and `shot-1.png` still fully black in headless mode (same known environment issue); continue using text-state output as primary automated assertion in this environment.

## 2026-03-03 (menu i18n continuation)

- Completed parity plan stage-1 remaining menu i18n integration:
  - Replaced hard-coded menu UI strings in `src/components/MainMenu.vue` with i18next keys under `menu.*`.
  - Added mode label localization mapping in menu save metadata (`normal/easy/wizard` -> translated label).
  - Replaced hard-coded menu/log strings in `src/App.vue` with i18next keys/defaults:
    - start/save/load/delete save logs
    - in-game menu button text
  - Added corresponding `menu.*` zh_CN entries in `src/locales/zh_CN.json`.

- Synced plan document:
  - Marked `ai_docs/parity_plan.md`:
    - stage0 `npm run build` item as done,
    - stage1 `zh_CN` menu key integration as done.
  - Updated next-step suggestion toward stage2 replay system.

- Validation:
  - Build: passed (`npm run build`).
  - Playwright skill client run completed (2 iterations).
  - State snapshots still valid (`state-0.json` / `state-1.json`, movement reflected).
  - Headless screenshots remain black in this environment; text-state remains the reliable automated oracle.

## 2026-03-03 (stage2 recording foundation)

- Implemented replay stage-2 foundation: input event recording structure.
  - In `src/engine/Core/Game.ts`:
    - Added recording types:
      - `RecordedInputData`
      - `RecordedInputEvent`
      - `GameRecording`
    - Added runtime recording state:
      - `recordingStartAt`
      - `recordedInputEvents`
      - `recordedInputIndex`
    - Added recorder helpers:
      - `recordInputEvent(...)`
      - `toRecordedInputData(...)`
      - `clearRecording()`
      - `exportRecording()`
    - Extended `handlePlayerAction` with source tagging (`player` / `system`) so only player-originated inputs are recorded.
    - Marked internal/system-generated actions (auto-path, auto-explore attack, wait-or-stairs resolution, auto-pickup) as `system`.
  - Added automation debug hook in `src/components/GameCanvas.vue`:
    - `window.export_game_recording()` returns JSON string of `game.exportRecording()`.
  - Cleaned remaining debug output in core loop:
    - Removed stairs-down diagnostic `console.log`.
    - Replaced inventory-full `console.log` with UI log message.

- Plan sync:
  - Marked `ai_docs/parity_plan.md` stage2 item "事件录制结构定义（按 turn 存输入事件）" as done.

- Validation:
  - Build passed after change.
  - Note: this environment had intermittent sandbox restrictions launching additional ad-hoc Playwright sessions; core verification for this chunk relied on successful TypeScript build and existing automation hooks.

## 2026-03-03 (stage2 replay player minimum loop)

- Implemented replay stage-2 player controls (minimum loop):
  - Engine (`src/engine/Core/Game.ts`):
    - Added replay runtime state (`replayRecording`, `replayEvents`, `replayCursor`, `replayStatus`).
    - Added replay APIs:
      - `loadReplay(recording)`
      - `replayPlay()`
      - `replayPause()`
      - `replayStep()`
      - `replayRestart()`
      - `tickReplay()`
      - `clearReplay()`
    - Replay executes events through `handlePlayerAction(..., 'system')` to avoid recursive re-recording.
    - While replay is playing, direct player input is ignored.
  - Render loop integration (`src/components/GameCanvas.vue`):
    - Replay ticking is called in both ticker and deterministic `advanceTime(ms)` hook.
    - `render_game_to_text` includes replay status summary fields.
  - Menu/app integration:
    - `src/components/MainMenu.vue`: added replay controls:
      - save replay
      - load replay
      - delete replay
      - play / pause / step / restart
      - replay status/progress display
    - `src/App.vue`: wired replay actions with localStorage (`brogue-web-replay-v1`).
  - i18n:
    - Added `menu.replay.*` labels and replay log keys to `src/locales/zh_CN.json`.

- Validation:
  - Build passed (`npm run build`).
  - Ran Playwright skill client for smoke; screenshots updated.
  - Limitation: current automation action payload does not start a new game from menu, so it did not regenerate fresh `state-*.json` for this iteration; replay logic verification in this chunk is based on compile success and direct code-path review.

## 2026-03-03 (stage2 replay import/export + seek)

- Completed stage-2 remaining replay features:
  - Replay seek support in engine:
    - Added `replaySeek(targetIndex)` in `src/engine/Core/Game.ts`.
    - Refined `replayStep(silent = false)` so seek can fast-forward without replay-finished spam logs.
  - Menu replay controls expanded in `src/components/MainMenu.vue`:
    - Export replay JSON
    - Import replay JSON (file chooser)
    - Seek to event index
  - App-level handling in `src/App.vue`:
    - `exportReplayJson()` downloads current replay JSON.
    - `importReplayJson(file)` parses JSON, loads replay, and stores it in localStorage.
    - Replay seek event is wired to `activeGame.replaySeek(index)`.
  - Added zh_CN i18n entries for replay import/export/seek and related logs.

- Plan sync:
  - Marked `ai_docs/parity_plan.md` stage2 items complete:
    - replay player controls
    - replay JSON import/export initial version

- Validation:
  - Build passed (`npm run build`).

### Status correction
- User feedback indicates replay feature is still not behaving correctly in practice.
- Marked replay stage items in `ai_docs/parity_plan.md` back to pending-with-note.
- Per user request, proceed to stage3 first; replay will be fixed after that.

## 2026-03-03 (stage3 start: item data expansion)

- Began stage3 per user request before replay fixes.
- Expanded item data model with new categories:
  - `WAND`, `STAFF`, `RING`, `CHARM`, `KEY`, `AMULET`
  - Added optional runtime fields for charge/cooldown metadata on `Item`.
- Added new data source:
  - `src/data/arcana.json` with initial entries for wands/staffs/rings/charms/keys/amulets.
- Extended loader and spawners in `src/engine/Items/ItemLoader.ts`:
  - Added pools and spawn methods:
    - `spawnWand`, `spawnStaff`, `spawnRing`, `spawnCharm`, `spawnKey`, `spawnAmulet`
- Wired into floor loot generation in `src/engine/Core/Game.ts`:
  - `populateLevel` loot table now includes the new item families by depth.
- Updated inventory grouping in `src/components/InventoryOverlay.vue`:
  - New category sections for WANDS/STAFFS/RINGS/CHARMS/KEYS/AMULETS.

- Plan sync:
  - Marked `ai_docs/parity_plan.md` stage3 item "数据表扩展：wand/staff/ring/charm/key/amulet" complete.

- Validation:
  - Build passed (`npm run build`).

## 2026-03-03 (stage3 continuation: charge/cooldown skeleton)

- Added initial stage3 mechanics scaffold for arcana items:
  - Inventory UI:
    - Added `Use` button for `WAND` / `STAFF` / `CHARM`.
  - Game logic:
    - Added `Game.useArcanaItem(item)`:
      - wand/staff consume charges
      - charm uses cooldown gate
      - placeholder effects/logs for initial IDs
    - Added per-turn resource ticking:
      - wand/staff recharge counter and periodic charge restore
      - charm cooldown countdown
  - Persistence:
    - Added save/load serialization fields for:
      - `maxCharges`, `charges`, `rechargeTurns`, `rechargeCounter`
      - `cooldownTurns`, `cooldownRemaining`

- Validation:
  - Build passed (`npm run build`).
  - Playwright smoke run attempted; blocked by intermittent sandbox Playwright launch permission issue in this environment.

## 2026-03-03 (stage3 completion pass)

- Extended identify/recharge/uncurse flow from skeleton to playable first pass:
  - Arcana identification:
    - Added arcana flavor mapping in `ItemLoader` (`arcanaFlavorMap`), randomized per game init.
    - Wands/staffs/rings/charms now show unidentified flavor names until identified.
    - Arcana items gain `identityId` and become identified on successful use.
  - Scroll effects expanded (`consumables.json` + `Game.readItem`):
    - `scroll_of_remove_curse` (`remove_curse`)
    - `scroll_of_recharging` (`recharge_item`)
    - `identify_item` now identifies a random unidentified inventory item (including arcana).
  - Direct inventory actions:
    - Added `Recharge` action for wand/staff.
    - Added `Remove Curse` action for cursed items.
    - Added corresponding `Game.rechargeArcanaItem` and `Game.uncurseItem`.
  - Persistence:
    - Added snapshot field `identityId` and full load/save handling.

- i18n:
  - Added zh_CN keys for `Use`, `Recharge`, `Remove Curse`.

- Plan sync:
  - Marked stage3 items complete in `ai_docs/parity_plan.md` (first-pass completion).

- Validation:
  - Build passed (`npm run build`).

## 2026-03-03 (test mode scaffolding for asset QA floors)

- Added a dedicated `test` game mode entry in new game menu:
  - `MainMenu.vue` includes mode option `测试`.
  - Seed input is disabled when mode is `test`.
- Implemented test-mode map generation path in `Game.generateDepth()`:
  - Bypasses normal architect generation when `mode === 'test'`.
  - Generates deterministic "asset QA" floor layout by depth category:
    - weapons
    - wands
    - scrolls
    - potions
    - other items
    - special terrain
    - enemies
  - One floor per category in order (cycles by depth).
  - For each asset kind in category: one closed room with a door and one sample asset.
- Added special map elements:
  - `TerrainType.SIGN` and `TerrainType.RESET_PLATE`.
  - Signs:
    - category sign near spawn/stairs each floor;
    - per-room sign before door describing room content.
    - hover text includes sign content; stepping onto sign logs content.
  - Reset plate:
    - placed near each room sign;
    - stepping on it resets that room to baseline (terrain/items/monsters).
- Rendering and inspect support:
  - `GameCanvas.vue` visual mapping for SIGN/RESET_PLATE glyphs/colors.
  - Hover inspect text in `Game.updateHover` recognizes these terrain types.
- Data/helper updates to support test generation:
  - `ItemLoader` now exposes weapon/armor configs for category-driven room generation.

- Validation:
  - Build passed (`npm run build`).

## 2026-03-03 (stage4 kickoff: status/combat first pass)

- Continued to next phase per user instruction (replay deferred to later).
- Added a unified creature status system in `src/entities/Creature.ts`:
  - status ids: `paralyzed`, `invisible`, `telepathy`, `levitating`, `hallucinating`, `confused`
  - status duration storage, refresh/stack semantics, immunities, per-turn ticking.
- Wired status system into core loop (`src/engine/Core/Game.ts`):
  - Player action gate: paralyzed player cannot act.
  - Added status application helpers and per-turn status ticking with expiry logs.
  - Added persistence for status durations in save/load snapshots (player + monsters).
  - Added telepathy behavior in discovery: can sense monsters outside normal LoS.
- Expanded status interactions:
  - Confusion gas now applies status (`hallucinating` for player, `confused` for monsters).
  - Levitating entities no longer take ground-fire damage.
  - Arcana effects now apply concrete statuses in first pass:
    - `staff_of_light` -> telepathy
    - `charm_of_speed` -> levitating
    - `wand_of_beckoning` -> paralyze nearest visible monster
- Monster AI refinement (`src/entities/Monster.ts`):
  - paralyzed monsters skip turn;
  - confused monsters may wander randomly;
  - player invisibility reduces monster detection range.
- Combat formula pass (`src/engine/Combat/Combat.ts`):
  - Added armor-based damage reduction when player is defender.
  - Under-strength armor gives reduced protection penalty.
  - Player invisibility grants hit chance bonus.
- UI/test-state support (`src/components/GameCanvas.vue`):
  - `render_game_to_text` now includes player status map.
  - Telepathy reveals monsters in render/text output (cyan non-LoS marker).

- Plan sync:
  - Marked parity stage4 first item complete (framework level), kept remaining stage4 items pending with partial-progress notes.

- Validation:
  - `npm run build` passed.
  - Ran Playwright client script (`web_game_playwright_client.js`) against `http://127.0.0.1:5173` with action payloads.
  - `output/web-game/state-0.json` and `state-1.json` updated and include new `player.statuses` field.
  - Screenshots are still fully black in this environment (known headless capture limitation); used text-state output as primary automated oracle.

## TODO (next agent)

- Continue stage4 status depth:
  - Add direct gameplay sources for `invisible`/`hallucinating` beyond gas/arcana placeholders.
  - Expand monster perception rules (telepathy/awareness interactions) to better match CE.
  - Start runic trigger skeleton in combat/item model.
- Replay system still intentionally deferred; repair after stage progression per user priority.

## 2026-03-03 (stage4 continuation: runic + status sources)

- Added first-pass runic item model:
  - `Item` now includes `runicType` and `runicKnown`.
  - Weapon/armor display name reveals runic suffix once known.
  - Snapshot serialization now persists runic fields.
- Added random runic roll in `ItemLoader`:
  - weapons: `paralyzing` / `venom` (small chance)
  - armors: `reflection` / `dampening` (small chance)
- Added runic trigger skeleton in combat flow:
  - Player hit can trigger weapon runic effects (`paralyzing`, extra venom damage).
  - Monster hit on player can trigger armor runic effects (`reflection`, `dampening` heal-back).
  - Trigger discovery marks runic as known and prints combat logs/floating text.
- Expanded consumable/status interactions:
  - `potion_of_confusion` now applies hallucination status to player.
  - `potion_of_poison_burst` and `potion_of_fire_burst` now affect local environment on quaff.
  - `scroll_of_enchantment` now enchants equipped weapon/armor and can awaken a runic effect.
- Added gameplay impact for hallucination:
  - Movement can randomly deviate while hallucinating.
  - Renderer now applies occasional psychedelic glyph/color distortion to visible tiles/items/monsters during hallucination.

- Validation:
  - `npm run build` passed.
  - Playwright client smoke run completed; latest state JSON valid and includes status field.
  - Headless screenshots still fully black in this environment; text-state remains the reliable oracle.

## TODO (next agent)

- Stage4 runic follow-up:
  - Balance proc rates and effect strengths.
  - Add more runic families and CE-like trigger conditions.
  - Separate runic identification from immediate trigger reveal if deeper mystery is desired.
- Stage4 status follow-up:
  - Add dedicated invisibility source and richer monster perception exceptions.
  - Refine hallucination to affect inspect/log perception, not just movement/render.
- Replay remains deferred intentionally and should still be fixed after stage progression.

## 2026-03-03 (stage4 continuation: ring passives + invisibility source)

- Continued phase progression with replay still deferred.
- Added ring equipment slot support:
  - `Player` now supports `equippedRing`.
  - Inventory equip/unequip logic supports rings.
  - Inventory UI marks rings as equippable/equipped.
- Added ring passive status sync in game loop:
  - `ring_of_awareness` grants sustained `telepathy` while equipped.
  - `ring_of_regeneration` grants sustained `regenerating` while equipped.
- Added dedicated invisibility source:
  - New arcana entry `charm_of_invisibility` in `src/data/arcana.json`.
  - `useArcanaItem` now applies `invisible` when this charm is used.
- Added regeneration status to the core status enum and integrated with hunger/heal pacing:
  - While regenerating, natural heal threshold is improved.
- Save/load compatibility extended:
  - Snapshot now stores/loads `equippedRingId`.

- Validation:
  - `npm run build` passed.
  - Playwright smoke run completed; state snapshots updated and valid.
  - Headless screenshots remain black in this environment; text-state remains the primary automated oracle.

## TODO (next agent)

- Continue stage4 depth:
  - Add clearer UI/status indicators for passive ring auras.
  - Balance aura durations and regeneration pacing.
  - Expand invisibility interactions (e.g., ranged targeting, first-hit bonuses).
- Replay still postponed by user request until later full-phase completion.

## 2026-03-04 (stage4 continuation: status UX + stealth pursuit tuning)

- Added status visibility in sidebar:
  - Sidebar now displays active player statuses with remaining turn counters (e.g. `invisible(12)`, `telepathy(2)`).
- Improved stealth pursuit behavior in monster AI:
  - Hunting monsters now drop back to `WANDERING` when they lose LoS and player is sufficiently far.
  - This reduces unrealistic long-distance lock-on after invis/line-break escapes.
- Added invisibility break-on-attack behavior:
  - When player attacks while invisible, invisibility is removed and a reveal log is printed.
  - Keeps first-strike stealth bonus while preventing permanent melee invis abuse.

- Validation:
  - `npm run build` passed.
  - Playwright smoke run completed; state snapshots valid.
  - Headless screenshots still black in this environment; text-state remains primary oracle.

## TODO (next agent)

- Stage4 polishing:
  - Localize new status strings/logs (currently mostly English literals).
  - Tune detection drop-off thresholds by depth/monster archetype.
  - Add an explicit status effect source for `paralyzed` on player side (non-gas trap/spell path).
- Replay remains intentionally postponed until all planned stages complete.

## 2026-03-04 (stage4 continuation: monster on-hit statuses + status label polish)

- Added monster-driven on-hit status hooks (data-driven):
  - Extended `MonsterData` with optional `onHitStatus`, `onHitChance`, `onHitDuration`.
  - Wired combat application on successful monster hit (`Monster.takeTurn` -> `Game.applyMonsterOnHitStatus`).
  - Added first config in `monsters.json`:
    - Kobold can inflict brief confusion,
    - Goblin can inflict brief paralysis.
- Snapshot persistence updated for these new monster status-attack fields:
  - save/load + test-room baseline reset paths now carry on-hit status metadata.
- Sidebar status readability improved:
  - Active status chips now render localized-readable labels with per-status color coding instead of raw internal IDs.

- Validation:
  - `npm run build` passed.
  - Playwright smoke run completed; text states valid.
  - Headless screenshots remain black in this environment; text-state remains primary oracle.

## TODO (next agent)

- Continue stage4 balancing:
  - Tune per-monster status proc rates by depth.
  - Add resist/mitigation hooks (e.g., ring/charm reducing status duration).
  - Localize remaining new combat/status logs to i18n keys.
- Replay still intentionally deferred until all planned stages complete.

## 2026-03-04 (stage4 continuation: status config + resistance hooks + i18n)

- Added central status config table:
  - New file `src/engine/Status/statusConfig.ts` as single source of truth for status labels/colors/debuff flags.
  - Sidebar now consumes this table instead of local hardcoded status metadata.
- Added status resistance/mitigation hooks for player:
  - New resistance path in `Game.applyMonsterOnHitStatus`:
    - chance-based nullify (`status.player.resisted`),
    - duration reduction before application.
  - Initial resistance providers:
    - `ring_of_awareness` helps against confusion/hallucination (and slight paralysis mitigation),
    - `dampening` armor runic reduces negative status duration.
- Expanded data-driven monster on-hit status support end-to-end:
  - `MonsterData` / runtime monster fields / snapshot persistence include:
    - `onHitStatus`, `onHitChance`, `onHitDuration`.
- i18n pass for new stage4 logs:
  - Replaced several newly introduced hardcoded English logs with i18next keys/defaults in `Game.ts`.
  - Added corresponding zh_CN keys for status transitions, resistance, runic triggers, and invisibility-break message.

- Validation:
  - `npm run build` passed.
  - Playwright smoke run completed; state snapshots valid.
  - Headless screenshots remain black in this environment; text-state remains the reliable automated oracle.

## TODO (next agent)

- Continue stage4 balancing and completeness:
  - Tune resistance numbers and proc rates by depth.
  - Add more status sources and explicit immunity traits per monster/faction.
  - Continue i18n key migration for remaining stage3/4 hardcoded logs.
- Replay remains intentionally deferred until all planned stages are complete.

## 2026-03-04 (stage4 continuation: explicit immunity trait + i18n expansion)

- Added explicit monster status immunity trait (data-driven):
  - `MonsterData` now supports `statusImmunities`.
  - Runtime monster instances now load this into `statusImmunities` set.
  - Added first immunity example in data: `Jackal` immune to `confused`.
- Extended persistence paths for immunity + on-hit status fields:
  - Snapshot save/load and test-room baseline reset now preserve immunity and on-hit status metadata.
- Expanded stage4 i18n pass:
  - Migrated additional status/combat-related logs to i18next keys in `Game.ts`.
  - Added zh_CN keys for hallucination stumble, starvation damage warning, and beckoning-target logs.
- Status resistance hooks from previous step remain active and now combine with explicit immunity behavior.

- Validation:
  - `npm run build` passed.
  - Playwright smoke run completed; state snapshots valid.
  - Headless screenshots still black in this environment; text-state remains the reliable oracle.

## TODO (next agent)

- Continue stage4 completion:
  - Add more monster archetype immunities/resistances by depth.
  - Add player-side temporary immunity buffs (e.g. charm/ring interactions).
  - Continue migrating remaining hardcoded gameplay logs to i18n keys.
- Replay remains intentionally deferred until all planned stages complete.

## 2026-03-04 (stage4 continuation: monster resist-turns + unified monster status application)

- Added monster status resistance (duration reduction) support:
  - `MonsterData` now supports `statusResistTurns` per status id.
  - Runtime `Monster` now stores this map and uses it via a unified status application path.
- Added unified monster status application helper in `Game`:
  - `applyStatusToMonster(monster, status, duration, source)` centralizes
    - immunity checks,
    - duration reduction from resistances,
    - resist/immune log messages (i18n).
- Wired major status sources through the unified monster path:
  - Wand of Beckoning paralysis,
  - runic paralyzing weapon proc,
  - confusion gas application to monsters.
- Data updates:
  - `Jackal` keeps `confused` immunity,
  - `Kobold` gets brief resistance to `paralyzed`,
  - `Goblin` gets brief resistance to `confused`.
- Added i18n keys for monster immunity/resistance logs in zh_CN.

- Validation:
  - `npm run build` passed.
  - Playwright smoke run completed; state JSONs valid.
  - Headless screenshots remain black in this environment; text-state remains primary oracle.

## TODO (next agent)

- ~~Continue stage4 finalization~~ ✅ Stage 4 Machine Blueprint System complete (2026-03-05)
  - Created `blueprints.json` with 20 data-driven blueprint definitions
  - Created `BlueprintEngine.ts` (weighted selection, flood-fill room finding, feature placement)
  - Replaced 4 hardcoded machine generators in `Architect.ts`
  - Added `spawnBlueprintItem`/`resolveBlueprintMonster` to `Game.ts`
  - Added `machineNumber` to `Grid.ts` `Cell`
  - Build: 0 errors, 779 modules
  - Changed files: `BlueprintEngine.ts` [NEW], `blueprints.json` [NEW], `Architect.ts`, `Game.ts`, `Grid.ts`
- ~~Continue to stage5: 战斗公式精确化~~ ✅ Stage 5 Combat Formula Precision complete (2026-03-05)
  - Created `CombatFormulas.ts` (pure math: `netEnchant`, `hitProbability`, `defenseFraction`, `clumpedRoll`, runic chances)
  - Rewrote `Combat.ts` with CE-accurate hit (`accuracy × 0.987^defense`), damage scaling, backstab 3x, clumped rolls
  - Added `accuracy`/`defense` to `MonsterData`/`Monster` (used by `monsters_ce2.json`)
  - Added `applyWeaponRunicEffect` (enchantment-scaled triggers) with 3 new weapon runics: force, slaying, mercy
  - Added 3 new armor runics: absorption, reprisal, immunity
  - Build: 0 errors, 780 modules
  - Changed files: `CombatFormulas.ts` [NEW], `Combat.ts`, `Monster.ts`, `Game.ts`, `ItemLoader.ts`
- Continue to stage6: Dijkstra 热力图 + 高级寻路
- Replay remains intentionally deferred until all planned phases are complete.

## 2026-03-05 (第三阶段完成: 环境与地形深化 Environment & Terrain Deepening ✅)

### 地形扩充 (Terrain Expansion)
- `Grid.ts`：新增 `WEB`、`BLOOD`、`MUD` 三种 TerrainType
- `GameCanvas.vue`：为三种新地形添加视觉渲染 (颜色/字符映射)
- `Architect.ts`：按深度生成泥潭 (depth≥3) 和蛛网 (depth≥4)
- `Monster.ts`：重构为 `tryMoveTo()` 方法，统一处理蛛网缠绕/泥潭减速效果
- `Game.ts`：玩家移动加入蛛网 (定身挣脱概率) 和泥潭 (双倍耗时) 判定

### 血迹系统 (Blood Splatter)
- `Game.ts`：新增 `spawnBlood()` helper 方法
- 玩家近战攻击命中后自动在目标位置生成血迹
- `Monster.ts`：怪物攻击玩家时也在战斗位置生成血迹

### 气体引擎强化 (Gas Engine - Cellular Automata)
- `Gas.ts`：重写 `updateGases()` 为高级细胞自动机模型 (浓度消散/扩散/混合)
- 新增 `GasType.CREEPING_DEATH` (窒息孢子气体)
- `GameCanvas.vue`：为窒息孢子添加深红色视觉渲染
- `Game.ts` `applyEnvironmentalEffects()`：
  - 毒气：改为施加 `poisoned` 状态而非直接扣血
  - 混乱气体：施加 `hallucinating`/`confused` 状态
  - 窒息孢子：每回合 10 点伤害

### 火焰蔓延与植被循环 (Fire Spread & Vegetation Cycle)
- `Gas.ts` `updateFires()`：
  - 蛛网 (`WEB`) 加入可燃物列表
  - 扩散概率从 30% → 40% 增强火焰波浪效果
  - 新增 `CHARRED_FLOOR` 极低概率 (0.05%) 重新长出 `GRASS`/`FOLIAGE` 的再生机制

### 深水/岩浆致死判定 (Instant Death Mechanics)
- `Creature.ts`：`StatusId` 新增 `flying` 和 `immune_fire`
- `statusConfig.ts`：补充飞行/火焰免疫的 label 和颜色
- `Game.ts` `applyEnvironmentalEffects()`：
  - `WATER_DEEP`：非飞行/漂浮实体立即淹死
  - `LAVA`：非飞行且非火免实体立即焚死
  - 怪物能力 (`abilities`) 也纳入飞行/火免判定
  - 新增岩浆物品焚毁逻辑 (items in lava are destroyed)
- 火焰伤害增加 `immune_fire` 豁免检查

### 液体表面物品拾取限制 (Liquid Surface Item Pickup)
- `Game.ts` `pickup` action：
  - 深水中的物品需要飞行/漂浮才能拾取
  - 岩浆中的物品需要飞行/火免才能拾取

### 构建与测试验证
- `npm run build` (`vue-tsc -b && vite build`) ✓ 777 modules · 零错误 · 4.31s
- Browser Agent 实机验证 100+ 回合：
  - 深水淹死判定正常 (玩家+怪物)
  - 血迹渲染正常
  - 泥潭地形可见
  - 游戏稳定无崩溃

### 相关文件变更清单
| 文件 | 变更内容 |
|------|---------|
| `Grid.ts` | 新增 WEB/BLOOD/MUD TerrainType |
| `GameCanvas.vue` | 新增 WEB/BLOOD/MUD/CREEPING_DEATH 渲染 |
| `Architect.ts` | 按深度生成泥潭和蛛网 |
| `Monster.ts` | tryMoveTo() 重构 + 血迹生成 |
| `Game.ts` | 蛛网/泥潭移动、血迹、深水/岩浆致死、物品焚毁、气体效果 |
| `Gas.ts` | updateFires() 重写 + updateGases() CA 重构 + CREEPING_DEATH |
| `Creature.ts` | StatusId 新增 flying/immune_fire |
| `statusConfig.ts` | 新增飞行/火焰免疫配置 |

## 2026-03-07 (第七阶段: UI 与体验打磨 - 详情说明界面 Inspect Panels)

### Detail Generator & Data
- `monsters_ce2.json`, `weapons.json`, `armors.json`: Added translated flavor text descriptions from original Brogue CE.
- `DetailGenerator.ts`: Created to parse combat formulas, statuses, abilities, and build a localized formatted output array of sections (Base Attributes, Combat Analysis, etc.).

### UI Overlay (`DetailPanel.vue`)
- Implemented a centered, floating overlay panel to display entity stats.
- Auto-updates content if the target changes.
- Pressing `Esc` or `x` closes the panel.

### Examine & Auto-Explore Integration
- `Game.ts` & `Input.ts`: `x` key maps to the newly unified examine/explore logic.
- When pressing `x`:
  - The game scans for the nearest visible monster or item.
  - If found and not yet examined, it opens the detail panel (`inspectTarget`).
  - To prevent re-triggering on the same entity during auto-explore, `Game.ts` now uses a persistent `Set` (`examinedEntityIds`) to track seen entities.
  - If nothing new is visible, it falls back seamlessly to `auto_explore`.
  - Closing the detail panel with `x` immediately resumes auto-exploration.

### Bug Fixes
- **Clear App Crash**: Fixed an issue where returning to the main menu and starting a new game threw a `Cannot read properties of null (reading 'clear')` error by ensuring `activeGame.onRenderRequested` is cleared on `GameCanvas.vue` unmount.
- **Horde Generation**: Fixed an issue where depth 1 was incorrectly spawning Goblins. `Game.ts` now properly filters out any horde definitions containing `HORDE_MACHINE_` flags from standard natural spawning.

## 2026-09-23 W-2：施法选择与提交

- 按 w-2.prompt / W-0 §2.3 实现选择态、确认事务、敌友/未知候选与 autoID 观察；effects/生成/充能模型保持后续轮边界。
- 已读 CE Items.c 选择、空杖、autoID 与 Time.c:2604-2605；耗时取效果后的 movementSpeed。
- B-1a、B-1c、W-1 outcome 和 P1-46 a 键留痕反转，具体依据随测试与 w-2.report.md。
- 已完成定向验证与实际 Playwright 键鼠流程：Vue toRaw 修复物品身份，取消零消耗，相邻格点击与 Tab/Shift-Tab/Enter 提交，未知态消息与截图均检查。
- R+S 反查选择 101 文件（R 98，S 补 3）；包含无直接 import 的 UI 源码守卫。
- 开始冻结后的最终 build、显式文件定向测试、drift 与 SHA-256 前后比对；完成结果见 ai_docs/reports/w-2.report.md。
- 后续保持 W-3/W-4 轨迹/反射、W-5/W-6 初始充能/自然回电、W-8~23 效果的边界；治疗/加速/隐形旧自施、召唤空桩仍待对应轮修复。

- 最终复核补齐 CE 右键/空格取消；第一次拟最终运行主动中断，不当作最终结果，全部源文件重新冻结并完整重跑。

## 2026-09-23 W-3：普通射线轨迹

- 当前请求：严格执行 w-3.prompt，以 W-0 §2.3 为准；解释 hits、复跑 W-2 autoID、逐项覆盖七种舞台；保留 W-4/W-12/W-13 边界，不放宽机器阻挡。
- 新增 CE 16 位定点、21 个 diamond offsets 取线，玩家/怪物共用逐格接触与阻挡时序；地图原语调用保持现有实现，补龙火现有 DF_OBSIDIAN 的路径接线。
- 保留投掷物旧线段函数；自动候选 openPath 改用未调优的 CE 中心线，并截到候选格。
- 初测 W-2 29 例、9c、P4-1b/3 通过；W-1 三处旧轨迹/穿过拦路者的夹具按 W-3 留痕反转。新增共线夹具的失败最初误归因于 CE 避开友军；独立 C 差分揭示真正成因是所有候选评分非正时错误返回空线。已修正 bestOffset=0 的中心线兜底并新增守卫，原敌方双怪用例仍保留。
- R+S 已反查 108 文件；Map 四组未漏。新增 30 例通过，7 种临时错误版本各自确实翻红，源码已逐字恢复。
- CE 原 getLineCoordinates 的独立 C 差分 3456 条零差异，覆盖四地图/四法术/全瞄准格。只有轨迹常规范围，不冒充效果/反射差分。
- Playwright 实测 Enter 闪电穿两怪（100→90/90），方向瞄准烧门命中（100→94），整页截图已检查，零控制台错误。
- 修正首格 HALTS 顺序：CE conjuration 首格更新，只有 blink 贴脸提前拒绝；不实现 blink 移动/地形。
- 已冻结实现与测试，开始最终 build、显式 107 文件定向回归和独立 drift；结果、逐文件数量与前后 SHA-256 回填 w-3.report.md。
- 后续 W-4 实现真正反射轨迹；W-12/W-13 实现 blink/tunnel；保留 W-8+ 效果/公式/旧自施/网藤缺口，机器禁用过滤不动。

## 2026-09-23 W-4：通用反射与命中分派

- 当前请求：严格执行 w-4.prompt / W-0 §2.3；hits 表达反射后接触者，复跑 W-2 的29例；openPath 仍只看候选前方，实际反射轨迹另行延伸；效果公式与生成基线不动。
- 读取 CE Items.c:4960-5065/5675-5705/5785-5852，接入两次反射判定、首次原路返回、后续未调优取线、随机40周界目标/50次重试、水晶前格反射和有限路径预算。
- 玩家与怪物进入相同碰撞/反射分派；反射者单独记 reflections，hits 是反射之后按次序的实际效果接触（可重复、可包含玩家/原施法者；不是扣血保证）。旧自施增益仍留 W-9/W-15。
- Combat 目录明确改 Bolt.ts、BoltTrajectory.ts、Combat.ts，新增 BoltReflection.ts；移除 damageTarget 旧捷径。Game 移除旧反伤与护甲事后半伤；BE_ATTACK 恢复武器资格，BE_DAMAGE 的旧怪物攻击公式未换。
- 护甲 reflection 与 immunity 敌种类反射在接触前判定；新增只供反射使用的 CE 类别成员投影，不改 ItemLoader 生成抽取或其它护甲效果。
- 定向7文件140例通过，含 W-4 新增29例、W-2原29例、P4-3/P4-4和护甲；W-3三处登记与护甲旧反伤断言依据 CE 留痕翻正。7种临时错误实现均翻红，文件已逐字恢复。
- 浏览器技能客户端与真实页面验证：seed1 火返玩家100→94；seed37 迟缓旁射命中老鼠；seed63 水晶随机返玩家100→94。无页面/控制台错误，整页截图复核；技能canvas导出黑图不充当视觉通过。
- R(实际5生产文件+2个翻译资源)+S(B,C,M,反射/读取补查)最终覆盖104文件；冻结全部实现、测试、配置后最终build、显式103文件回归、独立drift。最终逐文件结果与SHA-256见 ai_docs/reports/w-4.report.md。
- 后续：W-8伤害公式/火免，W-9旧heal/haste/空射invisibility自施与discord状态，W-12/13 blink/tunnel，W-15护盾、W-21强化、W-23消魔资格仍待对应轮；怪物BLINKING/网/藤未启用。历史immunity受伤后无类别退款不在此轮重写范围。

- 第一次拟最终门禁仅i18n死键门失败：4条已移除反射日志的中文键原值归档到legacy，未改门禁断言；补R新增itemFlavors。修后5文件116例通过，再次冻结完整复跑；初次结果不冒充最终。最终范围含CombatFormulas原有4todo，连同smoke共5todo，均未新增/修改。

## 2026-09-23 W-5：法器实例初始值

- 当前请求：严格执行 w-5.prompt / W-0 §2.3；先测后改，8 seed × D1–26 前后同样本，基线最后重捕获；不加种类/不改频率、不实现 W-6 生命周期。
- 新增 ArcanaInstance 初始抽签与纯迁移 helper：CE staff 50%→15%→10% 尾部；5 个既有 CE wand range；3 个退池自创法器保留固定容量直造。
- enchantment 为 E，charges 为剩余次数，maxCharges 为容量；实例版本标记区分旧 E 占位值。旧档按原容量确定性迁移，耗尽/剩余次数保持，不调用构造或 RNG。
- 改前9文件142例全绿；208层 staff22→26、wand17→16，仅记录漂移。seed20260923护符2→0已调查：回退初始抽签/赋值的探针完整复现改前208层记录，池/频率未变。
- B-1a 固定?/2改为显式E=2夹具；C-5增量20505→11935，经生成11932+落位/伤害3及反事实验证，机制断言保留。新测试误以为机器支持法器配发，已纠正；现有spawnBlueprintItem不支持STAFF/WAND，登记缺口，不擅自接线。
- Playwright技能客户端和真实页面确认E3满电→施放后E3/剩余2→JSON存读档不变；截图已检查，无控制台/页面错误。canvas导出黑图不冒充视觉通过，使用整页背包截图。
- 最终生产范围：Item.ts、ItemLoader.ts、Game.ts、ArcanaInstance.ts；观测测试显式含c_4b/g_2/c_5。最终反查、重捕获、逐文件复跑及SHA-256证据见 ai_docs/reports/w-5.report.md。
- 后续：W-6回电/充能生命周期；W-8+效果公式；W-24+目录/empowerment频率。既有机器法器配发缺口需在相应配发/目录轮显式处理，本轮未新增可生成法器来源。
- 广域首轮105文件发现5条W-3/W-4夹具失败：生成骰被混计到施法零RNG/吃掉预设反射骰。新增prepareZap在观测/安装骰桩之前完成真实spawn，所有原expect保留；同类未红的重试夹具也修正观测边界。未改反射/轨迹生产逻辑。
- 最终完成：基线最后重捕获91/104层、339字段；build、显式111文件回归及独立drift均退出0，共1629 passed、8 skipped、5 todo。206个源码/测试/配置文件前后SHA-256清单哈希均为c342b26976281c0d3afdc877050cf6751236791558b185631ff5d5b2316dbf46；最终运行期间无文件变化。

## 2026-09-23 W-6：充能生命周期

- 当前请求：严格执行 w-6.prompt / W-0 §2.3；沿 W-5 独立 E/容量/次数接 P2 客观回电，不改初始值/生成流，不重采基线。
- 已读 CE Time.c:2025-2075、Items.c:338/4720/7904/1901/8714 与 PowerTables.c:72；新增普通杖倒计时和精确智慧定点表。WAND 不回电，卷轴全包 STAFF/CHARM；护符继续现有 cooldownRemaining 模型。
- 新增覆盖客观时间、RNG、满电/溢出、智慧双槽、存档/旧档与未知态的测试。首轮两条旧测试冲突仅为 WAND 载体与私有方法改名，按 CE 翻正，中文/免费入口禁用断言保留。
- 新测试发现 P2 半块时间未存档会丢掉加速后的 50 tick 进度，已加入可选快照字段与旧档 100 tick 兜底。新增测试自身的高智慧手算、护符 id/API 名与日志顺序错误已修正。
- 本轮补正详情固定周期文案、智慧/卷轴描述；不更改 JSON 初始次数/周期/频率。blink/obstruction 只留 kind 参数扩展口，未启用慢周期。
- 实际浏览器验证：四次 haste 等待=200 tick，STAFF 1→2，读卷轴后3/3、WAND仍0、CHARM冷却归零，JSON存读档一致；整页截图已检查，零console/page error。两条新日志的斜杠HTML转义已修复。
- 最终冻结7个生产文件（含新 helper），测试3文件，反查/浏览器/门禁脚本3文件。开始最终build、显式R+S回归及独立test:drift，前后SHA-256覆盖src/所有scripts/配置与锁文件；结果回填w-6.report.md。
- 后续：W-7附魔入口与进度调整；W-12/W-14特殊周期；护符完整模型与戒指附魔次数不在本轮。旧档计时确定性500，不将旧递增counter冒充CE倒计时。
- 最终完成：build退出0；显式112文件1656 passed、8 skipped、5 todo；独立drift1例通过，合计113文件1657 passed。生成基线未重捕获、SHA-256保持1549a4c5aae041ff5c4a7653ea22d07af88aecaf3740861b0cdb90a4656d5820。211文件前后清单哈希均为a9c6e3bfc612e7bb22a6e15ae2e3895a27c5db6cab03935424e01102b5b76677；逐文件结果与完整证据见ai_docs/reports/w-6.report.md。

## 2026-09-23 W-7：附魔法器入口

- 当前请求：严格执行 w-7.prompt / W-0 §2.3，核实 W-5 E/容量/次数与 W-6 回电交接，不改生成流、装备附魔随机路径或效果公式。
- CE Items.c:7860-7867：STAFF E+1、当前+1、独立倒计时=floor(500/new E)，容量同步新 E；WAND 只加 range.lowerBound，原 maxCharges 非上限。
- CE Items.c:7817 驳回旧 B-1a/W-6 注释的“enchanting 永不自亮”：卷轴先自亮，再强制选择；关闭/Esc 不取消已读卷轴。时间延后到选定之后，待选状态随快照往返。
- 新增纯资源 helper、背包原引用选择与 Vue toRaw 接线，保留原装备 helper 逐字不变；R+S 增补 UI/enchant/存读档检索。
- 新增30例已通过，包含旧2700倒计时的归一化反事实、新E随机区间、满电暂停、真实P2半块、WAND越过原次数、未知态、拒绝失效引用、待选/完成JSON存档、装备分支完整RNG对象对照。
- 初测修复测试自用导入路径/私有桥接类型；i18n门禁指出本地t别名不可被扫描，提示改用脚本内i18next.t的实际消费，不放宽扫描断言。CE行号以本轮原文件重新编号校正。
- 有头浏览器完成读前关闭/读后强制选择、非法点击、背包重排、STAFF/WAND、待选和完成存读档；截图已打开复核，零页面/控制台错误。技能客户端黑canvas截图不冒充视觉通过。
- 最终实际7生产文件：Game、Item、ArcanaEnchantment、InventoryOverlay、GameCanvas调试文本、consumables卷轴说明、zh_CN。R101 + S(U41/Q15/G63/enchant32/storage54/observation106)，并集115；114显式回归文件+独立drift。
- 代码/测试/脚本编辑完成，开始最终build、R+S、test:drift；生成基线不重捕获，完整src/scripts/config SHA-256前后自证，结果回填w-7.report.md。
- 后续边界：W-8~23效果读取E仍未改；W-12/14特殊周期；W-24~26目录/频率。退池自创WAND无CE range，不为它们杜撰附魔量；装备规则仍为原武器优先/护甲兜底含20%送符文。
- 最终完成：build、114显式文件回归、独立drift均退出0；合计115文件1694 passed、8 skipped、5 todo、0 failed。216文件前后SHA-256清单均为c0d3a18b3f026802c15f0094b35a31d0dd965c71439f35d3898ff64ffef82af8；生成基线未重捕获。逐文件结果见ai_docs/reports/w-7.report.md。

## 2026-09-23 W-8：伤害杖公式

- 当前请求：严格执行 w-8.prompt / W-0 §2.3；仅 CE FIRE/LIGHTNING STAFF 公式，怪物 BE_DAMAGE/BE_ATTACK、生成流、次数模型不改。
- 新增 StaffDamage helper：E2=3..9/1骰，E3=3..11/2骰，E8=7..24/3骰，复用 CE randClumpedRange；每个可伤害接触独立掷骰，免疫/空射/预览不掷伤害骰。由 resolveCEBoltMagnitude 读取实例 E。
- 火免/无敌在伤害骰前；存活火击复用 F-2 点燃原语，随后分裂。CE Items.c:5210 的反射守卫承重：玩家反射后仍伤害/点燃但不分裂，W-4 旧旁射果冻断言留痕翻正。
- P4-3 保留 magnitude=20 干扰值，显式 E8/charges1，独立三骰期望与真实回程验证；飘字 ID 的既有额外 substantive 骰经栈取证，测试隔离表现耗骰，不改生产 RNG。
- 初轮7条旧断言撞红；W-3/W-4 的固定6/10伤害改为明确 E2+受控伤害骰，保留几何/承伤者/顺序断言，另修未稳定撞红的烧门固定伤害。新增33例，含两种杖×三档各6000次真实施法分布、穷举离散权重、火免/无敌/物理免疫/反射/分裂/次数和怪物边界。
- 浏览器技能客户端与五个有头专项场景已执行、截图已打开复核：E2火6伤，E3闪电9/6伤，E8反射19伤、火免零伤、直接果冻19伤后241/241；次数1→0、E不变，零页面/控制台错误。修正本轮两条伤害日志的斜杠转义；验收脚本避开HMR的第二个Game单例。
- 六个临时错误版本均被新测试拦截：常数伤害17红、读次数15红、均匀代替clump9红、无火免3红、无命中点燃6红、反射后分裂2红；已逐字恢复。
- R(实际 Game/Bolt/StaffDamage)+S(B,C,效果/源码读取)共107文件：102反向闭包，补入5个静态读取/公式文件。开始最终 build、显式106文件回归、独立drift；前后SHA-256覆盖src/public/scripts/配置，无基线重捕获。
- 后续：怪物伤害公式另案；其它杖公式 W-9+。既有 trySplitMonster 只复制HP/阵营等字段，未像 CE cloneMonster 复制全部状态；此次接通的是命中原体点燃及分裂调用资格，不声称整个克隆模型已对齐，详见 w-8.report.md 的缺口登记。

- 最终完成：build、显式106文件回归、独立drift均退出0，107文件合计1565 passed、8 skipped、5 todo、0 failed；223个运行输入前后SHA-256清单均为4bd8a229acd7f7b318f3b345a982ca4a9a8fee584a5dcac35d98723414ccfdc5。基线未重捕获；逐文件最终结果和CE依据见ai_docs/reports/w-8.report.md。

## 2026-09-23 W-9：基础定向状态

- 当前请求：严格执行 w-9.prompt / W-0 §2.3，收掉 heal/haste 自施、miss 自隐形、discord confused 三项旧行为；不改生成流、不入池。
- 核实 CE Items.c:4636-4706/4941-4957/5242-5273/5366-5404、PowerTables.c:53/55：slow=5E、haste=2+4E、heal=floor(maxHP*10E/100)、invis=15E、discord=max(old,4E)。前3种持续状态覆盖；速度互斥并清 web haste 别名，治疗不是 panacea。
- 新增 Game.applyBasicBoltEffect，消费 W-4 实际 hits；玩家与怪物四个既有基础效果共用。怪物 healing 25%四舍五入→50%向下取整、haste15→10、discord30→40，SLOW_2仍10；资格/覆盖同步CE，实际玩家接触可受discord。Monster AI选择和其它效果分支不改。
- 通用 applyStatusToMonster/applyTimedStatus、Creature/Monster、卷轴 discord/negation 入口保持逐字不变；CE定向状态不继承web自创statusImmunities/statusResistTurns，现有数据无对应五状态抗性项，卷轴原抗性路径保留。
- 新增77例：目标/空射/墙/原点/反射/随机旁射、E2/3/8、百分比取整、互斥、资格、autoID、怪物共享与真实P2时间。W-2旧自施用例留痕翻正；W-4六例旧时长/discord/资格登记按CE翻正，原命中几何断言保留。
- 开发首轮分支文本合并误删无关case，定向测试/翻译门发现，已恢复；最终脚本新增非W-9玩家/怪物case逐字对照守卫。新用例误把无discord构造返回null写成undefined，已更正；无skip/todo新增。
- 技能Playwright客户端完成实际游戏移动；canvas导出仍黑图，不充当视觉验收。11个有头专项场景全部通过、无页面/控制台错误，整页截图已打开复核；测试场景换图时同步重绑FOV/LightMap。
- 开始最终冻结并复跑 build、显式R+S回归与独立test:drift；实际4生产文件（Game/Bolt注释/两翻译资源），R104 + S(B,C,Q,M/状态/读取)并集109文件。逐文件结果、SHA-256及撞红处置回填 w-9.report.md。
- 后续边界：discord物品与频率留W-26；毒/护盾/其它效果仍按原轮安排，怪物BE_DAMAGE仍是既有公式。生成基线不重捕获。

- 拟最终运行前的复核发现W-4反射预算末尾实际接触无生命石像卫士，原“命中必减速”断言不符CE；保留全部轨迹/预算断言，增加精确命中者与拒绝减速/仍autoID断言。中断未完成的广域/拟最终运行，修后重新冻结完整复跑，未采用中断统计。

- 完整回归发现W-1 BoltContract另有1例明确锁旧怪物治疗25%（35HP），按CE目录E5→50%改为60HP，施法者/命中者/位置/autoID断言全保留。该轮build/drift通过但回归1红，不计作最终绿；保存prefinal-failure.json。定向复核后重新冻结，用8 workers（本机10核/32GiB）执行同一109文件完整门禁。

## 2026-09-23 W-10：毒状态闭环

- 当前请求：严格执行 w-10.prompt；CE addPoison 时长/浓度相加，staffPoison 固定点表；P2 客观块结算，保留 G-3。
- 独立 addPoison 生命周期，不复用 W-9 applyBasicBoltEffect。物理 MA_POISONS 在 Combat.attack 共用入口结算，BE_DAMAGE 既有简化保留；最终报告逐项申报。
- 新增38例已通过；W-4旧毒反射12回合按E2=5原位翻正，几何/对象/autoID断言保留。W-2/W-9、P2/P4、hunger_regen/G-3与翻译/符文定向检查已跑，未改旧断言期望。
- CE caustic gas 在 Time.c:592-597 走 T_CAUSES_DAMAGE 直接伤害，非 addPoison；任务书“吸毒气得毒状态”对本仓库 CE 不成立。G-3气体体积/扩散/消散及生物效果正文保持不变。
- 实际扩展申报：Combat.attack物理 MA_POISONS 从全额接触+2damage时长改为1接触+原伤害时长、+1浓度；删除重复调用并覆盖怪物互殴/几何/BE_ATTACK；BE_DAMAGE旧公式和其旧on-hit保留。venom不再瞬时重复毒伤；怪物再生移到客观状态块，中毒暂停；死亡清扫抽取并在收尾补扫，毒杀复用既有随机掉落。
- 存档保存浓度、玩家再生余数、怪物再生进度；旧毒倒计时兜底1剂，无毒清0。分裂仅补独立毒字段复制；完整克隆仍留后续轮。render_game_to_text增加毒浓度以便核对。
- 浏览器8个状态检查通过，含真实Enter施法、叠毒、E8反射、免疫/空射、死亡移除、两个50tick动作；零页面/控制台错误，7张整页截图已打开。HMR曾造成动态导入的Monster类与游戏类不一致，重启Vite后全过；无生产逻辑迁就。技能客户端无头/有头canvas均黑图，已检视，不作为视觉通过。
- 最终冻结：9个生产文件的R105，S补8文件，R∪S113。即将执行build、112显式文件回归、独立drift；脚本保存逐文件结果及SHA-256前后清单，不重捕获基线。此后仅回填w-10.report.md与evidence。
- 后续边界：怪物BE_DAMAGE简化、完整克隆与消魔、缺失毒地衣入口/CE maxStatus展示不在本轮；poisonAmount为护盾后续轮提供独立毒伤路径。最终验证结果见本轮报告。

## 2026-09-23 W-12：blink 与反向 beckoning

- 当前请求：严格执行 w-12.prompt / W-0 W-12 行；核实 CE 线索，第一次复用 W-11 placeCreature，不入池、不改生成流，怪物自主 blink 继续排除。
- CE 核实：blink=2+2E；beckoning 确实再次 zap BLINKING，E=max(1,trunc((切比雪夫距离-2)/2))；按 beckoner→target 的调优线截断倒序，不是从 target 重新向 beckoner 取线。贴脸 blink 先拒绝，普通 HALTS_BEFORE 的第一格例外仍保留。
- Game 玩家 blink 读取实例 E；双方 BECKONING 共用反向 traceBolt + finishBlink→placeCreature。近邻/IMMOBILE 门先于释放和等待；等待至少 player.attackSpeed+1；可见的合格目标拉不动也可 autoID。怪物 mirrored_totem 的行为迁移明列于报告，Monster.ts/tryUseBolt 未改。
- canPlaceCreature 未改；placeCreature 新增可选 pickupBeforeVision，默认保留 teleport 先视野后拾取，blink 先拾取后视野。这是 W-11 通用性判断遗漏的 CE 时序维度，已如实更正。落点环境/嵌套陷阱直接复用。复核发现 W-11 的拾取测试漏金币：在共享 pickUpItemAfterDisplacement 修正满包可收、金币不占槽；不另写安置逻辑。
- W-12 新增50例，W-11 37例定向通过；W-3 一条明确的 blink 无移动留形按 CE 翻正，其余几何和地形断言保留。新测试夹具错误（地形名、抓取字段、斜线样本、null/undefined、玩家岩浆 gameOver 而非 hp 清零）已纠正，没有放宽生产守卫。
- 七个独立负变异（常数距离/读charges/反向重瞄/删近邻门/拾取时序/删等待/金币占包）分别被2/3/1/3/1/7/2条新断言拦截，源码逐字恢复。浏览器验收包含显式 blink E2/E8、晶墙前停、落点陷阱、键盘 beckoning 斜线/贴身、怪物拉玩家拾物、满包收金币；状态和整页截图逐项检查。技能客户端黑canvas不充当视觉通过。
- 最终冻结后执行 build、R(实际 Game/BoltTrajectory)+S(B,M,D,C/位移/读取)的115个显式回归文件及独立 test:drift；不重捕获基线，前后SHA-256和逐文件结果由 scripts/w12-final-check.mjs 保存，最终结果见 ai_docs/reports/w-12.report.md。
- 后续：blinking staff 的身份、入池、瞄准/特殊回电仍属W-25；怪物自主blink、潜伏占位与气味等缺失子系统未启用；一般背包合并/amulet守卫与普通主动拾取路径未在此轮重写。W-13 tunneling 仍待后续。

- 首次拟最终完整回归仅 W-2 的旧 beckoning 两格落点断言失败：x8→x6 翻正为 CE 邻近 x5；autoID/隐形/casterMovement 原断言保持。反查清单已包含该文件，人工预审漏掉该旧断言，属于本轮检查疏漏。build/drift 已通过但不当作最终全绿；完整失败证据保留于 w-12-evidence/prefinal-failure，修后重新冻结并完整复跑。


## 2026-09-23 W-13 掘地效果
- 按 tasks/w-13.prompt.md 与 W-0 行执行；CE Items.c 4146/4362/5557/5662/5805/7355 核实，预算=E，每主路径成功开通格减1，起点/对角修补免费。
- Map/Promotion.tunnelize 承担逐层写入、边界晶墙、DF_TUNNELIZE、对角连通修补；Game 只调用语义入口与生物/缓存回调。
- 修正旧缺口：BlueprintEngine 私有 IMPREGNABLE 集合改由 Grid 持有，原置位与回滚流程不变；随层缓存及新存档保留。旧档缺数据无法反推，默认空集合。碎墙卷轴正文未动。
- develop-web-game 技能浏览器验证；最终反查、逐文件复跑和 SHA-256 证据见 w-13.report.md。
- 定向验收：42 项 W-13 守卫；W-3/W-4/c_4a_0 原普通轨迹与写层白名单已验证。炮塔复合 MONST_TURRET 未展开，掘地入口按 CE 复合位识别，不改 Monster 全局。
- 浏览器：6 个真实页面状态场景并实际走入新通道。技能客户端无头/有头 canvas 导出均黑图；整页截图可见。WALL/RUBBLE/CRYSTAL_WALL 在 Appearance.ts 仍用空白默认外观（R-1 守卫），并存在 W-12 已登记的动画末帧残留，不能宣称专属地形视觉完整；不在本轮更改渲染守卫。最终夹具改用有字形的 GRANITE 观察开通轮廓。
- 最终门禁采用显式闭包文件、2 workers；build/drift 独立串行；不改超时上限与生成基线。完成详情以 w-13.report.md 和 evidence 最终运行数据为准。
- 后续：W-25 加 tunneling 物品身份/入池；既有地形外观/末帧刷新另轮处理；历史存档无 IMPREGNABLE 信息无法恢复，新增存档已保留。
- 收尾审计发现并关闭 P4-10 原语缺口：setUpWaypoints 无条件隔离 RNG 只适合进层；CE Items.c:5558 运行期掘地没有该隔离。新增 duringPlay 默认false参数，掘地传true，生成/重访/读档默认保持原随机流。增加运行期洗牌消耗与默认隔离对照守卫。此前复跑以130主动中断，原日志/哈希保存至 prefinal-waypoint-gap，不计作最终结果；修改后重新完整冻结复跑。
- RNG入口修正后43项W-13与7项P4-10定向测试通过。最终重新运行仍是119文件闭包（118显式回归+独立drift），采用4 workers；如有超时保持原上限并整文件串行复跑。所有早于本次冻结的结果均不拼接进最终统计。

## 2026-09-23 W-14 阻障效果
- 按 w-14.prompt/W-0 执行；CE Items.c:5486-5493 的 detonateBolt 动态复制 DF_FORCEFIELD，pathDF/targetDF 仍为 null。DF 原行 id51、SURFACE、100/50、flags0，未加入生成表/蓝图/物品池。
- Promotion.spawnObstruction 使用 CE 固定点表计算概率衰减（E2/3/8=47/38/12），允许封路。IMPREGNABLE 不参与铺设判断；T_OBSTRUCTS_SURFACE_EFFECTS 决定扩散/铺设。生物所在落格即时 FORCEFIELD→MELT→NOTHING，包括飞行者。
- 发现 C-4b refreshCell 不入 web DF 签名的既有缺口，本轮仅在新力场语义入口补占位消融；没有把生成/卷轴共用 DF 改成全局即时效果。Grid 的旧启发式把力场当可走，在铺设与 promoteTile 力场消融时局部同步缓存；不改 Grid 的全局规则。
- 阻障不照搬 W-13 的 waypoint 重建：CE detonateBolt 只有掘地调用 setUpWaypoints。保留滚动刷新，清自动路径并更新 loop/safety/vision，不引入额外洗牌 RNG。
- c_4b 目录两条旧计数/闭包断言按新增原行翻正 134→135、登记阻障起点，保持精确集合相等与所有扫描守卫。W-14 24 项与 c_4b/c_4c 共76项定向通过；初版新测试中的 null/undefined、FOV夹具/私有字段访问已纠正。
- 最终反查 R=118、S并集119文件；将执行118个显式回归文件、build、独立test:drift；不改timeout、不重采基线，SHA-256冻结见w-14-evidence。浏览器与反向变异结果、逐文件最终门禁回填w-14.report.md。
- 后续：staff_of_obstruction 身份、frequency和特殊回电留 W-26；通用 DF refreshCell 的其他即时环境效果仍是既有缺口；碎墙卷轴旧 IMPREGNABLE 注释/检查及力场专属外观另轮处理，不在本轮夹带。
- 浏览器5场景（封路、消融后键盘走入、E8、受保护地板、占位消融）状态断言通过、页面/控制台错误0。整页截图已检查：力场沿用现有空白默认外观，范围可由地板缺口辨认，不能宣称绿色水晶专属视觉已实现。既有渲染守卫不改。
- 四个负变异分别触发1/3/1/4项失败；还原前后Promotion SHA-256一致。源码、测试、脚本与progress已冻结，接下来只补本轮报告和运行证据；最终结果不使用中途快照。


## 2026-09-23 W-15 护盾吸伤闭环
- 按 tasks/w-15.prompt.md/W-0 W-15 行核实 CE。10 个直接 hp-=（Game7、Player2、Creature1）全部盘点，另含 takeDamage 调用、hp赋值、die/gameOver。
- 关键分类：爆炸/坠落/普通攻击/伤害杖吸盾；燃烧/毒状态/毒气蒸汽/饥饿/互惠旁伤/报复/直接死亡绕盾。保留环境与W-10死亡所有权。
- staffProtection 使用 CE 16位定点 fp_pow（E3=181），shielded 存十分之一HP，maxShield 单独保存；弱施法仍重设max，max/20整除衰减。旧档无maxShield清除原倒计时盾，telepathy不猜来源。
- 怪物E5护盾接吸伤；玩家真实命中者获得护盾，移除telepathy错配；分裂复制盾两字段；所有快照出口补保存。
- Combat吸血取穿盾后伤害。既有护甲符文调用迁移到扣血前，防止吸盾后的凭空回血，公开事后API兼容旧直接调用。怪物伤害bolt公式/生成池保持。
- 使用develop-web-game技能；本worktree缺依赖，复制主工作区已有node_modules；不改锁文件。最终验收与完整逐点表见待写w-15.report.md。
- 定向57项通过（含新增测试房快照往返）。初版4项新测试的全局randRange mock误改伤害骰，已修夹具；旧W-10/armor/P4-1b无断言改动。
- 浏览器7场景：E5怪物护盾、吸伤、等待衰减、毒伤绕盾、选靶、Esc取消/Enter确认旧light映射护盾、破盾；页面/控制台错误0。整页截图已目视验证盾量HP标签、HP数值与无telepathy状态。技能客户端canvas导出黑图已按要求有头重试，采用整页截图补证。
- 四个反向变异爆炸绕盾/毒伤吸盾/max不重设/残盾向下取整分别打红1/4/1/2项，还原SHA一致。
- 最终反查R110，S并集120文件（119显式回归+独立drift）。源码/测试/脚本/progress冻结后执行build、定向闭包、test:drift，前后SHA自证，不改超时、不重采基线。后续仅回填报告与证据。
- 后续边界：protection身份/入池留W-26，完整消魔留W-23；怪物伤害bolt公式、现有自创符文/退池creeping_death、旧light文案与完整克隆其余字段未扩展；护符仍是原随机抗性，其CE护盾接入不在本轮SHIELDING范围。
- 首次完整拟最终门禁：build/drift通过；117/119回归文件通过，3失败来自P1-30未引用staff.bright_aura键与W-4两个精确attack参数守卫。归档旧亮光键到zh_CN.legacy；怪物bolt只为有实际受击符文的护甲挂preDamage回调（reflection已在轨迹执行，无受击减伤），保留W-4原参数守卫不改。两locale文件补进R；保留旧失败及SHA于prefinal-failure，重新完整冻结复跑。

## 2026-09-23 W-16 召唤刀刃
- 本轮请求：严格执行 tasks/w-16.prompt.md，以W-0 W-16行为为准，实体级验证召唤与autoID，核实CE线索。使用develop-web-game技能。
- CE核实：floor(3E/2)，落点最短路径合格格；绑定玩家但不跟随玩家，主动追敌/30%闲逛；首行动attackSpeed+1；无寿命倒计时，寿命线索驳回。楼梯不跟随，原层缓存保留；消魔是真死亡。
- 专用Conjuration helper不共用P4-2召唤/P4-4分裂，不改生成和目录。玩家召唤后才autoID；新增快照tag仅恢复刀刃，缺tag不猜盟友来源。
- 工作树依赖从本地主工作树复制，不改package/lock。初次build发现Game私有machineCells不满足宽PlacementWorld签名，收窄到实际所需字段。
- 定向5文件121项通过；后增玩家相邻优先目标测试。新夹具的地形枚举/API和睡眠偷袭预期修正，未改旧伤害规则。新增刀刃回击/消魔选敌门仅作用于本轮绑定玩家的刀刃；明列普通怪物行为变化。
- 浏览器七场景通过、错误0，实际打开整页召唤/攻击截图；技能客户端canvas黑图保留证据，不算视觉通过。
- CE复核：generateMonster(true,false)的true是itemPossible，false是mutationPossible；刀刃没有携物旗标，所以无原生掉落。没有寿命，更没有到期删除入口；200次状态递减仍活，死亡只在真实伤害/消魔发生。
- 已有全局GameSnapshot只存当前层、不存levels缓存：本轮已完成内存跨层留层和当前层/休眠/测试房刀刃快照；不声称跨层全局存档已CE对齐，报告明确登记。
- 初步完整闭包在补最后测试/注释后主动终止（exit130，非超时/测试失败）；不计最终门禁。冻结所有生产/测试/脚本/progress后重新完整跑118文件闭包、build、drift；保留初步日志。4个反向变异用于验证实体/首等待/不跟随/autoID断言，finally还原SHA。
- 后续：W-23完整消魔资格/能力剥离，W-20通用克隆/关系快照；整个levels跨层JSON持久化为既有存档架构缺口，不能由刀刃跟随假象掩盖。最终门禁后仅回填报告及证据。


## 2026-09-23 W-17 支配
- 本轮按 tasks/w-17.prompt.md/W-0 W-17行为执行，使用develop-web-game技能。CE公式严格低于20%必成，恰20%=80%，满血0%，整数截断；编译CE原函数取黄金值。
- DOMINATION成功后清W-9 discordant、becomeAllyWith转队/释俘/清seized/掉携物/重组leader；失败不写目标。可见失败也autoID。无物品身份入池。
- W-11 freeCaptive转队原语抽出共用；补绑定随从载体/两遍leader处理，休眠不选首领；生成仅记录horde已有旗标，无新增抽签。新增当前层关系快照与支配实际形态保存，旧档缺字段不猜盟友。
- 待办：边界/失败全状态/反射/关系/存档测试，浏览器实测，R+S最终门禁与报告。
- 定向40项支配测试通过；与W-11/P4-2/P4-5/V-2b-5首批回归129项通过，后补随机反射/自然分裂/实际测试房reset，既有测试未改。初版新夹具拼错spawnKey/cancelArcanaSelection API、缺scent，以及错误地给pendingArcana注入bolt，均纠正为真实方法和只替换测试配置。
- 浏览器九场景通过、控制台/页面错误0。技能客户端无头/有头canvas仍黑，实际打开确认，整页截图可见盟友g移动并露出k、读档保留。战斗夹具最初的goblin麻痹onHit让目标不能回击，关闭夹具额外onHit后通过；未改生产状态/战斗规则。既有穿刺盟友日志有{{ally}}占位未替换，登记为旧P4-6文案缺口。
- 生产6文件：Game/Monster/Domination/BoltTargeting/GameCanvas/zh_CN。仅horde绑定元数据和分裂继承关系触及生成/召唤/分裂方法，不增RNG、不改池/权重。P4-2 carriedMonster寄宿/复活仍是前轮未建模缺口，本轮没有创造复活系统；全levels缓存的JSON持久化也仍属原存档边界。
- R=110、S并集120文件；最终将冻结源码/测试/scripts/progress，依次build、119显式回归、drift；哈希、逐文件结果与5个反向变异证据见w-17.report.md及evidence。后续仅回填报告/运行证据。
- 后续：domination身份和入池留W-24；完整群体死亡继任、carriedMonster生命周期与整层缓存存档仍需各自后续轮次，不以本轮已覆盖的支配转队链冒充全部怪物系统CE对齐。
- 首次拟最终门禁build通过，回归运行中主动中断exit130：收尾复核发现CE跨层首领选举按层号，Map插入顺序不等价。修正becomeAllyWith缓存层排序，补无当前层候选/逆序Map测试，重新全量冻结复跑；此前日志归档prefinal-depth-order，不计最终结果。
- 第二次拟最终build通过，回归中主动中断exit130：Game.generateDepth重访后保留当前层缓存数组，removeDead/enterSummons重赋值后副本可过时。demotion只读当前活动真值、跳过当前层缓存和hp<=0候选，补实际旧数组夹具（第42项），再冻结完整复跑。归档prefinal-stale-cache；仍不拼接中途结果。
- 第三次完整冻结门禁build/drift通过，回归118/119文件通过，唯一断言失败是W-16 tagless旧档守卫：新allegiance与spectralBlade形成双重盟友来源。修代码让刀刃继续只用W-16单一tag，并在该tag扩展leaderId/boundToLeader；原128测试仍不改。新增horde刀刃关系往返/缺tag兜底测试（第43项）。此前报告保存到prefinal-blade-tag。
- 同次脚本错误把堆栈runWithTimeout匹配成timeout，额外串行复跑仍是同一断言失败（不是超时）。收窄识别到实际Test/Hook timed out错误消息，不改测试超时上限。修后重新完整冻结运行，不拼接旧绿文件。
- W-16/W-17修后89项定向通过，5个反向变异重新打红并恢复SHA。最终并行度按本机Node实测10CPU/32GiB调为8 workers（只改复跑脚本命令，不改任何测试timeout/期望），build/drift仍独立串行；重新完整跑同120文件闭包。


## 2026-09-23 W-18 催眠动作链
- 用户要求严格执行 w-18.prompt/W-0 W-18 行，所有 CE 线索逐条读执行路径；动作级验收，禁止改生成池/频率/重采 drift。使用 develop-web-game 技能。
- CE 关键事实：Movement714方向取反、移动/方向攻击/挣扎触发，wait/UI/拒绝动作不触发；Time2727跳过自主行动；PowerTables56=3E覆盖；Items5342玩家中弹改confused，怪物中弹wakeUp并透露位置；Combat1183/Items6790近战和投掷miss也解除，伤害射线依moralAttack且玩家反射分支例外。
- W-9共享效果入口扩入ENTRANCEMENT；W-11安置扩可选走密门策略，C-5幸存者清催眠/抓取；生成路径不改。web旧蛛网无STUCK计数，以当前缠绕地形提供受控移动阻断，恢复自主后的蛛网沿用旧机制。
- 待办：动作/P2/地形/保存/反射测试、浏览器验收、R+S闭包与SHA最终复跑、报告。
- 动作验收首批61项通过；补自动寻路旁路与living immobile执行路径后共63项。已有4文件151项同时通过，未修改任何既有测试断言。首批新增夹具的反射RNG、DISCOVERED、毒气陷阱保留本体、C5回合顶部坠落预期已按执行代码纠正；敌对受控怪仍可攻击玩家/盟友，不把催眠当转队。
- 浏览器11场景通过、console/page错误0；已实际打开整页截图核实反向位置、HP99反击、反射混乱、读档后跟随。技能客户端无头/有头canvas导出仍黑图，整页可见，沿用已登记限制；不以黑图声明视觉通过。浏览器强制命中夹具曾未还原randPercent导致下次staff构造尾部循环不退出，中断后修复并完整重跑。
- 五个反向变异错误方向/等待跟随/miss不解除/漏落格环境/常数时长分别打红8/1/1/2/2项，finally还原前后SHA一致。
- 初版构建与Vitest在沙箱内报SecItemCopyMatching -50并崩溃；同命令沙箱外构建通过。后续门禁按已获自动审批的同方式运行，不改测试超时、依赖锁和环境基线。
- R(10个实际生产文件)=113，S(C,M,U,B/动作保存/文件读取)并集123文件；122个显式回归+独立drift。冻结全部源码/测试/scripts/progress后按w18-final-check执行build/回归/drift，逐文件结果及SHA见报告。后续只回填报告与证据。
- 后续边界：entrancement杖身份/频率/入池仍W-25；通用怪物伤害bolt公式、完整negation/学习、STUCK计数与nausea/潜水记账、完整AI状态机和跨层levels的JSON持久化为既有独立缺口。本轮受控移动在现有缠绕地形上停住；没有声称重建全部蛛网系统。
- 首次拟最终build发现新增测试2处直接访问private needsRender（TS2341）；运行时63项已通过但不冒充build通过。回归主动中断exit130，日志/SHA归档prefinal-types，修测试访问方式后完整复跑。另补CE Combat1173水生近战拒绝悬浮目标早于解除的真实门，以及Items5210玩家反射火击中旁观者不走moralAttack的用例。共65项；物理攻击拒绝门明列为共用Combat行为变化。
- 再次收尾发现W-17实际形态保存仅覆盖dominated/刀刃，普通被催眠鳗鱼读档会丢RESTRICTED_TO_LIQUID、豺狼会丢50 tick速度。build已过但回归主动中断exit130（prefinal-save-form），复用W-17形态字段抽出snapshotForm，催眠tag在受控期间保存真实旗标/速度。补两种生物读档后的动作断言，共67项；此为前轮存档原语范围缺口，未扩改全体旧档或生成。
- 最终保存修复后vue-tsc通过，W18(67)+W17(43)共110项定向通过。浏览器冷启动后11场景完整通过；热更新服务器上的一次重跑命中0≠23（日志另存），没有据此改生产逻辑。最终只使用冷启动完整场景结果；随后重新负变异还原与冻结全闭包。


## 2026-09-23 W-19 变形
- 按用户要求严格执行 w-19.prompt/W-0 W-19 行，使用 develop-web-game 技能。生成表/种类/频率与分裂保持不动。
- CE实码纠正：普通unAlly只清自身leader，不另选首领；只有captive变形调用demote。先按旧haste/slow计算速度，再initializeStatus清全部状态；新隐身状态决定autoID，无FOV门。
- 原地替换物种info，拒绝抽样沿现有67项CE投影；保留实体id/位置/携物/非例外关系，清mutation/carriedMonster/能力状态，HP按千分比及原伤量取优。
- 待办：编译CE黄金值、逐字段与死亡/保存测试、浏览器实测、R+S最终冻结门禁及报告；W8整体克隆缺口只登记修法，留W20。
- 67行CE物种投影逐项核实，20个输出排除项；编译未改写的polymorph/unAlly/initializeStatus，16256组HP/旧haste+slow黄金值匹配。新测试52项通过；前批W17/W18/P1-28/P4-3/4/5共231项通过（新增等待测试后由最终闭包再覆盖）。
- 唯一初稿测试红灯为confirmArcanaSelection夹具拼错，应为confirmArcanaTarget；build也检出测试房baseline漏声明polymorph类型。修正夹具/类型，无既有断言改动。
- 浏览器8场景通过，console/page错误0，已检查全部整页截图；技能客户端无头/有头canvas导出仍黑，明确不计作视觉通过。Chromium沙箱启动被OS拒绝，经自动审批允许本机验证后通过。
- 7个负变异（纯比例血量、所有盟友降级首领、忽略旧haste、更换实体id、保留旧状态、autoID误用可见性、丢形态存档）各打红1/1/3/1/9/2/2项；finally还原文件、前后SHA一致。
- 最终R=113，S并集121文件；120显式回归+独立drift。全部生产/测试/scripts/progress冻结后运行w19-final-check；后续只写报告/证据，最终逐文件及SHA见w-19.report.md。
- 后续W20：从现有实体完整复制并独立复制可变容器，再按CE克隆例外覆盖；本轮trySplitMonster未改。W24仍负责魔杖身份/入池。完整carriedMonster寄宿复活、通用死亡后群体继任、全levels缓存JSON保存、未建模的creatureMode/学习计数仍属既有边界；本轮不虚构这些系统已完成。
- 首次拟最终build通过，闭包中主动中断exit130（非超时）：审查发现普通怪物在首次变形前读档会因缺typeId/旗标而把中文名当物种，既可能抽回原形也可能漏免疫门。保存全部怪物现有snapshotForm，旧档只按完整英文/当前本地化物种名确定性匹配原目录（不按字形/深度猜）；无法识别的旧实体保留旧数据并拒绝变形，零抽签/零写入。历史已丢失的突变旗标无法无损推回。新旧读档行为变化在报告显列；全套重新冻结，不复用本次中途结果。
- 保存源身份修复后W16/17/18/19共213项通过；新增用例确认原盟友变形后等待101tick，再走真实Combat入口攻击玩家。W19最终57项通过，冷启动浏览器8场景再通过。负变异已在修复源码上重跑并恢复；接下来第二次完整冻结build/120回归文件/drift，仍不拼接中途结果。
- 目视发现并登记：Appearance.monsterAppearance在可见格直接绘制字形，phantom隐形形态仍显示p；状态/目标资格/autoID正确，不宣称隐形视觉通过。此为已有通用外观/文本输出缺口，详见W19报告§10，未改UI实现。
- 第二次冻结完整运行：build/drift绿，回归119/120文件通过、1失败，合计2200passed/8skipped/5todo/1failed；前后307输入SHA一致。唯一红灯为W1 BoltContract仍将POLYMORPH列为type-only零变化；实际先因新形态刷新调用撞上简化夹具缺FOV（不能谎称HP断言已经执行）。本轮效果完成使W1这条留形期望过期，拆出POLYMORPH为CE实际身份/HP/旧haste/状态/单次抽签守卫；PLENTY原零变化测试不动，原扫描守卫不动。该既有测试精确纳入允许翻正，日志原JSON/SHA保存prefinal-w1-contract；第三次重新完整冻结复跑，不拼接旧绿文件。
- W1翻正后BoltContract8项+W19 57项共65项通过；S(C)=29、物种/保存补查57，R113/总121不变。生产代码没有再改，仅这一份过期语义测试和验收脚本白名单更新；其余129份既有测试不动。第三次完整冻结后仅回填报告和证据。

## 2026-09-24 W-20 复制
- 严格执行 w-20.prompt.md 与 W-0 §2.3，使用 develop-web-game 技能。通用克隆从当前实体复制，逐项断开容器；自分裂共用后执行 CE 学习剥离。plenty 身份/入池仍留 W-24。
- CE 复核发现：carriedMonster 递归结果没有挂回新体；全图无落点返回 INVALID_POS 后 cloneMonster 未检查。本轮不创造寄宿生命周期；无落点安全返回失败，不扣血/入表。
- 待完成：实现、容器反向验证、反射玩家/俘虏/保存 id 测试、浏览器、R+S 最终冻结复跑、报告。
- 实现完成：Monster 按当前实例整体复制后独立复制11类值容器，安全图/携物清除，leader 保留实体关系（盟友 null 代表玩家）；新 id、101 tick 等待、plenty 奇数 HP 向上取半。自分裂改用通用入口后单独执行 CE 原生/突变旗标交集、目录法术恢复、非飞行1000悬浮清除。
- 补齐：普通快照的 mutation 来源；cloneState 保存克隆的运行状态；高 id 休眠怪全部纳入读档预留；反射玩家的运行时身份允许后续变形，装备不克隆，玩家再生进度换算为独立怪物计数。克隆击杀不计武器自动鉴定。
- 定向测试包含 Monster 所有对象字段动态清单、逐项改克隆不改原体、死亡/携物、P4计数、实火杖燃烧分裂、反射/俘虏/无落点、JSON后 id/关系与mutation、自分裂上限、实际提交/首等待。编译原CE cloneMonster + BE_PLENTY 取137组HP黄金值。6个负变异均触发断言失败，finally恢复SHA。
- 浏览器：技能客户端运行且检查了黑色canvas截图；有头整页可见场景，沙箱阻止启动后经工具批准提升执行。第一次八场景通过、0错误；后续热更新夹具出现失效（需清洁重启Vite后复核），不计为最终证据。
- 本次反查 R=115，R∪S=123（132个测试文件中）；按实际5个生产文件种子，8个S额外文件。最终冻结全部源码/测试/脚本/progress，build + 122个显式回归 + drift独立运行，SHA前后自证；只允许超时串行复跑，不改timeout/断言/基线。最终数值与逐文件结果回填报告。
- 后续仍留W-24 plenty身份入池；完整CE毫回合再生/生成初始化RNG、carriedMonster寄宿生命周期、全levels JSON存档、P4-4完整monsterAvoids与跨层计数仍是既有模型边界，本轮不以通过冒充全游戏重放一致。
- 首次拟最终build被新增测试的JSON联合类型推断挡住（behaviorFlags.push被推为never），不是运行时断言失败。显式MutationData注解修正夹具；主动中断后续回归，归档prefinal-typecheck，不计最终结果；修后完整重新冻结复跑。
- 第二次拟最终build通过，生成回归未结束时收尾复核发现通用cloneLocation也需识别MONST_TURRET的INANIMATE复合位（plenty资格已有门）。主动中断exit130并归档prefinal-composite；补通用helper毒气落点对抗测试（第56项），再次从build完整冻结复跑。


## 2026-09-24 W-21 强化数值与计数
- 按 w-21.prompt.md / W-0 §2.3 执行，使用 develop-web-game 技能；保持生成流、frequency、种类不变。
- CE 证据：+12 HP、+10 defense/accuracy、当前伤害上下界各加 max(1,trunc(bound/10))，计数各 +1，全疗 + 逐项 panacea；敌友一致，反射玩家无效。
- 复用 Creature.heal、W20 cloneMonster、W19 实际形态保存。变形重置 info 属性但保留学习计数，W19 原留痕正确。
- 待完成：编译 CE 黄金值、边界/克隆/变形/存档/真实提交测试、浏览器、反查闭包、最终 SHA 冻结复跑和报告。学习不实现；NAUSEOUS/DARKNESS/weaknessAmount、CE clumpFactor 与完整 flare 辐射无现有模型，逐项登记。
- 完成：540 组原 CE C 黄金值及 4 组 panacea 状态边界，W21 新测试通过；W19/W20/W21/W2 定向 172 项、W9/W21 106 项通过。唯一既有断言翻正为 W2 的旧 maxHp×1.3，其余既有守卫保持。
- 7 个负变异全部触发断言失败并按 SHA 还原。build 初次发现新测试 unused import/private 访问，已修正；脚本工作目录错误没有执行测试。
- 浏览器 8 场景通过、console/page 错误0；技能客户端无头/有头 canvas 导出仍黑，已打开，不计视觉通过。有头整页截图显示游戏和详情；负变异后的 HMR 夹具一次未命中（6≠18），重启 Vite 后通过，旧失败单独保存。
- 最终冻结前的进度追加命令遇 Python 输入编码错误，随后的门禁被主动中断（build通过、回归未完成、exit130），归档 prefinal-progress；完成进度/截图等待修正后重新全套冻结，不拼接中途结果。
- 实际 6 个生产文件 R=116；S(M,C,Q)+empower/mutation/克隆/保存及文件读取合并为124文件。冻结 src/public/scripts/progress/CE/配置/黄金值输入后执行 build + 123显式回归 + 独立drift，前后SHA及逐文件结果写报告。之后只回填报告/证据。
- 后续：W22 学习未完成；W23完整消魔、复活祭坛/尸体吸收、CE weaknessAmount/恶心/黑暗、完整flare辐射/monster clumpFactor、全levels JSON持久化仍未移植。计数不消费，频率3保持留W24。
- 最终目视复核发现浏览器夹具直接设置 inspectTarget=null 不会关闭 DetailPanel 自有 visible 状态。改为点击真实关闭按钮（没有改产品代码）；第二次拟最终门禁在回归中主动中断130并归档 prefinal-browser-fixture。脚本/进度最后冻结后从 build 完整重跑，前两次均不作为最终结果。
- 第三次完整运行 build/drift 通过，2290passed/1failed/8skipped/5todo，319输入前后SHA一致。唯一红灯为合并敌友分支后留下 bolt.empowerment_enemy 死翻译键；按 P1-30 规则把键移到 zh_CN.legacy.json，守卫/扫描器不改，生产种子扩为8文件。原完整失败结果归档 prefinal-i18n，修复后重新全套冻结复跑。


## 2026-09-24 W-23 消魔能力闭环
- 用户请求执行 w-23.prompt.md，按 W-0 的 W-23 行；W-22 学习/吸收保持暂缓。使用 develop-web-game 技能。
- 已逐项读 CE negate、negationWillAffectMonster、statusEffectCatalog、NEGATABLE_TRAITS/MA mask、所有 DIES_IF_NEGATED/wasNegated 来源及读方。
- 发现 W-18 同阵营催眠资格绕过目录敌人门、p1_28 永久状态回填、W-10 清毒均不符 CE，按执行代码翻正；maxShield 沿用 web 无活动护盾时归零的表示约定。
- 待办：新增 CE 原函数审计及回归、浏览器操作、R+S 闭包、最终 SHA 门禁及报告。
- 新增42项测试通过；CE原函数104组逐状态结果及分支断言通过。7个旧文件184项通过，3处旧留形断言按CE翻正（p1_28飞行、W10毒、W18资格）。
- 浏览器10场景通过、console/page错误0；实际打开详情、失飞熔岩死亡与死亡三文案截图。技能客户端canvas截图仍黑，未算作视觉通过，改用有头整页截图。
- 中途修复均为夹具/工具问题：未初始化i18n导致消息undefined、误用不存在的spawnConsumable/useItem、Array.at不在目标lib、强化后毒被panacea清除（夹具改为先强化再施毒）；没有放宽守卫。
- 实际9个生产文件R=117，S(B,C,M,Q)+negate/NEGATABLE/保存/文件读取并集124文件；123个显式定向回归 + 独立drift。全部源码/测试/脚本/进度冻结后执行最终build/CE审计/回归/drift并前后SHA自证，之后仅回填报告及证据。
- 后续：W22学习/吸收仍暂缓；W24消魔魔杖入池；MAGICAL_FEAR/DARKNESS、完整CE怪物侧栏、A_MULTIPLICITY产生谱影、全levels JSON存档与原有web自创onHitStatus/legacy abilities不在本轮补齐。

## 2026-09-24 W-24 魔杖目录闭环
- 按 w-24.prompt.md / W-0 §2.5、§2.6，只接目录/正常入口/充能/极性/文案；9种在池、22频率、11定义（火/电继续退池）。staff目录与全部效果代码不变。使用develop-web-game技能。
- 六处生产面：arcana.json、Bolt.ts、ArcanaInstance.ts、ItemLoader.ts、Game.ts（仅wandFlavors保存/旧档确定性迁移）、zh_CN.json（4个名字）。W21说明原样保留，W22学习仍暂缓。
- 改前drift绿；改后25/104层、91字段变化（seed20260913 D2-D26）。D1旧empowerment固定1电零抽签→plenty区间1-2多抽1次，后层连锁。仅恢复旧genWands的反事实对照104层零偏离；归因完成后才重采。证据/哈希见w-24-evidence。
- 新守卫64seed×1000：9种完整、22张票顺序、64000件充能分布、125123次调用；直接构造、鉴定/极性分组、正常use/cancel/confirm、附魔增量与新旧存档。
- W5旧8seed覆盖因生成流变化漏healing staff/plenty wand：增加424242、20260913，原完整覆盖期望不动。新入口测试错误期待所有变形autoID，CE按新invisible状态决定，修夹具断言，效果未动。
- 机器WAND/STAFF入口仍null是既有V链债项，不在本轮扩张；发现屏没有独立UI，magicCharDiscoverySuffix已有接口/消费者与背包善恶符号核验，不宣称新建发现屏或商店。学习未完成。
- 技能客户端已运行但canvas截图黑；改用有头Chromium整页截图验证真实背包/选择/结算/存档，未把黑图计作视觉通过。最终编辑完成后冻结SHA，完整显式闭包/build/drift复跑，结果只写报告/证据。
- 后续：W25/26按新基线继续归因，不解禁机器；保持旧wandFlavors迁移兼容和W22学习暂缓口径。

## 2026-09-24 W-25 移动/控制杖目录
- 按 w-25.prompt.md 与 W-0 §2.5/§2.6：仅新增 tunneling/blinking/entrancement，CE表序 lightning→fire→poison→tunneling→blinking→entrancement→conjuration→healing→haste，9在池/85频率/10定义。light退池定义逐字段保留；wand目录不动。使用develop-web-game技能。
- 原CE staffTable在Globals.c，wood槽为0/1/3/4/5/6/9/10/11，非连续；显式flavorIndex和未占CE槽2给light，为W26预留行/槽7/8/12。新增staffFlavors真实旧档迁移，零RNG、原身份/绰号/耗尽与计时保留。
- W6仅预留慢回电，本轮启用初始1000、自然/卷轴10000/E，obstruction helper准备但仍无物品；W7附魔无特例仍500/新E。只接现有效果入口，不修改射线/效果/地图原语。blink容量已知显示2+2E预览与详情；未知不泄露E。使用前熔岩阻止/确认复用App原生确认钩子，取消零电/时间/RNG。
- 三场景归因（旧目录控制、仅修表序、完整新目录）各104层，四基线字段和层末RNG均零差异；表序改变8/11个staff事件，新增再改变8/11，实例E/RNG边界相同。保持原基线SHA fad7dc81a35afeff00f8bb0a9b38cb4e674d7ee584578127e270304d6c8d0bf3，不重捕获。64seed×1000分布守卫9种/85票/165353次调用通过。
- 旧10seed自然覆盖漏haste；探针发现seed24 D18有落地加速杖，仅补seed24，覆盖期望不改。W5旧rechargeTurns兼容字段守卫撞红：新三行补现有默认200，实际慢周期仍由ArcanaRecharge控制，未改守卫。
- 新28项测试通过；浏览器清洁重启后16场景通过、console/page errors 0。早期夹具曾误用地形枚举数值、存档字段、已改名充值方法；Vite HMR状态下催眠场景失效，清洁重启同脚本通过；不将这些失败归咎于效果。技能客户端canvas黑图已打开，不计视觉通过，实际打开有头整页截图。目视发现瞄准名中的斜线二次HTML转义，修该提示插值并重新浏览器核验。
- 最终R+S共124文件（R119，S G/Q/B/U/D +持久化/源码读方），冻结全部源码/测试/scripts/progress后运行build、123显式回归、独立drift及前后SHA，结果回填w-25报告/证据。不运行无参数vitest。
- 边界：W26三种未入池；怪物BLINKING仍由W22外部依赖负责，p4_1b不动；机器STAFF/WAND仍返回null、独立发现屏仍未实现。未扩词表/未声称wood词内容等同CE；未实现历史地形记忆快照，预览沿用web hasMemory。后续W26保持staffFlavors与按CE槽索引分配。

- 首次冻结完整门禁：build/drift通过、2259passed/1failed/8skipped/1todo，370输入前后SHA一致。唯一失败为R-1外观结构守卫：GameCanvas新增预览颜色字面量。按现有架构移入Appearance.ts的ARCANA_TRAJECTORY_FILL，守卫/白名单不变，生产扩为10文件。首次结果完整归档prefinal-appearance；修后定向、浏览器复核，再从build完整冻结复跑，不拼接旧结果。

## 2026-09-24 W-26 地形/辅助杖目录与总收口
- 按W-26任务和W-0 §2.5/2.6补 obstruction/discord/protection，保持原九行顺序与三退池定义。五生产文件范围，ArcanaRecharge仅注释更新。初始drift通过；正在执行新版drift、单变量目录归因、12种/110票分布与21种正常入口审计。使用develop-web-game技能。
- 单变量归因完成：旧九种控制组与基线104层零差异；仅增三行后104层四字段与层末RNG仍相同，11次staff事件8次换身份，逐次E/随机边界一致。分布12种/110票/64k件、165353调用通过，不重捕获；基线SHA fad7dc81a35afeff00f8bb0a9b38cb4e674d7ee584578127e270304d6c8d0bf3。
- 新49项入口/目标/资源/旧档测试通过，21种逐项真实use→cancel→confirm→实际效果；未替代效果配置。初稿三失败为夹具误断言：开放地形没有目标视野外传送候选；仅清hasted不置wasNegated；非blink preview为null。按原CE与前轮结论修夹具，无效果改动。
- 自然获取原11seed缺haste；探针2,3,4,5,6,8,9,10,11,12找到seed2 D26，仅加入seed2，保持21种完整期望。W25阶段目录/票数/分布分母随最终12种升级，其效果守卫不动。
- 浏览器10场景通过、console/page errors=0，实看12种背包与三种施法/吸伤截图。技能客户端canvas导出仍黑，未计视觉通过；有头Chromium最初受沙箱通信限制，授权提升后完成。力场外观默认空白沿W14已登记缺口，不宣称绿色水晶视觉完整。
- 最终生产仅5文件（ArcanaRecharge仅注释）；Game、全部效果/Map/生成器、魔杖目录、原九杖字段与相对顺序、退池定义不变。冻结src/public/scripts/progress/CE/配置/报告依据后执行build、R+S显式文件回归、独立drift与前后SHA。之后仅回填报告/证据。
- 后续仍需W22学习及怪物blink/藤蔓依赖、机器法器配发/发现屏、未建模状态、怪物伤害公式/完整flare/多层及RNG持久化等，按w-26报告的带来源登记继续全项目勘察。
- 首次完整冻结门禁：build/drift通过；2348passed/1failed/8skipped/5todo，401输入前后SHA一致。唯一失败为W9末例仍要求discord构造null，是本轮目录入池后过期的留形；同文件76项效果测试通过。原整轮结果保留prefinal-w9-catalog。只改该目录断言与过期夹具注释、补测试白名单；不改效果。编辑结束后重新从build完整冻结复跑，不沿用旧绿文件。最终并行度8，timeout/skip/todo不变。

## 2026-09-24 U00：开新局状态归零

用户任务：执行 ai_docs/tasks/u-00.prompt.md，以 X-0 §4.1/§4.2 U00/§3.1 K39 为准。
- 全枚举 91 个 Game 实例字段、8 个 static 字段、60 个 ItemLoader 静态字段及模块状态；补清整局统计/终局/请求/动画/缓存，归零实体、日志与机器分配器，注销旧层休眠回调。保留显示/接线偏好，未改存档或生成顺序。
- 新增 17 项 U00 整图深比较与双流抽取计数验证；4 种模式 × 标题/死亡/restart/seek。4 seed × 26 层与入场 HEAD 比较，两条 RNG 状态及计数不漂移。
- 浏览器真实菜单、胜利/死亡返标题、新局、seek(0) 与显示设置保持通过。记录既有 replayInfo 非响应式与动画 seek(2) 停在 1 的问题；U27 后续处理，不顺带修改。
- 最终门禁逐文件与 SHA-256 以 ai_docs/reports/u-00.report.md、u-00-evidence/final-check.json 为准；interim 日志不用于最终声明。
- 后续：U01 存档字段，U27 的两个已复现问题。不要重捕获生成基线。

## 2026-09-24 U15a：碎墙卷轴不碎不可破坏格

- 用户任务：执行 u-15a.prompt.md，以 X-0 §4.1 / §4.3 U15a / §3.1 K20 为准。
- CE 全函数核实：IMPREGNABLE 前置门；仅 DUNGEON 判据；DF → 致死/释放 → 边界晶墙 → 视野刷新。边界不自动置位；web BP/MF 两写口和失败回滚保持。
- 同函数内补接已有 freeCaptive、MONST_TURRET 复合标记、四层阻挡派生值；RUBBLE/休眠 DF 已有载体，移除过期空载体分支。
- 允许改义仅上述碎墙路径；既有测试/基线/阈值不变，生成和其他卷轴不得改动。验证、R∪S 反查、浏览器与最终 SHA 证据见 u-15a.report.md / u-15a-evidence。
- 新增18项专项全绿；首轮仅新夹具误把 SURFACE 放在数组下标2，修为显式 DungeonLayer 枚举，既有95项首轮94通过/1夹具失败已归档。构建通过。
- 浏览器两场景：真实背包点击朗读；另一路菜单保存→刷新→继续→背包朗读；保护墙和边界不变，普通墙/边界分别变力场/晶墙，卷轴消耗、俘虏保留、回合+1，console/page errors=0。技能客户端沙箱启动受 MachPort 限制，提升后运行；canvas黑图已实看，不计视觉通过，有头整页截图已核验。
- 反查R∪S共133文件，无未解析导入；AST确认Game只有crystalizeFromPlayer改变，155个来源/原测试/fixture文件SHA不变。最终运行脚本冻结输入前后SHA，之后仅回填报告和证据。
- 后续：CE楼梯邻格IMPREGNABLE写口尚无web对应（不改赋值来源）；DF全局副作用/力场默认外观/怪物死亡收口、多层与RNG存档仍按X-0原任务边界处理。
