# 领域模型

## 1. 文档目的与边界

本文负责定义当前核心领域对象、对象关系、职责和序列化边界。

本文不提供 OpenAPI 字段全集，不描述文件路径，不重复每条约束的权重，也不决定接口兼容策略。精确 JSON Schema 以 [`docs/openapi.yaml`](../openapi.yaml) 为准。

## 2. 对象关系

```text
Scenario
└── RoutePlan
    ├── SKU
    ├── POI
    ├── Depo
    ├── AgentEachDay ──> Ticket 链
    ├── Ticket ────────> Agent / POI / SKU / 依赖与关联 Ticket
    ├── TransitMatrix
    ├── RoutePlanConstraintConfiguration
    └── CostParameter

SolverJob ──> Scenario 名称快照 / 仅内存中的来源标识
          ├── RoutePlan 求解快照/结果
          ├── Status / 异常 / 分数说明
          └── SolutionMetrics 列表
```

## 3. 核心对象

### 3.1 Scenario

`Scenario` 是当前业务输入和已应用排程结果的容器，负责：

* 场景标识、名称、描述及规划时间范围；
* 持有一个 `RoutePlan`；
* 记录创建和更新时间；
* 判断 POI 与矩阵是否已经构建；
* 在兼容性检查通过后应用任务中的 `RoutePlan`。

运行实例只持久化一个当前 `Scenario`。再次保存表示替换当前对象。

### 3.2 RoutePlan

`RoutePlan` 同时承担求解输入与规划解职责，聚合：

* SKU、POI、仓库、按日 Agent 和 Ticket；
* 在途矩阵；
* 约束配置与成本参数；
* 当前分数和分数说明。

`init()` 把矩阵和成本参数注入 Agent，把矩阵注入 Ticket，并记录 Ticket 的原始 Agent 与原始顺序。对象引用的规范化由 `ScenarioReferenceNormalizer` 单独完成；`init()` 不负责重建索引、Ticket 链或其他派生关系。

### 3.3 Agent 与 AgentEachDay

`Agent` 描述车辆或工程师的静态能力和成本，例如位置、技能、资质、容量、车辆属性、固定成本和是否为虚拟 Agent。

`AgentEachDay` 表示某个规划日期上的可排程实体，包含当日班次、可用性和按顺序分配的 Ticket。求解器以它作为规划实体，而不是直接修改基础 `Agent` 定义。

### 3.4 Ticket

`Ticket` 是需要排程的服务任务，包含业务标识、固定标志、仓库、技能和资质要求、物料与容量需求、位置、时间范围和服务时长。规划关系包括：

* 当前与原始 Agent；
* 原始顺序；
* 前后 Ticket 链；
* 依赖和关联 Ticket；
* 由链和矩阵推导的到达时间。

### 3.5 POI、Depo、SKU 与 TransitMatrix

* `POI` 表示可被地址或坐标定位的位置。
* `Depo` 表示仓库或网点，并参与 Agent、Ticket 的归属约束。
* `SKU` 表示工单涉及的物料定义，Ticket 通过物料项引用它。
* `TransitMatrix` 保存位置之间的距离、时间和路线相关数据，是到达时间计算和路径成本评分的基础。

### 3.6 SolverJob

`SolverJob` 是一次异步求解的持久化记录，包含：

* 自身标识、来源场景名称，以及创建任务时保留在内存中的来源场景标识；`scenario_id` 的 getter 被 `JsonIgnore` 排除，因此该标识不出现在 REST/文件 JSON 中，重载后也不恢复；
* 求解用 `RoutePlan` 及其最佳或最终结果；
* 求解时长和矩阵、路线处理选项；
* 任务状态、分数说明和异常对象；当前异常对象使用 `ThrowableProxy`，可能包含堆栈信息；
* 过程指标以及创建、更新时间。

任务历史保留多个 `SolverJob`；最新任务指针只决定“当前任务”，不改变其他任务的历史身份。

### 3.7 SolutionMetrics

`SolutionMetrics` 是任务内的时间序列采样，区分更优解、搜索采样和最终解，记录采样时间、已用时间、分数和搜索统计。它从属于 `SolverJob`，不是独立存储资源。

## 4. 标识与引用规则

* Scenario 和 SolverJob 使用 UUID 标识。
* Agent、Ticket、POI、Depo、SKU 使用各自业务标识在 `RoutePlan` 内建立引用。
* 反序列化后必须把 Ticket 指向的 Agent、POI、依赖 Ticket 等恢复为 `RoutePlan` 中的规范实例。
* 应用任务结果时按业务对象集合验证兼容性，不能只因来源场景标识相同就跳过校验。

## 5. 序列化边界

* 场景与任务主体使用 JSON 持久化。
* `TransitMatrix` 从主体 JSON 分离，以 gzip JSON 单独持久化，读取时重新装配。
* 任务列表使用摘要对象，不加载完整任务方案。
* 接口返回哪些字段由 REST/MCP 契约负责；领域模型本身不保证自动裁剪矩阵或异常对象。
* 内存中的规范对象引用由归一化器恢复；`init()` 只注入计算依赖并记录原始指派信息，不应被理解为会重建全部求解链或派生结构。

## 6. 非目标

本文不定义新的实体、数据库表、跨场景共享对象或对外 DTO 分层，只记录当前模型。
