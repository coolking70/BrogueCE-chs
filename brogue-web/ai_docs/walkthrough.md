# Brogue Web Port - Stages 1 through 5 Walkthrough

We have successfully rebuilt the core foundation of Brogue in TypeScript and Vue/PixiJS, covering the primary mechanics for dungeon progression.

## Accomplished Features

* **Stage 1 & 2 (Architecture & Grid):** 
  * Configured Vite, Vue 3, TypeScript, and ESLint.
  * Extracted and strongly typed `Entity`, `Pos`, and `Cell` abstractions.
  * Wrote map structures `Grid` handling FOV and Pathfinding (Dijkstra ported).
* **Stage 3 (Dungeon Generation):**
  * Ported `Architect.c` logic to generate standard rooms and connecting corridors.
  * Base visual rendering uses `PixiJS` via `GameCanvas.vue` to draw ASCII characters over tile backgrounds representing walls and floors.
* **Stage 4 (Entities & Combat):**
  * Created the `Player` class and basic keyboard/Vim-key input management (`Input.ts`).
  * Created the `Monster` class with a simple AI hook (`takeTurn`).
  * Implemented a `TimeSystem` handling turn-based ticks. Entities taking actions correctly advance time.
  * Built the `CombatSystem` which executes when bumping into hostile entities. Monsters are removed upon death.
* **Stage 5 (Items & Environment):**
  * Architected JSON extraction for game data (`weapons.json`, `armors.json`).
  * Designed the `Item` and `Inventory` classes enabling the Player to collect items. Pressing `,` or `g` picks up items on the ground.
  * Created an `EnvironmentManager` utilizing Cellular Automata to calculate fire/poison gas diffusion over ticks.
  * Created a global `EventBus` for completely decoupled event hooks.

## Running the Project Local Demo
You can run the game to visually verify the dungeon builder and test the keyboard movement and combat bumping:
```bash
npm run dev
```

## Stage 6: Lighting & FOV Engine

Successfully implemented Brogue's iconic dynamic lighting system. The previous rudimentary binary (visible/invisible) raycaster has been replaced with:
*   **6.1 Symmetric Shadowcasting:** Accurate 8-octant recursive shadowcasting ensuring that walls cast realistic geometric shadows and vision handles corners smoothly.
*   **6.2 & 6.3 Dynamic LightMap & Color Mixing:** Introduced `LightMap.ts` to accumulate scene lights and calculate distance-based attenuation (falloff). Ported Brogue's RGB blending (`Color.ts`) to allow light colors to mix cleanly with terrain.
*   **6.4 Render Integration:** `GameCanvas.vue` now reads LightMap intensity, applying multiplicative and additive RGB blends to create the signature smooth fading "colored fog" effect around the player. Memory tiles (previously seen) fade- Successfully rebuilt FOV natively in TypeScript to mirror classic Brogue shadowcasting mechanics.
- Lighting Engine acts as the definitive foundation for the map experience, now utilizing a Quadratic Falloff algorithm to create buttery smooth, pure circular lighting.
  
![Dynamic Smooth Lighting](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/initial_lighting_check_1772472501196.png)

## Stage 7: Heads-up Display (HUD) and Controls
- Validated `App.vue` CSS Grid and responsive column layouts dividing the Canvas and HUD Sidebar.
- Fully wired up `Sidebar.vue` to reactively display `game.player.hp` and floor Depth via `activeGame` singleton.
- Message Logging now captures game combat events (`You hit the Rat for 4 damage`) natively into HTML via `MessageLog.vue`.
- Confirmed touch & click controls are successfully feeding A* navigation coordinates allowing mobile viability.
  
![Mobile Safe Layout](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/sidebar_ui_test_1772469520724.webp)

## Stage 8: Items & Inventory UI
- Built `InventoryOverlay.vue` floating semi-transparent window.
- Automatically maps `a-z` to the current `Player` possession queue.
- Items are nicely categorized into headers (`-- WEAPONS --`, `-- ARMOR --`) mirroring classical Brogue lists.
- Implemented item interaction: Selecting an item expands a contextual action row with localized variants for `Equip`, `Unequip`, and `Drop`.
- Integrated `equippedWeapon` and `equippedArmor` tracking in the `Player` Entity.
- Interactions dynamically update the `MessageLog` and advance `timeSystem`. 

![Inventory Layout](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/inventory_verification_1772473614585.png)
![Interactive Equip UI](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/dagger_equipped_unequip_button_1772474654032.png)
![HUD & Pathfinding Result](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/.system_generated/click_feedback/click_feedback_1772471368434.png)

## Stage 9: Weapon Combat Calculations
- Written a robust Regex string parser `rng.rollD()` capable of executing D&D style dice bounds (e.g `1d4+2`).
- Restructured `CombatSystem.attack` allowing damage modifiers checking active `Player.equippedWeapon.damage` stats.
- Overhauled `MessageLog` printing mechanics to capture specific Weapon names used during enemy hits.
  
![Detailed Combat Log](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/combat_damage_messages_1772475160802.png)

## Stage 10: Expanded Roster and Loot Drops
- Ported enemies like Rat, Kobold, Jackal, and Goblin into `data/monsters.json`.
- Handled procedural map population matching deepness bounds `minDepth` and `maxDepth`.
- Introduced loot mechanics: roaming enemies can drop generated Weapons, Armor, and Gold on death.

**Jackal Enemy Spotted and Fought:**
![Jackal Combat Log](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/combat_log_check_1772475824003.png)

**Looting drops from the ground:**
![Jackal Killed](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/jackal_defeated_check_1772475841951.png)
![Walk over Loot](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/loot_check_after_combat_1772475868548.png)

## Stage 14: Auto-Explore & Auto-Attack Refinements
- **Auto-Attack via 'x'**: Pressing 'x' when next to a monster now automatically targets and attacks the adjacent enemy with the lowest HP instead of trying to path or prompting about them.
- **Auto-Loot Targeting & Auto-Pickup**: Refined the BFS exploration algorithm to recognize dropped `Items` as valid traversal destinations. The pathfinder will route you to nearby un-looted treasure natively, and **automatically pick it up** into your inventory upon arrival to prevent toggling behavior.
- **Item Spotting Pause**: Added an `ignoredItemsForExplore` memory set. If a *new* item enters your FOV during an auto-explore voyage, the game will safely pause your journey (`"You spot an item and stop exploring."`), giving you a chance to react before continuing.
- **Improved Stairs Input**: Uncoupled `pickup` from the `,` key. The Engine now globally responds to full-width and half-width comma/period characters (`<`, `>`, `,`, `.`, `，`, `。`, `《`, `》`) to invoke ascend and descend behaviors without relying on the Shift modifier.

## Stage 13: Deep Fixes & Persistent Depths
- Restructured `Game.ts` to implement a `levels: Map<number, LevelState>` caching system. When generating or navigating flights of stairs via `<` or `>`, the engine will now check memory storage to persist previously excavated walls, looted items, and remaining mob positions. 
- Bound `Sidebar.vue`'s "Depth" data node to Vue Reactivity via `game.depth` instead of hardcoded strings. 
- Hard-locked the `Sidebar.vue` panel widths (`min-width: 340px; max-width: 340px`) to shield the Main Rendering Canvas from overlapping behind it during smaller browser window frames.
- Refactored `Item.ts` with a `displayName` dynamic string getter that queries the Global ID Registry. Passed it back to `logger.log` so item pickups broadcast natively to the UI Message Log ("You picked up a Potion of Life") rather than sinking into dev-tools `console.log`.
- Refined the auto-explore algorithm (`x`): 
  - Hostiles spotted during traversal now merely pause the path queue without deleting it. If the player presses `x` again while a monster is still in view, the game temporarily ignores that monster to continue exploring, pausing again only if the monster becomes adjacent or a completely new monster appears. 
  - Excluded inaccessible tiles (like inner-walled voids) to guarantee proper completion messages when navigating organic BSP rooms.

## Stage 12: Core Polish & Depth Progression
- Addressed item pickup UX by fixing proper name logging (`You picked up a Potion of Life`).
- Implemented global `displayName`/`displayColor` updates so Identified consumables dynamically update their string format on-ground and in backpacks.
- Fixed an `App.vue` flex child resizing logic error that caused PixiCanvas to overflow under the sidebar when window was scaled.
- Hooked `Game.updateFOV()` to dispatch 'Discovery' logs when new monsters or items enter sight lines (`You see a Jackal.`).
- Upgraded `GameCanvas.vue` Text Sprite renderings: interactive and hostile entities now cast vibrant glows via the dropShadow parameter to strongly detach them from standard ASCII tiles.
- Built a native `Dijkstra`/BFS Auto-Explore pathfinding loop bound to the `x` / `X` keys that rapidly maps unexplored territory until enemies appear. 
- Integrated multi-floor logic via the `Architect` class, placing `STAIRS_DOWN` and `STAIRS_UP` terrain pieces. Depth tracking triggers full map regenerations as users climb `<` or descend `>`.

## Stage 11: Potions and Scrolls
- Designed randomized item identification: specific potions (`potion_of_life`, etc.) get shuffled to flavor names (`Red Potion`, `Bubbly Potion`) at the start of each game.
- Added GUI overlays `[q] Quaff` for Potions and `[r] Read` for Scrolls.
- Handled Vue Proxy equality bugs to reliably remove consumed items from instances. 
- Implemented discovery text logic causing log feedback like: `"You feel much better!"` -> `"It was a Potion of Life!"`.

## Stage 7: UI Design & Polish
- Redesigned the generic `Sidebar.vue` panel using CSS variables (`main.css`), a deep gradient background, and a responsive flexbox layout.
- Upgraded the HP bar to use `transition` and `animation` for a pulsating gradient effect when health falls below 30%.
- Upgraded the `InventoryOverlay.vue` to use `backdrop-filter: blur(20px)` glassmorphism styling with neat categorization headers and fluid hover states.
- Replaced system fonts with Google Web Fonts `Inter` (sans-serif) and `Fira Code` (monospace) for a premium, sleek look.
- Added `Escape` keybinding to easily un-toggle the inventory overlay alongside the existing `I` key.

## Stage 8: Procedural Dungeon Generation (Rewrite)
Brogue's signature dungeon generation logic has been heavily refactored into TypeScript (`Architect.ts`).

*   **8.1 Macro Parameters & BSP:** Established the `DungeonProfile` and `RoomType` primitives based on the original C structs.
*   **8.2 Topology Growth Algorithm:** Implemented the core `attachRooms` and `findAttachPoint` logic. New rooms are stamped down on a spatial grid (`RoomBuilder.ts`) and intelligently slid into place along the perimeter of existing structures without overlapping, simulating Brogue's organic room clustering.
*   **8.3 Doors and Corridors:** Rooms automatically evaluate valid junction points and carve either `FLOOR`, `OPEN_DOOR`, or `DOOR` at their connection seams.

*   **8.4 Special Terrain Generators:** Abstracted `createBlobOnGrid` (Cellular Automata) to safely seed lakes, deep water arrays, and grass/foliage organically onto floor tiles.

Here is a recording of the player traversing the successfully generated multi-room, multi-door dungeon:
![Dungeon Generation Topological Growth Output](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/dungeon_gen_test_2_1772463715478.webp)

And here is the visual confirmation of the organic Water `~` and Foliage `♠` terrain blobs blending into the generated dungeon:
![Organic Lake and Grass Generation](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/terrain_features_verified_1772465761780.png)

## Stage 14: Auto-Explore & Auto-Attack Refinements
- **Auto-Attack via Exploration**: Overrode the pause mechanism during `handleAutoExplore()` when enemies are adjacent, prioritizing attack moves instead of pausing with "You spot a monster".
- **Item Search Targeting**: Added dropped loot as valid `target` nodes to the pathfinding BFS, ensuring the algorithm seamlessly retrieves nearby items logic.
- **Auto-Pickup Integration**: Modified `stepAutoPath` logic to continuously interact (pickup drops) whenever the player finishes transitioning on top of an item. Keyboard stairs input `, .` was unbinded from inventory and mapped completely to multi-format stair macros `< >`. 
- **FOV Memory Persistence**: Re-engineered item rendering to avoid completely removing items from the view once explored but outside the current light cone. Out-of-sight items (`cell.hasMemory`) now render deeply dimmed to `#666666`, and out-of-sight stairs maintain a fully luminous footprint (`#222222` backplate shading), improving player wayfinding.
- **Hover Text Memory Tooltips**: Modified hover text logic. When the cursor highlights a `cell.hasMemory` tile outside of current FOV, the UI reads out "You remember seeing..." ahead of the entity types.
- **Smart Mouse Travel**: Re-engineered pointer clicks on the canvas to execute a dedicated `handleMouseTravel` flow. Mouse travel bypasses adjacent enemies (prioritizing the clicked destination) and only attacks if the physical path is directly blocked. It completely ignores previously seen or currently visible items to prevent spamming pauses, but will correctly stop on brand new items found mid-transit. Clicking directly on an item will path toward it and seamlessly trigger `pickup`.

![FOV Memory Rendering Demonstration](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/memory_hover_test_1772502924163.webp)

## Stage 15: Unidentified Mechanics, Curses, and Strength Dependencies

Brogue's strategic depth relies heavily on not knowing what you're holding until you commit to using it, as well as risking severe penalties if you equip cursed or overly heavy loadouts.

- **Item Identification (Consumables)**: Picking up potions and scrolls now assigns them random physical flavors (e.g., "Bubbly Potion" or "Scroll titled FEI LU"). Only after quaffing or reading the item, or using a Scroll of Identify, will its true identity be revealed in the action log.
- **Enchantments and Curses**: Weapons and armor can now roll random combat enhancements (+1, -2, etc.) upon generation. If the enhancement is negative, the equipment is automatically flagged as *Cursed*.
- **Cursed Equipment Restrictions**: Once a user clicks `Equip` on a Cursed item, the `Unequip` button becomes restricted. The game will aggressively block the action with a red warning log, forcing the player to adapt until they find a means to lift the curse.
- **Strength Handicaps**: The player currently has a base `strength` of 12. If they attempt to wield heavy equipment requiring higher strength, the inventory will alert the player with a red `[Req Str: X]` tag. The underlying combat logic will dynamically penalize their hit chance and damage output against monsters to reflect the structural burden.

````carousel
![Unidentified Items and Strength Warnings](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/initial_inventory_1772507745952.png)
<!-- slide -->
![Curse Restrictions and Epiphanies](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/action_log_results_1772508260232.png)
````

## Stage 16: Environmental Interactions, Gases, and Fire Propagation

The game ecosystem is now alive with chaotic environmental interactions that players must use to their advantage (or to their peril).

- **Throwing Mechanics**: Pressing `[t] Throw` in the inventory allows the player to target any floor tile in sight. 
- **Volatile Chemical Reactions**: Throwing certain potions causes them to shatter on impact and rapidly alter the map:
  - **Potion of Incineration**: Spawns an aggressive `Fire (^)` that spreads horizontally and vertically across flammable terrain (`Grass`, `Foliage`, `Wooden Doors`). When the burn duration runs out, the terrain is permanently reduced to `Charred Floor`. If fire hits a water tile, it violently boils it into dense Steam.
  - **Potion of Poison**: Spawns a thick `Caustic Gas (~, purple)` cloud that suffocates anything inside it.
  - **Potion of Confusion**: Spawns unpredictable `Confusion Gas (?, teal)`.
- **Cellular Automaton Dissipation / Diffusion**: Gases do not stay static; every tick they expand outwards to fill the room while actively diluting their central volume until they completely evaporate.
- **Environmental Hazard Damage**: At the end of every turn, the engine runs an `applyEnvironmentalEffects` check that inflicts raw damage on any entity (monsters or the player) unfortunate enough to be standing in dense smoke, scalding steam, or open fire. Characters can easily burn to death.
- **Dynamic Sub-Layer Rendering**: The `GameCanvas.vue` engine was updated to draw Environmental hazard characters and semi-transparent color overlays *on top* of the terrain underneath, ensuring the player visually tracks the blast zones in real time.

![Chemical Mayhem: Fire, Poison, and Confusion](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/all_effects_final_1772509377154.png)

## Stage 17 & 18: Hunger Mechanisms & Enemy Stealth Awareness

Brogue is famous for its tactical tension driven by food scarcity and monster tracking mechanics. We introduced these core pillars:

- **Hunger Decay & Resting**: The `Player` now has a `nutrition` stat that slowly decays each turn. Instead of moving aimlessly, players can press `.` to carefully pass a turn and heal HP at the high cost of nutrition.
- **Dynamic Food Consumption**: Backpack actions now properly support `# Eat`, allowing the consumption of `Ration of Food` to reset the `Satiated` stat and stave off `Starving` penalties. 
- **The Three-State Monster AI**: AI units now default to a passive `ASLEEP` state (rendered as shadowed out in dark blue/grey ASCII). They smoothly transition to `WANDERING` or `HUNTING` based on proximity testing.
- **A* Pursuit Routing**: `Monster.takeTurn` now accurately runs `Pathfind.ts` Dijkstra algorithms against the `Game` instance to mathematically chase the player to the corners of the earth once awoken.
- **Visual Feedback**: Below the HUD's health bar, the `Sidebar` now reactively displays `FOOD Satiated` in vibrant font.

![Testing Hunger Wait and Sleep Mechanics in Combat](/Users/coolking70/.gemini/antigravity/brain/d094f812-510d-4c11-8d4c-9c424f776ce1/stealth_and_hunger_test_1772516427036.webp)
