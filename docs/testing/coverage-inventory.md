# 测试覆盖清单

## 1. 文档目的与边界

本文按测试层级和功能域记录当前测试覆盖范围与已知缺口，用于定位应运行或补充的测试。

本文不逐项复制测试方法，也不保存容易过期的固定测试数量。精确用例以 `src/test/` 源码为准，实际执行数量和结果以当次 Gradle、Node 或 Playwright 报告为准。测试任务和执行规则见[测试说明](../operations/testing.md)。

## 2. 测试层级

| 层级 | 位置或标签 | 当前职责 |
| --- | --- | --- |
| Unit | `src/test/java/unit` | 领域对象、约束、变量监听器、地图适配器纯逻辑、序列化、服务辅助逻辑 |
| App | `src/test/java/app`、`@Tag("app")` | Quarkus 进程内 Repository、REST、MCP 和应用门面流程 |
| External | `src/test/java/integration`、`@Tag("external")` | 真实地图服务、远程地址服务和真实求解联调 |
| Manual | `src/test/java/manual`、`@Tag("manual")` | 人工运行的报表、观察脚本和业务样例 |
| Script | `scripts/tests` | 本地开发控制脚本的环境隔离与进程清理 |
| Static UI | `src/main/resources/META-INF/resources/static/tests` | 页面逻辑、布局契约、场景导入、求解展示和 i18n |

## 3. Unit 覆盖

| 功能域 | 代表性测试类 | 当前覆盖重点 |
| --- | --- | --- |
| AMap/HERE | `AmapAdapter*Test`、`HereAdapterTest`、`MapProviderTest` | 配置、地址解析、路线、矩阵、降级和响应处理 |
| 地理与矩阵 | `GeoUtilTest`、`TransitMatrixTest`、`AddressUtilTest` | 距离、矩阵、地址和时间等纯逻辑 |
| 领域模型 | `ScenarioDomainTest`、`RoutePlanDomainTest`、`AgentEachDayDomainTest`、`TicketDomainTest` | 初始化、对象关系、可用性、结果应用和指派状态 |
| 求解约束 | `RoutePlanConstraintProviderTest` | 约束触发、分数和部分边界条件 |
| 规划链 | `ArrivalTimeUpdatingVariableListenerTest`、`InitialArrivalTimeCustomPhaseCommandTest` | 链变化、到达时间和初始阶段处理 |
| 求解生命周期 | `SolverServiceLifecycleTest`、`SolverServiceTimelineTest`、`SolverSearchProgressTrackerTest` | 调度、终止、指标采样和时间线 |
| 场景处理 | `ScenarioLocationEnricherTest`、`ScenarioReferenceNormalizerTest` | 位置补全和反序列化对象引用归一化 |
| 基础设施 | `StoragePathResolverTest`、`SingletonOperationCoordinatorTest`、`ExceptionMappersTest` | 路径解析、单实例互斥和错误映射 |

## 4. App 覆盖

| 功能域 | 代表性测试类 | 当前覆盖重点 |
| --- | --- | --- |
| 场景存储 | `ScenarioRepositoryTest` | 当前场景、矩阵拆分、状态恢复和删除 |
| 任务存储 | `SolverJobRepositoryTest` | 任务历史、最新指针、指标、状态重置和删除 |
| 场景 REST | `ScenarioResourceTest`、`ScenarioResourceAuxTest`、`ScenarioResourceRegressionTest` | 当前场景保存、替换、删除、运行中变更限制和回归场景 |
| 求解 REST | `SolverJobResourceTest` | 启动、查询、列表、终止、应用、删除和任务历史 |
| 节点与地图 REST | `NodeResourceTest`、`NodeHereResourceTest`、`PoiResourceDisabledTest` | `/quota`、`/map_context`、`/matrix`、MCP 摘要及地图不可用路径 |
| MCP | `McpServerTest` | Bearer Token、Origin、初始化、Tool 清单、调用和共享状态 |
| 错误映射 | `VrpApplicationFacadeExceptionMappingTest` | 门面到稳定业务错误的映射 |

当前求解终止接口按实现为 `POST /solver_job/terminate`；节点相关测试使用 `/quota`、`/mcp/meta` 和 `/mcp/doc`。

## 5. External 与 Manual

External 测试覆盖 AMap/HERE 真实服务、地址搜索、矩阵、场景创建和真实求解请求。它们默认关闭，必须显式启用并使用受控小请求。

Manual 测试用于报表、求解样例和人工观察，不计入稳定门禁。具备稳定业务断言的场景应优先下沉到 Unit 或 App，而不是扩充手工脚本。

Script 测试当前覆盖 `devctl.sh` 的运行环境隔离、`.env` 加载、非 daemon Gradle 启动参数，以及 PID 文件被 `gradle clean` 删除后扫描并清理 Gradle 启动链和 Quarkus 开发 JVM。

## 6. Static UI 覆盖

当前 Node/Playwright 脚本覆盖：

* 场景导入与已保存场景求解，缺失业务 ID 的自动生成与已有 ID 保留，缺失车辆成本字段的空白展示和请求省略，Gateway 创建前地址/坐标完整性校验，以及校验摘要的单项/多项文案、技术路径隐藏和手动关闭行为；顶部工具栏左右操作及保存、独立导入/导出按钮、删除分组，导入弹窗不提供手动格式化或全部折叠操作，场景表格的列宽范围、被截断信息列的优先扩展、剩余空间加权分配与编辑态锁定、浅色间隔行、操作按钮水平居中、位置与技能视觉区分、关联工单定位高亮、约束输入边界，以及仓库、车辆/工程师和工单坐标的直接编辑与 POI 位置同步；
* 任务列表最近七日默认筛选、靠右查询操作、名称展示且不展示任务 ID、`1600px` 桌面单屏列宽、三段式分数颜色及完成时间展示，日期时间输入的 24 小时制契约及月历/时分秒滚动选择交互、任务详情首次加载与空状态切换、运行态后台刷新及终态停止、详情布局（包括摘要值对齐、任务 ID 复制通知、去除自动刷新开关与请求参数复制、工具栏悬浮提示和按钮行底部阴影）、Gantt、原生深色地图、回放实际起止边界、覆盖物刷新与底图复用、右侧任务值等宽样式、大屏下一工单定位和分数过程；
* 中英文文案与浏览器交互，包括场景载重/重量与容积/体积表头单位、成本参数的非货币单位后缀与保底费“元/车次”后缀、结果成本单位、输入关联和窄屏适配；固定尺寸直接迁移后的 `16.25px` 正文、`37.5px` 控件、`1600px` 工作区断点及移动地图高度均有计算样式或布局断言；
* Scenario Web Component 构建产物和 Host 依赖校验。

视觉回归以 `1536×864 / DPR 1.25` 基线和 `1920×1080 / DPR 1.0` 目标截图进行物理像素对照；动态时钟和第三方地图底图不作为像素差异门禁。截图覆盖场景六页签、关键弹窗、任务列表、任务详情、一张图、地图接口和 MCP，临时原图及差异文件只保存在 `/tmp`，不进入仓库。

精确命令以静态资源目录的 `package.json` 为准。

## 7. 已知缺口

* 部分求解约束仍缺少非触发、空值、未指派和 justification 边界测试。
* `SolverJob` 的异常、指标和历史字段仍缺少更完整的纯领域测试。
* REST 对 malformed JSON、缺失字段和部分响应 Schema 的断言仍不完整。
* Repository 对损坏 JSON、缺失文件和不可写目录的错误路径覆盖仍有限。
* External 负向场景受真实服务成本和稳定性限制，不进入默认门禁。

这些缺口是测试维护信息，不自动构成产品需求或本次任务范围。

## 8. 更新规则

测试类职责或已知缺口变化时更新本文；不要重新加入逐方法清单或无报告来源的固定数量。测试任务、标签、门禁或执行命令变化时同时按[文档总览的更新规则](../README.md#6-更新规则)维护测试说明。
