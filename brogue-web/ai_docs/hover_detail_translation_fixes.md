# Brogue Web - 悬停详情面板 / 未鉴定道具名 / 视野翻译 修复指南

> 本文档面向 AI 实现者，包含完整的根因分析、代码定位和修复方案。
> 项目根目录：`/Users/coolking70/Documents/同步空间/brogue/brogue-web/`

---

## 问题概览

| # | 问题 | 根因 | 严重度 | 状态 |
|---|------|------|--------|------|
| 1 | 鼠标悬停地图无详情面板弹出 | `updateHover()` 仅设置侧边栏文字，未触发 `inspectTarget` | 高 | ✅ 已修复 |
| 2 | 物品栏中点击装备/道具无详情面板 | `selectItem()` 仅切换选中状态，未调用 `generateItemDetail()` | 高 | ✅ 已修复 |
| 3 | 悬停未鉴定卷轴/魔杖等显示真实名称 | `updateHover()` 使用 `i.name` 而非 `i.displayName` | 中 | ✅ 已修复 |
| 4 | 视野信息大量英文未翻译 | `updateHover()` 和 `Sidebar.vue` 中硬编码英文字符串 | 中 | ✅ 已修复 |
| 5 | 自动探索出现英文 "No path found." | BFS 与 `canMoveTo()` 不一致导致深水格被选为不可达探索目标 | 中 | ❌ 待修复 |

---

## 问题 1：鼠标悬停地图无详情面板

### 根因分析

**系统现状**：
- `DetailPanel.vue` 组件已完整实现，轮询 `game.inspectTarget` 每 100ms
- `generateMonsterDetail()` 和 `generateItemDetail()` 已完备
- `handleExamineNearest()` 功能正常，但 **仅通过按 'x' 键触发**
- 鼠标悬停仅调用 `game.updateHover(x, y)` → 设置 `hoveredText` → Sidebar 显示

**事件流（当前）**：
```
鼠标移动在 GameCanvas → game.updateHover(x,y) → game.hoveredText = "xxx"
→ Sidebar.vue 显示 hoverText
✗ inspectTarget 始终为 null
✗ DetailPanel 永远不弹出
```

**事件流（目标）**：
鼠标右键或长按悬停 → 弹出详情面板

### 关键代码位置

| 文件 | 行号 | 内容 |
|------|------|------|
| `src/components/GameCanvas.vue` | L481-488 | `pointermove` → `game.updateHover(mapX, mapY)` |
| `src/components/GameCanvas.vue` | L490-520 | `pointerup` → 移动/寻路（无详情逻辑） |
| `src/engine/Core/Game.ts` | L4019-4087 | `updateHover()` — 仅设置 hoveredText |
| `src/engine/Core/Game.ts` | L875-935 | `handleExamineNearest()` — 设置 inspectTarget |
| `src/engine/Core/Game.ts` | L228 | `public inspectTarget: DetailInfo \| null = null` |
| `src/components/DetailPanel.vue` | L13-20 | 轮询 `game.inspectTarget` |

### 修复方案

**方案：在 GameCanvas.vue 中添加右键点击事件处理**

在 `GameCanvas.vue` 的 `pixiApp.stage.on('pointerup')` 代码块后面，添加右键点击处理：

```typescript
// 文件: src/components/GameCanvas.vue
// 位置: 在 pixiApp.stage.on('pointerup', ...) 代码块之后

pixiApp.stage.on('rightclick', (e: PIXI.FederatedPointerEvent) => {
    e.preventDefault();
    const localPt = tileLayer.toLocal(e.global);
    const mapX = Math.floor(localPt.x / TILE_SIZE);
    const mapY = Math.floor(localPt.y / TILE_SIZE);

    if (mapX >= 0 && mapX < DCOLS && mapY >= 0 && mapY < DROWS) {
        game.handleInspectAt(mapX, mapY);
    }
});
```

同时需要在 `Game.ts` 中添加 `handleInspectAt` 方法：

```typescript
// 文件: src/engine/Core/Game.ts
// 位置: 在 handleExamineNearest() 方法之后

public handleInspectAt(x: number, y: number) {
    const cell = this.grid.getCell(x, y);
    if (!cell || !cell.isVisible) return;

    // 优先检查怪物
    const m = this.getMonsterAt(x, y);
    if (m && m.hp > 0) {
        const weaponDamageStr = this.player.equippedWeapon?.damage ?? "1d2";
        const [n, d] = weaponDamageStr.split('d').map(Number);
        this.inspectTarget = generateMonsterDetail(
            m,
            this.player.hp,
            this.player.strength,
            this.player.equippedArmor?.armor ?? 0,
            [n || 1, (n || 1) * (d || 2)],
            this.player.equippedWeapon?.enchantment ?? 0,
            this.player.equippedWeapon?.strengthRequired ?? 12,
            this.player.equippedArmor?.armor ?? 0,
            this.player.equippedArmor?.enchantment ?? 0,
            this.player.equippedArmor?.strengthRequired ?? 12
        );
        return;
    }

    // 检查道具
    const itemsHere = this.items.filter(i => i.loc.x === x && i.loc.y === y);
    if (itemsHere.length > 0) {
        this.inspectTarget = generateItemDetail(itemsHere[0]!, this.player.strength);
        return;
    }
}
```

**注意**：需要确保 Pixi.js stage 不会被浏览器默认右键菜单阻断。在 GameCanvas.vue 的 canvas 元素上添加：
```typescript
// 在 onMounted 中的 pixiApp 初始化之后：
pixiApp.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
```

---

## 问题 2：物品栏点击无详情面板

### 根因分析

**当前代码** (`src/components/InventoryOverlay.vue` L111-113)：
```typescript
const selectItem = (item: Item) => {
    selectedItem.value = selectedItem.value?.id === item.id ? null : item;
};
```
仅切换 `selectedItem` 引用，用于显示操作按钮（装备/使用/丢弃等）。没有任何代码调用 `generateItemDetail()` 或设置 `game.inspectTarget`。

### 关键代码位置

| 文件 | 行号 | 内容 |
|------|------|------|
| `src/components/InventoryOverlay.vue` | L111-113 | `selectItem()` — 仅切换选中 |
| `src/engine/UI/DetailGenerator.ts` | L261-381 | `generateItemDetail()` — 已实现 |
| `src/engine/Core/Game.ts` | L228 | `inspectTarget` 属性 |

### 修复方案

**方案：在 InventoryOverlay.vue 中添加"查看详情"按钮**

在物品被选中后显示的操作按钮列表中，新增一个"查看详情"按钮：

```typescript
// 文件: src/components/InventoryOverlay.vue
// 位置: 在现有操作函数（performEquip 等）之后添加

import { generateItemDetail } from '../engine/UI/DetailGenerator';

const performInspect = (item: Item) => {
    activeGame.inspectTarget = generateItemDetail(item, activeGame.player.strength);
    // 不关闭物品栏，让用户可以关闭详情面板后继续操作
};
```

在模板中，在每个物品的操作按钮区域添加"查看"按钮：

```html
<!-- 在操作按钮列表中添加 -->
<button class="action-btn inspect-btn" @click.stop="performInspect(selectedItem)">
    {{ t('item.inspect', { defaultValue: '查看详情' }) }}
</button>
```

**替代方案**：也可以直接在 `selectItem()` 中自动弹出详情面板，但这样可能影响快速操作的体验（用户只想装备而不看详情）。建议用独立按钮触发。

**注意**：需要 import `generateItemDetail` 和 `activeGame`（已在文件头部引入 `activeGame`）。

---

## 问题 3：未鉴定道具悬停显示真名

### 根因分析

**当前代码** (`src/engine/Core/Game.ts` L4037)：
```typescript
itemsAtLoc.forEach(i => entities.push(i.name));  // ← 问题所在
```

`Item.name` 是通过 `ItemLoader.translateName(data.trueName)` 设置的**真实名称**（已翻译），如 "附魔卷轴"。但对于未鉴定的消耗品和奥术物品，应使用 `Item.displayName` getter。

**`displayName` getter 逻辑** (`src/engine/Items/Item.ts` L65-119)：
- 对于 POTION：检查 `ItemLoader.identifiedItems.has(consumableId)`，未鉴定则返回随机风味名
- 对于 SCROLL：检查 `ItemLoader.identifiedItems.has(consumableId)`，未鉴定则返回随机标题名
- 对于 WAND/STAFF/RING/CHARM：检查 `ItemLoader.identifiedItems.has(identityId)`，未鉴定则返回随机材质名
- 对于 WEAPON/ARMOR：返回含附魔修饰的名称
- 对于已鉴定物品：返回真实名称

**正确做法参考**：
- `DetailGenerator.ts` L378：`name: item.displayName` ✓
- `Game.ts` L1360（视野通知）：`(i as any).displayName || i.name` ✓

### 关键代码位置

| 文件 | 行号 | 内容 |
|------|------|------|
| `src/engine/Core/Game.ts` | L4037 | `itemsAtLoc.forEach(i => entities.push(i.name))` |
| `src/engine/Items/Item.ts` | L65-119 | `get displayName()` |

### 修复方案

**修改单行代码**：

```typescript
// 文件: src/engine/Core/Game.ts
// 行号: 4037
// 原代码:
itemsAtLoc.forEach(i => entities.push(i.name));
// 修改为:
itemsAtLoc.forEach(i => entities.push(i.displayName));
```

---

## 问题 4：视野信息大量未翻译

### 根因分析

`Game.ts` 的 `updateHover()` 方法（L4019-4087）全部使用硬编码英文字符串。`Sidebar.vue` 同样硬编码所有标签文字。

项目使用 `i18next` 翻译框架（配置文件 `src/i18n.ts`），翻译文件 `src/locales/zh_CN.json`（约2775行）。但 `updateHover()` 和 `Sidebar.vue` 完全没有调用 i18next。

### 4.1 Game.ts updateHover() 中的硬编码英文

**当前代码与对应翻译**：

| 行号 | 当前英文 | 应翻译为 |
|------|---------|---------|
| L4024 | `'Unknown'` | `'未知'` |
| L4032 | `m.name` (已翻译) | 无需修改 |
| L4037 | `i.name` (已翻译但不识别鉴定状态) | 改用 `i.displayName` |
| L4042 | `'You'` | `'你'` |
| L4046 | `'Floor'` (默认值) | `'地面'` |
| L4048 | `'Granite Wall'` | `'花岗岩墙壁'` |
| L4049 | `'Closed Door'` | `'关闭的门'` |
| L4050 | `'Open Door'` | `'打开的门'` |
| L4051 | `'Shallow Water'` | `'浅水'` |
| L4052 | `'Deep Water'` | `'深水'` |
| L4053 | `'Grass'` | `'草地'` |
| L4054 | `'Foliage'` | `'植被'` |
| L4055 | `'Stairs Down'` | `'下行楼梯'` |
| L4056 | `'Stairs Up'` | `'上行楼梯'` |
| L4057 | `'Sign'` | `'标牌'` |
| L4058 | `'Reset Plate'` | `'重置压板'` |
| L4059 | `'Trap'` | `'陷阱'` |
| L4060 | `'Secret Door'` | `'暗门'` |
| L4061 | `'Pressure Plate'` | `'压力板'` |
| L4066 | `'standing on'` | 改用中文句式 |
| L4073 | `'You remember seeing ... here.'` | `'你记得在这里看到过...'` |
| L4075 | `'You remember seeing ...'` | `'你记得看到过...'` |

**当前 switch 遗漏的 TerrainType**（默认显示 'Floor'）：

参考 `src/engine/Map/Grid.ts` L9-36 的完整 TerrainType 枚举，以下类型在 switch 中缺失：

| TerrainType | 应翻译为 |
|-------------|---------|
| NOTHING | (不应出现) |
| WALL | `'墙壁'` |
| CHASM | `'深渊'` |
| LAVA | `'熔岩'` |
| BOG | `'沼泽'` |
| CHARRED_FLOOR | `'烧焦的地面'` |
| LOCKED_DOOR | `'锁住的门'` |
| ALTAR | `'祭坛'` |
| WEB | `'蛛网'` |
| BLOOD | `'血迹'` |
| MUD | `'泥浆'` |

### 修复方案（Game.ts updateHover）

将整个 `updateHover()` 方法改写为使用 i18next 翻译：

```typescript
// 文件: src/engine/Core/Game.ts
// 替换 L4019-4087 整个 updateHover() 方法

public updateHover(x: number, y: number) {
    this.hoveredCell = { x, y };
    const cell = this.grid.getCell(x, y);

    if (!cell || (!cell.hasMemory && !cell.isVisible)) {
        this.hoveredText = i18next.t('hover.unknown', { defaultValue: '未知' });
        return;
    }

    const entities: string[] = [];

    // 检查怪物
    const m = this.getMonsterAt(x, y);
    if (m && cell.isVisible) entities.push(m.name); // m.name 已由构造函数翻译

    // 检查道具（使用 displayName 尊重鉴定状态）
    const itemsAtLoc = this.items.filter(i => i.loc.x === x && i.loc.y === y);
    if (cell.isVisible || cell.hasMemory) {
        itemsAtLoc.forEach(i => entities.push(i.displayName));
    }

    // 检查玩家
    if (this.player.loc.x === x && this.player.loc.y === y && cell.isVisible) {
        entities.push(i18next.t('hover.you', { defaultValue: '你' }));
    }

    // 地形名称翻译
    const tName = this.getTerrainName(cell.terrain);

    let baseText = '';
    if (entities.length > 0) {
        // 中文格式: "老鼠，位于地面"
        baseText = i18next.t('hover.entity_on_terrain', {
            entities: entities.join(i18next.t('hover.separator', { defaultValue: '、' })),
            terrain: tName,
            defaultValue: `${entities.join('、')}，位于${tName}`
        });
    } else {
        baseText = tName;
    }

    if (!cell.isVisible && cell.hasMemory && cell.isExplored) {
        if (entities.length > 0) {
            this.hoveredText = i18next.t('hover.remember_entity', {
                entities: entities.join(i18next.t('hover.separator', { defaultValue: '、' })),
                defaultValue: `你记得在这里看到过${entities.join('、')}。`
            });
        } else {
            this.hoveredText = i18next.t('hover.remember_terrain', {
                terrain: tName,
                defaultValue: `你记得这里是${tName}。`
            });
        }
    } else {
        this.hoveredText = baseText;
    }

    if (cell.terrain === TerrainType.SIGN) {
        const signText = this.signTexts.get(this.posKey(x, y));
        if (signText) {
            this.hoveredText = `${this.hoveredText} ${signText}`;
        }
    }
}
```

**新增辅助方法**（在 `updateHover` 之后添加）：

```typescript
private getTerrainName(terrain: TerrainType): string {
    const terrainNames: Record<number, string> = {
        [TerrainType.FLOOR]: i18next.t('terrain.floor', { defaultValue: '地面' }),
        [TerrainType.GRANITE]: i18next.t('terrain.granite', { defaultValue: '花岗岩墙壁' }),
        [TerrainType.WALL]: i18next.t('terrain.wall', { defaultValue: '墙壁' }),
        [TerrainType.DOOR]: i18next.t('terrain.door', { defaultValue: '关闭的门' }),
        [TerrainType.OPEN_DOOR]: i18next.t('terrain.open_door', { defaultValue: '打开的门' }),
        [TerrainType.WATER_SHALLOW]: i18next.t('terrain.shallow_water', { defaultValue: '浅水' }),
        [TerrainType.WATER_DEEP]: i18next.t('terrain.deep_water', { defaultValue: '深水' }),
        [TerrainType.CHASM]: i18next.t('terrain.chasm', { defaultValue: '深渊' }),
        [TerrainType.LAVA]: i18next.t('terrain.lava', { defaultValue: '熔岩' }),
        [TerrainType.GRASS]: i18next.t('terrain.grass', { defaultValue: '草地' }),
        [TerrainType.FOLIAGE]: i18next.t('terrain.foliage', { defaultValue: '植被' }),
        [TerrainType.BOG]: i18next.t('terrain.bog', { defaultValue: '沼泽' }),
        [TerrainType.STAIRS_UP]: i18next.t('terrain.stairs_up', { defaultValue: '上行楼梯' }),
        [TerrainType.STAIRS_DOWN]: i18next.t('terrain.stairs_down', { defaultValue: '下行楼梯' }),
        [TerrainType.CHARRED_FLOOR]: i18next.t('terrain.charred_floor', { defaultValue: '烧焦的地面' }),
        [TerrainType.SIGN]: i18next.t('terrain.sign', { defaultValue: '标牌' }),
        [TerrainType.RESET_PLATE]: i18next.t('terrain.reset_plate', { defaultValue: '重置压板' }),
        [TerrainType.TRAP]: i18next.t('terrain.trap', { defaultValue: '陷阱' }),
        [TerrainType.SECRET_DOOR]: i18next.t('terrain.secret_door', { defaultValue: '暗门' }),
        [TerrainType.PRESSURE_PLATE]: i18next.t('terrain.pressure_plate', { defaultValue: '压力板' }),
        [TerrainType.LOCKED_DOOR]: i18next.t('terrain.locked_door', { defaultValue: '锁住的门' }),
        [TerrainType.ALTAR]: i18next.t('terrain.altar', { defaultValue: '祭坛' }),
        [TerrainType.WEB]: i18next.t('terrain.web', { defaultValue: '蛛网' }),
        [TerrainType.BLOOD]: i18next.t('terrain.blood', { defaultValue: '血迹' }),
        [TerrainType.MUD]: i18next.t('terrain.mud', { defaultValue: '泥浆' }),
    };
    return terrainNames[terrain] || i18next.t('terrain.floor', { defaultValue: '地面' });
}
```

> **注意**：`Game.ts` 头部已有 `import i18next from 'i18next'`，可直接使用。如果尚未导入，需添加。

### 4.2 Sidebar.vue 中的硬编码英文

**当前代码与修改**：

| 位置 | 当前代码 | 修改为 |
|------|---------|--------|
| L17 | `text: 'Satiated'` | `text: '饱食'` |
| L18 | `text: 'Hungry'` | `text: '饥饿'` |
| L19 | `text: 'Starving'` | `text: '极度饥饿'` |
| L20 | `text: 'Fainting'` | `text: '虚脱'` |
| L57 | `Depth: {{ playerDepth }}` | `深度: {{ playerDepth }}` |
| L63 | `HP` | `生命` |
| L75 | `FOOD` | `食物` |
| L82 | `STATUS` | `状态` |
| L103 | `ACTION LOG` | `行动日志` |

**修复方案（直接替换硬编码中文）**：

由于该项目中文是唯一目标语言，可直接硬编码中文替换英文，无需引入 i18next：

```html
<!-- 文件: src/components/Sidebar.vue -->

<!-- L57 -->
<div class="depth-indicator">深度: {{ playerDepth }}</div>

<!-- L63 -->
<span class="stat-label">生命</span>

<!-- L75 -->
<span class="stat-label">食物</span>

<!-- L82 -->
<span class="status-title">状态</span>

<!-- L103 -->
<div class="log-header">行动日志</div>
```

```typescript
// L16-21: 饥饿状态翻译
const getNutritionStatus = (nutrition: number) => {
    if (nutrition > 6000) return { text: '饱食', color: '#4ade80' };
    if (nutrition > 2000) return { text: '饥饿', color: '#facc15' };
    if (nutrition > 0) return { text: '极度饥饿', color: '#f87171' };
    return { text: '虚脱', color: '#b91c1c' };
};
```

---

---

## 问题 5：自动探索出现 "No path found."（待修复）

### 背景

此问题是之前修复"玩家自动寻路走入深水导致溺死"的**副作用**。修复 `canMoveTo()` 添加 WATER_DEEP 阻断后，自动探索 BFS 和寻路引擎之间产生了不一致。

### 根因分析

**问题链条（四步）**：

**第一步**：`Grid.ts` 对 WATER_DEEP 的 `isPassable = true`（L136-141）
`setTerrain()` 方法只将 WALL/GRANITE/CHASM/SECRET_DOOR 标为不可通行，WATER_DEEP 仍然 `isPassable = true`。

```typescript
// 文件: src/engine/Map/Grid.ts L136-141
cell.isPassable = (
    terrain !== TerrainType.WALL &&
    terrain !== TerrainType.GRANITE &&
    terrain !== TerrainType.CHASM &&
    terrain !== TerrainType.SECRET_DOOR
    // ← WATER_DEEP 不在此列，所以 isPassable = true
);
```

**第二步**：`handleAutoExplore()` BFS 将未探索的深水格纳入探索目标（L3812-3844）
目标选择条件为 `isPassable && !isExplored`，WATER_DEEP 满足此条件：

```typescript
// 文件: src/engine/Core/Game.ts L3819
if (cell && (!cell.isExplored || (hasLoot && !isPlayerOnLoot)) && cell.isPassable) {
    target = curr;  // ← 深水格被选为探索目标
    break;
}
// BFS 展开也包含深水格 (L3829):
if (nextCell && this.grid.isValidPos(nx, ny) && (nextCell.isPassable || !nextCell.isExplored)) {
    queue.push({ x: nx, y: ny });  // ← 深水格进入 BFS 队列
}
```

**第三步**：`canMoveTo()` 阻断 WATER_DEEP（L3849，之前修复）
```typescript
if (t === TerrainType.WATER_DEEP) return false;
```

**第四步**：BFS 选出深水格 target → `setAutoPath()` 调用 `findPath()` with `canMoveTo()` → 目标不可达 → 打印英文报错（L4174）
```typescript
// 文件: src/engine/Core/Game.ts L4169-4177
public setAutoPath(x: number, y: number) {
    const path = Pathfind.findPath(this.grid, ..., this.canMoveTo.bind(this));
    if (path && path.length > 0) {
        this.autoPath = path;
    } else {
        logger.log("No path found.", '#aaaaaa');  // ← 英文 + 出现在此
    }
}
```

**触发时机**：玩家已探索地图大部分陆地区域，剩余未探索区域主要是深水。自动探索 BFS 把深水格当作探索目标，但寻路无法到达，反复触发此消息。

> **注**：楼梯不会放在深水上（`populateLevel()` L523 只从 `TerrainType.FLOOR` 格中选取放置位置），用户描述的"找不到楼梯时出现"是因为陆地全探索完后剩余未探索区域恰好都是深水。

### 修复方案

需要**同时修改两处**，缺一不可：

#### 修改一：`handleAutoExplore()` BFS 排除深水（`Game.ts`）

**文件**：`src/engine/Core/Game.ts`

修改 BFS 展开条件（约 L3829），阻止 BFS 进入深水格，从根本上杜绝选出深水目标：

```typescript
// 当前代码（约 L3829）：
if (nextCell && this.grid.isValidPos(nx, ny) && (nextCell.isPassable || !nextCell.isExplored)) {
    const key = `${nx},${ny}`;
    if (!visited.has(key)) {
        visited.add(key);
        queue.push({ x: nx, y: ny });
    }
}

// 修改为（添加 WATER_DEEP 排除）：
if (nextCell && this.grid.isValidPos(nx, ny) &&
    nextCell.terrain !== TerrainType.WATER_DEEP &&        // ← 新增这行
    (nextCell.isPassable || !nextCell.isExplored)) {
    const key = `${nx},${ny}`;
    if (!visited.has(key)) {
        visited.add(key);
        queue.push({ x: nx, y: ny });
    }
}
```

> `TerrainType` 已在 `Game.ts` 中 import，可直接使用。

#### 修改二：`setAutoPath()` 翻译提示（`Game.ts`）

即使修复了 BFS，玩家仍可手动点击深水格触发此消息，应翻译为中文：

```typescript
// 当前代码（约 L4174）：
logger.log("No path found.", '#aaaaaa');

// 修改为：
logger.log(i18next.t('ui.no_path', { defaultValue: '无法到达该位置。' }), '#aaaaaa');
```

> `i18next` 已在 `Game.ts` 头部导入，可直接使用。

### 修改文件

仅需修改 `src/engine/Core/Game.ts` 两处：

| 位置 | 修改说明 |
|------|---------|
| `handleAutoExplore()` BFS 展开条件（约 L3829） | 添加 `nextCell.terrain !== TerrainType.WATER_DEEP &&` |
| `setAutoPath()` 报错消息（约 L4174） | `"No path found."` → `i18next.t('ui.no_path', { defaultValue: '无法到达该位置。' })` |

### 验证方式

1. 开启游戏，连续按 'x' 自动探索直到大部分地图被揭开
2. 确认不再出现 "No path found." 提示
3. 找到地图上的深水区域，鼠标点击深水格尝试寻路
4. 确认出现中文提示"无法到达该位置。"而非英文

---

## 需要修改的文件清单

### 问题 1-4（已修复，供参考）

| # | 文件路径 | 修改类型 | 涉及问题 | 状态 |
|---|---------|---------|---------|------|
| 1 | `src/engine/Core/Game.ts` | 重写 `updateHover()` + 新增 `getTerrainName()` + 新增 `handleInspectAt()` | 问题1,3,4 | ✅ 完成 |
| 2 | `src/components/GameCanvas.vue` | 添加 `rightclick` 事件 + 禁用浏览器右键菜单 | 问题1 | ✅ 完成 |
| 3 | `src/components/InventoryOverlay.vue` | 添加 `performInspect()` 和"查看详情"按钮 | 问题2 | ✅ 完成 |
| 4 | `src/components/Sidebar.vue` | 硬编码英文替换为中文 | 问题4 | ✅ 完成 |

### 问题 5（待修复）

| # | 文件路径 | 修改类型 | 涉及问题 | 状态 |
|---|---------|---------|---------|------|
| 1 | `src/engine/Core/Game.ts` | BFS 展开排除 WATER_DEEP + `setAutoPath` 提示翻译 | 问题5 | ❌ 待做 |

---

## 关键依赖和复用说明

### 已存在可直接复用的函数/组件

| 函数/组件 | 文件 | 用途 |
|----------|------|------|
| `generateMonsterDetail()` | `src/engine/UI/DetailGenerator.ts` L5-258 | 生成怪物详情数据 |
| `generateItemDetail()` | `src/engine/UI/DetailGenerator.ts` L261-381 | 生成道具详情数据 |
| `DetailPanel.vue` | `src/components/DetailPanel.vue` | 渲染详情弹出面板（轮询 inspectTarget） |
| `game.inspectTarget` | `src/engine/Core/Game.ts` L228 | 设置此值即可触发 DetailPanel 显示 |
| `Item.displayName` | `src/engine/Items/Item.ts` L65-119 | 尊重鉴定状态的名称 getter |
| `ItemLoader.translateName()` | `src/engine/Items/ItemLoader.ts` L72 | 名称翻译辅助函数 |

### generateMonsterDetail 参数参考

```typescript
// 已有调用示例：Game.ts L893-906
generateMonsterDetail(
    monster,                                        // Monster 对象
    this.player.hp,                                // 玩家当前 HP
    this.player.strength,                          // 玩家力量
    this.player.equippedArmor?.armor ?? 0,         // 护甲基础值
    [minDamage, maxDamage],                        // 玩家武器伤害范围
    this.player.equippedWeapon?.enchantment ?? 0,   // 武器附魔
    this.player.equippedWeapon?.strengthRequired ?? 12, // 武器力量需求
    this.player.equippedArmor?.armor ?? 0,         // 护甲值（重复参数）
    this.player.equippedArmor?.enchantment ?? 0,   // 护甲附魔
    this.player.equippedArmor?.strengthRequired ?? 12  // 护甲力量需求
)
```

### generateItemDetail 参数参考

```typescript
// 已有调用示例：Game.ts L926
generateItemDetail(item, this.player.strength)
```

---

## TerrainType 完整枚举参考

```typescript
// 文件: src/engine/Map/Grid.ts L9-36
export enum TerrainType {
    NOTHING = 0,    // 不应出现
    GRANITE,        // 花岗岩墙壁
    FLOOR,          // 地面
    WALL,           // 墙壁
    DOOR,           // 关闭的门
    OPEN_DOOR,      // 打开的门
    WATER_SHALLOW,  // 浅水
    WATER_DEEP,     // 深水
    CHASM,          // 深渊
    LAVA,           // 熔岩
    GRASS,          // 草地
    FOLIAGE,        // 植被
    BOG,            // 沼泽
    STAIRS_UP,      // 上行楼梯
    STAIRS_DOWN,    // 下行楼梯
    CHARRED_FLOOR,  // 烧焦的地面
    SIGN,           // 标牌
    RESET_PLATE,    // 重置压板
    TRAP,           // 陷阱
    SECRET_DOOR,    // 暗门（玩家不应看到此名称，发现后变为 DOOR）
    PRESSURE_PLATE, // 压力板
    LOCKED_DOOR,    // 锁住的门
    ALTAR,          // 祭坛
    WEB,            // 蛛网
    BLOOD,          // 血迹（视觉装饰，显示为"地面"即可）
    MUD             // 泥浆
}
```

---

## 验证方式

### 问题1验证（详情面板悬停触发）
1. 启动游戏，在地图上找到一个怪物
2. **右键点击**怪物所在的格子
3. 应弹出怪物详情面板，显示名称、HP、伤害、能力等
4. 按 Esc 或 x 关闭面板
5. 右键点击道具所在格子，应弹出道具详情面板

### 问题2验证（物品栏详情）
1. 按 'i' 键打开物品栏
2. 点击一个物品使其被选中
3. 点击"查看详情"按钮
4. 应弹出该物品的详情面板

### 问题3验证（未鉴定道具名）
1. 游戏开始时，在地图上找到一个未鉴定的卷轴或药水
2. 鼠标悬停在该道具上
3. 侧边栏视野信息应显示风味名（如"写着'飞庐'的卷轴"）而非真名（如"附魔卷轴"）
4. 拾起道具后物品栏中的名称应与之前悬停看到的一致

### 问题4验证（翻译完整性）
1. 鼠标悬停在地图各种地形上：地面、墙壁、水域、楼梯、门、陷阱等
2. 确认所有文字为中文，无英文残留
3. 确认侧边栏标签全部为中文：深度、生命、食物、状态、行动日志
4. 确认饥饿状态显示中文：饱食/饥饿/极度饥饿/虚脱
5. 悬停在未探索区域确认显示"未知"而非"Unknown"
6. 悬停在记忆区域确认显示"你记得在这里看到过..."

### 问题5验证（自动探索 No path found.）
1. 开启新游戏，持续按 'x' 键进行自动探索
2. 等待地图大部分被探索完成（特别是有水域的地图）
3. 确认行动日志中**不再出现** "No path found." 英文文字
4. 找到地图上的深水区域，用鼠标左键点击深水格尝试寻路
5. 确认出现中文提示"无法到达该位置。"

### 构建验证
```bash
cd /Users/coolking70/Documents/同步空间/brogue/brogue-web
npm run build
```
应零错误通过。
