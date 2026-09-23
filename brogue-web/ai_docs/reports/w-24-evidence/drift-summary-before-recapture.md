# 重捕获前漂移归因
改动前 test:drift 通过；改动后 test:drift 红（原始 JSON/log 已存）。
104 层中 25 层/91 字段变化：seed20260913 D2-D26；fp25/n21/species25/items20。
seed20260913 D1 第一次wand：旧empowerment（12725→12725，charge1）；新plenty（12725→12726，charge2）。D1观测字段未变，结束RNG计数12728→12729；自D2起连锁漂移。
424242 D11 与777 D4变种类/电量但同耗1次充能RNG，层级字段全不变；31337种类也不变。
受控反事实：仅将ItemLoader.genWands恢复HEAD五条旧顺序/频率，其他新代码全部保留，104层所有基线字段零差异。未观察到与本轮无关漂移。
已核验独立守卫：64seed×1000，共64000件；9种、频率22；实际计数125123=128000-2877（固定充能赋能只抽kind）。所有种类及充能范围通过6σ分布门；枚举22张票验证完整CE顺序。
原始baseline-before.json与候选baseline-candidate.json分别保存；本记录生成后才复制候选到滚动基线。
