Original prompt: 请参考brogue-web/ai_docs目录下的ai工作文件，为我继续完善这个js重构项目

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
