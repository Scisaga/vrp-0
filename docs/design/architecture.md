# 系统架构

## 1. 文档目的与边界

本文负责说明 vrp-0 当前后端、求解器、文件存储、地图适配器、MCP 和静态控制台之间的组件关系及主要调用流程。

本文不列出 REST 字段、每条求解约束、页面样式或部署命令，也不提出新的服务拆分方案。

## 2. 组件视图

```text
浏览器控制台 ─┐
REST 客户端 ──┼──> Quarkus Resource ──> VrpApplicationFacade
MCP 客户端 ───┘          │                       │
                         │                       ├──> ScenarioRepository ──> 场景文件
                         │                       ├──> SolverService ────────> OptaPlanner
                         │                       │        │
                         │                       │        └──> SolverJobRepository ──> 任务文件
                         │                       └──> 地图服务/位置补全 ────> MapAdapter
                         │
                         └──> 统一异常映射与 OpenAPI
```

静态控制台与 REST/MCP 服务由同一 Quarkus 应用交付。REST 和 MCP 最终复用应用门面，因而操作同一份当前场景与求解任务数据。

## 3. 后端分层

### 3.1 Resource 层

* `ScenarioResource`：当前场景的读取、保存、删除和可用 Agent 查询。
* `SolverJobResource`：最新任务、任务历史、启动、终止、应用和删除。
* `PoiResource`：POI 查询、地址解析和逆地址解析。
* `NodeResource`：根页面跳转、地图上下文、配额、矩阵以及 MCP 摘要和参考文档。

Resource 负责 HTTP 输入输出、OpenAPI 注解和状态码，不直接组织跨存储的业务事务。

### 3.2 应用服务层

* `VrpApplicationFacade`：组织场景、地图、矩阵和任务操作，执行前置条件检查并映射业务错误。
* `SingletonOperationCoordinator`：串行化场景替换、删除、启动求解和应用结果等互斥操作。
* `ScenarioLocationEnricher`：补全场景中的位置数据。
* `ScenarioReferenceNormalizer`：把反序列化后的重复对象引用归一到场景内的规范对象。
* `SolverService`：连接应用流程与 OptaPlanner，负责异步求解、进度、终止和回调。

### 3.3 持久化层

* `ScenarioRepository`：只保存一个当前场景。
* `SolverJobRepository`：保存任务索引、历史任务、最新任务指针、矩阵和过程指标。
* `FileStoreUtil` 与 `StoragePathResolver`：解析存储根目录并完成 JSON、gzip JSON 和原子替换。

存储细节见[数据存储](./data-storage.md)。

### 3.4 求解层

`RoutePlan` 是规划解，`AgentEachDay` 是规划实体，Ticket 的归属和顺序构成主要规划变量。`RoutePlanConstraintProvider` 计算 `HardMediumSoftLongScore`，变量监听器在链变化后更新到达时间。详细生命周期见[求解器设计](./solver.md)。

### 3.5 地图适配层

`MapAdapterSelector` 为当前运行配置选择地图适配器，现有适配器提供地址、路线和矩阵相关能力。主要地图调用通过选择器取得适配器；应用门面仍直接依赖具体适配器处理配置和浏览器地图上下文。Resource 不直接调用外部地图服务。

### 3.6 MCP 层

MCP Servlet 通过 Streamable HTTP 接收调用，认证过滤器执行 Bearer Token 检查，`McpServerRuntime` 注册 Tool 并将调用转交应用门面。Tool 契约见 [MCP 参考](../reference/mcp.md)。

### 3.7 静态控制台

控制台位于 `src/main/resources/META-INF/resources/static/`，使用 Alpine.js、Tailwind CSS、HTML 页面片段和原生模块。应用框架按 hash 路由加载页面片段，页面通过 REST 读写数据。

## 4. 主要流程

### 4.1 保存当前场景

1. Resource 接收场景及构建选项。
2. 门面在单例操作锁内确认没有运行中的任务。
3. 规范化对象引用并尝试补齐缺失的位置字段；普通保存中的位置解析失败只记录告警。
4. 显式启用构建选项时，校验地图能力并完整构建 POI 与场景矩阵。
5. Repository 将场景主体、元数据和矩阵分别原子写入当前目录。
6. 按明确的替换语义保存时清理既有任务历史，返回保存后的当前场景。

### 4.2 启动与完成求解

1. 门面确认当前场景存在，位置与矩阵完整，且没有运行中的任务。
2. `SolverService` 基于当前场景创建任务，先持久化调度中状态。
3. OptaPlanner 异步求解；更优方案和搜索采样持续写回任务仓库。
4. 正常结束后根据 `draw_route` 选择路线/矩阵后处理，生成分数说明并持久化最终状态；异常时保存错误状态。任务中的 `matrix_mode` 与 `build_transit_matrix` 当前只作为提交元数据记录，不参与该后处理分支。
5. REST、MCP 与控制台从任务仓库读取同一结果。

### 4.3 应用求解结果

1. 门面读取指定任务或最新任务。
2. 校验任务方案与当前场景的 Agent、Ticket 等对象兼容。
3. 将任务中的排程方案应用到当前场景并重新持久化。
4. 不兼容或缺失时保持当前场景不变并返回稳定错误。

## 5. 依赖方向与边界

* Resource 和 MCP 只通过应用门面进入业务流程。
* 应用服务可协调 Repository、Solver 和地图适配器；Repository 不反向调用 Resource。
* OptaPlanner 只处理规划模型和约束，不负责 HTTP、认证或文件布局。
* 控制台不直接访问文件存储，也不自行推导服务端状态。
* 进程内锁保护当前进程的并发写入，不等同于跨实例分布式协调。

## 6. 非目标

本文不提出新的组件、服务拆分或持久化方案，只说明当前单进程应用结构。
