# B1 轮：11 条 web 自创蓝图退池留形

> **本地执行（`codex exec --worktree`）。**

## 0. 三条教训（已连续四轮验证有效，继续照做）

- **0.1 闭包**：填活 DF 的 tile 要沿 `promoteType`/`fireType`/`propagationTerrain`/
  `subsequentDF` 四条边递归走完，对闭包内每个地形实跑普通与 fire 晋升要求 `deferred === null`
- **0.2 退池留形 = 加引擎过滤，不是改数据**——**本轮的主题就是它**，见 §2
- **0.3 覆盖门没有观测对象时换样本，不改期望**；换样本后也不钉精确台数

## 1. 输入：映射轮已定的 11 条

`bp-mapping` 轮（已合入 `a8a2cae`）给全部 80 条补了 `ceBlueprintId`，
并建了 `blueprint_ce_coverage.test.ts`。其中 **11 条 `ceBlueprintId === null`
且 `frequency > 0`**，合计权重 68，就是本轮的对象：

| id | freq | 最接近 CE | 映射轮给的自创判据（摘要） |
|---|---:|---:|---|
| `reward_library` | 8 | 3 | 3 个 feature 的卷轴小房，无 CE 3 的地毯/二选一/菌林/雕像 |
| `reward_consumables` | 10 | 3 | 同供药水与卷轴，无 CE 的二选一/地毯/菌林/雕像 |
| `vestibule_flammable` | 6 | 19 | 只有 GRASS 6-12 格，无堵门木栅与外置点火物 |
| `vestibule_guardian` | 7 | 25 | 只有随机怪，无守卫二选一与符文 |
| `vestibule_pit_traps` | 5 | 23 | TRAP/fire 3-6 格，无门/密门二选一与 TRAP_DOOR_HIDDEN |
| `key_rat_trap` | 8 | 29 | 直接生成 3-6 鼠与本房钥匙，无领养祭坛/麻痹气口/休眠鼠墙 |
| `key_fire_trap` | 6 | 32 | 仅 GRASS 与 TRAP/fire，无领养祭坛/喷火器/大水池/水怪 |
| `key_flood_trap` | 5 | 31 | 只直接铺浅深水，无可淹地板/开关祭坛/水池 DF/水怪 |
| `key_web_room` | 6 | 37 | 只铺 WEB 生成 spider，无领养祭坛/深渊/隐藏桥 DF |
| `key_lava_moat` | 4 | 38 | 只有 LAVA 8-20 格，无领养开关祭坛/回缩岩浆/逃生物品/拉杆 |
| `key_boss` | 3 | 57 | depth_boss + 护卫，无领养携物 horde/骨堆 DF/密门/发光菌 |

**全部 11 条的 CE 同主题版本都已在池中**（3、19、23、25、29、31、32、37、38、57），
所以退掉它们不会丢失玩法主题，只会去掉重复竞争者。

## 2. ⚠️ 先实测，再退池——这是本轮最重要的要求

映射轮报告自己提醒过：

> `frequency > 0` 只表示数据有权重，**不保证当前候选过滤实际允许被抽中**；
> B 轮仍需检查 category/领养过滤，不能用此表冒充活跃机器实测。

⇒ **退池之前，先测出这 11 条各自当前的真实建成频次。**

理由：若某条本来就抽不中（例如 `category` 决定它只能靠递归建立、
或被既有过滤挡住），退它是**空操作**。若不先测，
基线漂移的归因就脏了——你分不清某层的变化是"退了这条"还是"这条本来就没建过"。

**做法**：多 seed × D1-D26 扫一遍，统计每条的建成台数，写进报告。
然后退池，**用同样的样本复测**，给出退池前后对照。
**建成台数为 0 的条目要单独标出**——它们的退池是纯数据卫生，不影响生成。

## 3. 退池口径：照既有三个先例

`blueprintQualifies`（`BlueprintEngine.ts` 约 :640-660）已有三条先例：

```ts
if (bp.id === 'vestibule_secret_lever') return false;   // 18 号，等 wired lever
if (bp.ceBlueprintId === 52) return false;              // CE 52，等撞墙拉杆
if (bp.id === 'key_worm_tunnels') return false;         // 55 号，等隧道 DF tile
```

本轮加的是**第四类：web 自创**。建议用一个具名集合而不是逐条 `if`，
并在注释里写明：这些是 D2 口径的自创退池，**与上面三条"等机制"的退池性质不同**
（那三条将来机制落地就摘除；这 11 条是永久退池，除非判定推翻）。

**数据一律不动**——`frequency` / `flags` / `features` 全部保持原样，
`ceBlueprintId: null` 与 `ceOrigin` 也保持。**判别法：改数据能让守卫变绿，
往往说明你在改被守卫的那个事实本身。**

## 4. 守卫

映射轮的 `blueprint_ce_coverage.test.ts` 已钉覆盖集合与 null 项理由。
本轮再加一道**退池守卫**（放同一文件或新建，你定）：

1. 这 11 条**必须**被 `blueprintQualifies` 拒绝（对多个 depth 都测）
2. 它们的**数据仍完整**（`frequency` 非零、`features` 非空）——证明是退池不是删除
3. **反真空**：CE 同主题的那 10 条（3/19/23/25/29/31/32/37/38/57）**仍可被抽中**
   ——防止"整片被误退"却因为断言只看自创项而发现不了
4. 自创集合与 `ceBlueprintId === null` 的集合**全等**——将来新增自创蓝图
   忘了退池会红

第 3 条尤其重要：**它是这轮唯一能抓住"退多了"的守卫。**

## 5. 生成流会动——基线重捕获是最后一步

11 条退出抽签必然移动生成流。**重捕获放在所有改动之后**，之后
`npm run test:drift` 必须绿。报告里给出：变化层数、变化字段数，
以及 §2 的退池前后建成台数对照作为成因证据。

## 6. 本轮不做

- **CE 8 不补**。验收方已查清它卡在 9e：CE 8 是 `(BP_REWARD | BP_NO_INTERIOR_FLAG)`、
  **无 `BP_ROOM`**、`roomSize {0,0}`，在 CE 走区域机器分支（`Architect.c:1140-1205`，
  目标尺寸 0，features 全靠 `MF_BUILD_ANYWHERE_ON_LEVEL` 落在关卡别处）。
  而 web 没有区域机器路径，`findGateRoom` 要求 `roomSize[0] ≤ choke ≤ roomSize[1]`，
  `{0,0}` 永远找不到；web 现有 80 条也无任何 `roomSize [0,0]` 先例。
  硬落只会得到一条永远建不出来的蓝图。**并入 9e。**
- 映射轮登记的 E/D/L/I 类抄录错误（E31/E39/E44/E40/E71/F10/B55 等）——**留 B2**
- 区域机器路径、65/66——**9e**

## 7. 授权改动清单

- `src/engine/Generator/BlueprintEngine.ts`（仅 `blueprintQualifies` 加退池集合）
- `src/test/blueprint_ce_coverage.test.ts` 或新建退池守卫测试
- `src/test/fixtures/generation_baseline.json`（**仅最后一步重捕获**）
- 因生成流移动而撞红的既有测试

**明确不许改**：`src/data/blueprints.json` 的任何字段。
清单外改动必须申报。`BrogueCE-master/` **只读**。**守卫顺延不放宽**；
**行为断言**撞断 > 5 个停下来说明（穷举表连带不计入）。

## 8. 门禁跑法（本地）

跑退池守卫 + 覆盖守卫 + 以下会被生成流影响的：
`v_1a_blueprint_items`、`v_1b_alternative`、`v_1c_machine_structure`、
`v_2a_vestibule_return`、`v_2b_2a_placement_flags`、`v_2b_2b_blueprints`、
`v_2b_4_altars`、`v_2b_5_dormant`、`v_2b_6_keys`、`v_2b_7_features`、
`v_2b_9b_environment`、`v_2b_9c_effects`、`v_2b_9d_dungeon_profile`、
`blueprint_center`、`p1_20_item_placement`、`p1_26_invariants`、
`p1_31_35_placement_snapshot`、`p1_33_machine_chokepoint`、
`p1_37_machine_flag_i18n`、`b_4b_item_placement`、`c_6_autogenerators`、
`c_8_connectivity`、`invented_content_pool`

⚠️ **不要跑不带参数的全量 `npx vitest run`**——会和验收方抢核。
`npm run build` 要跑；重捕获后 `npm run test:drift`。

**最终复跑（硬要求）**：所有编辑完成后重跑上述全部，给逐文件结果并声明
**「这是最终状态下的运行结果，不是中途快照」**。
（你已连续三轮用复跑前后 SHA-256 自证无中途编辑——**继续**。）

## 9. 授权反驳

**§1 那 11 条的自创判据是映射轮给的，本轮请复核。** 若发现某条其实是
合法 CE 身份（就像映射轮救回的 `key_statuary` = CE 43），**驳回并给行号**，
本轮不退它。

⚠️ 特别注意 `key_rat_trap`：它在 V-2b-6 被登记为**真死局**
（web 自创、缺 `MF_ADOPT_ITEM`，领养的钥匙被静默丢弃）。
查清它当前是否已被别的机制挡住——若是，本轮的退池对它是空操作，如实说明。

**对抗性要求**：§4 第 3 条"反真空"断言必须回答——
**如果我把退池集合写成整个 key_guard 类别，这条会不会红？** 会才算合格。

## 10. 报告

写到 `ai_docs/reports/b1-retire-invented.report.md`，含：

1. **§2 退池前后的建成台数对照表**（本轮最重要的证据）
2. §9 的复核结果：11 条判据是否都成立，有没有该救回的
3. 退池实现位置与注释（如何区分"等机制"与"永久自创"两类）
4. §4 四条守卫各自「什么缺陷下会翻红」，特别是第 3 条的对抗性回答
5. §5 基线重捕获：变化层数/字段数，以及与 §2 对照表的呼应
6. **§8 的最终复跑声明**
7. 清单外改动申报
