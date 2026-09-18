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
| Script | `scripts/tests` | 本地开发控制脚本的环境隔离与进程清理，以及 MCP 结果展示离线契约 |
| Static UI | `src/main/resources/META-INF/resources/static/tests` | 页面逻辑、布局契约、场景导入、求解展示和 i18n |
| MCP Apps UI | `src/test/mcp-ui` | 独立 View 的纯模型、协议桥、图商适配、构建校验及模拟宿主浏览器测试；不含真实 Gateway 或四宿主联调 |

## 3. Unit 覆盖

| 功能域 | 代表性测试类 | 当前覆盖重点 |
| --- | --- | --- |
| AMap/HERE | `AmapAdapter*Test`、`HereAdapterTest`、`MapProviderTest` | 配置、地址解析、路线、矩阵、降级和响应处理 |
| 地理与矩阵 | `GeoUtilTest`、`TransitMatrixTest`、`AddressUtilTest` | 距离、矩阵、地址和时间等纯逻辑 |
| 领域模型 | `ScenarioDomainTest`、`RoutePlanDomainTest`、`AgentEachDayDomainTest`、`TicketDomainTest` | 初始化、对象关系、可用性、结果应用和指派状态 |
| 求解约束 | `RoutePlanConstraintProviderTest` | 约束触发、分数、技能要求空数组和部分边界条件 |
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

`scripts/tests/test_mcp_result_view_contract.py` 单独验证 Issue #183 的 MCP 结果展示契约，覆盖标准 JSON Schema、跨字段语义和 test-only 参考投影的 golden mapping。样例位于 `docs/integrations/gateway/fixtures/mcp-result-view/`，重点包括白名单及未知字段隔离、ID 与引用完整性、`null`/空集合、历史坐标口径、计划时间、路线段位和回放资格、可确定的只读计数与缺失数据降级；范围及外部未决项见 [MCP 结果展示投影契约](../components/mcp-result-view-contract.md)。该离线契约本身不执行页面或生产 Gateway；页面的独立模拟验证见 §6.1，Python 运行命令见[测试说明](../operations/testing.md#41-mcp-结果展示离线契约)。

## 6. Static UI 覆盖

当前 Node/Playwright 脚本覆盖：

* 场景导入与已保存场景求解，缺失车辆成本字段的空白展示和请求省略，以及校验摘要的单项/多项文案、技术路径隐藏和手动关闭行为；顶部工具栏左右操作及保存、独立导入/导出按钮、删除分组，导入弹窗不提供手动格式化或全部折叠操作，场景表格的列宽范围、被截断信息列的优先扩展、剩余空间加权分配与编辑态锁定、浅色间隔行、操作按钮水平居中、位置与技能视觉区分、关联工单定位高亮、约束输入边界，以及仓库、车辆/工程师和工单坐标的直接编辑与 POI 位置同步；
* 任务列表最近七日默认筛选、靠右查询操作、名称展示且不展示任务 ID、`1600px` 桌面单屏列宽、三段式分数颜色及完成时间展示，日期时间输入的 24 小时制契约及月历/时分秒滚动选择交互、任务详情首次加载与空状态切换、运行态后台刷新及终态停止、详情布局（包括摘要值对齐、任务 ID 复制通知、去除自动刷新开关与请求参数复制、工具栏悬浮提示和按钮行底部阴影）、Gantt、原生深色地图、回放实际起止边界、静态覆盖物复用与动态 Marker 原位更新、底图复用、右侧任务值等宽样式、大屏下一工单定位和分数过程；
* 中英文文案与浏览器交互，包括场景五类表格全部列头的语义 key 完整性及英文→中文→英文切换时原位更新、三类地址单元格解析按钮在预览与编辑状态中的双语切换、载重/重量与容积/体积表头单位、成本参数的非货币单位后缀与保底费“元/车次”后缀、结果成本单位、输入关联、窄屏适配，以及大屏内联 Logo 的浏览器解码；固定尺寸直接迁移后的 `16.25px` 正文、`37.5px` 控件、`1600px` 工作区断点及移动地图高度均有计算样式或布局断言；
* Scenario Web Component 构建产物、内联 Logo 和 Host 依赖校验。

视觉回归以 `1536×864 / DPR 1.25` 基线和 `1920×1080 / DPR 1.0` 目标截图进行物理像素对照；动态时钟和第三方地图底图不作为像素差异门禁。截图覆盖场景六页签、关键弹窗、任务列表、任务详情、一张图、地图接口和 MCP，临时原图及差异文件只保存在 `/tmp`，不进入仓库。

精确命令以静态资源目录的 `package.json` 为准。

### 6.1 独立 MCP Apps View

独立 View 的验证与旧 Scenario/控制台分开，命令和隔离规则见[测试说明](../operations/testing.md#81-独立-mcp-apps-view)，源码及交付状态见[组件说明](../components/mcp-app.md)。以下记录测试职责，不代表尚未执行的真实外部链路已通过。

| 测试文件/层次 | 当前覆盖重点 |
| --- | --- |
| `model.test.mjs` | 从人工 canonical goldens 导出的 JavaScript/Python 分析 parity；标量、空集合与未知集合、实体身份、归属、不可播放原因、不变异；无时区业务轴、日历/DST/早期年份与 Java Duration 边界；回放阶段、零距离、零时长、无返程、吸附原几何、跨经度和合成大数据 |
| `bridge.test.mjs` | 协议处理器注册/连接时序、版本化只读工具调用、外层身份与错误分支、显式刷新、迟到响应、输入和通知覆盖、取消、长 ID、宿主显示模式及资源清理 |
| `maps.test.mjs` | provider/URL/origin 防错、历史 LOC 转换、原路线索引、路线来源区分、坏几何整段不可用、POI 缺失、纯文本标记、AMAP complete 超时、HERE 样式错误/监听解除及覆盖物生命周期 |
| `build.test.mjs` 与 `verify:mcp-app` | 严格 manifest 与精确 HTTPS origin、无隐式批准、standalone Schema 校验、浏览器依赖闭包、第一方代码约束、单文件产物、确定性和过期检测 |
| `bridge.spec.mjs` | Chromium 中生产内联 HTML/官方 SDK 的握手、无普通动态求值 CSP、非父窗口消息拒绝、协议/身份校验、刷新竞态、取消恢复、长 ID、全屏拒绝、teardown ACK、双卡隔离和认证/权限失败清理 |
| `viewer.spec.mjs` | AMAP/HERE SDK 替身中的选择与工单联动、HERE 克隆事件及原几何、规划回放边界/暂停和静态覆盖物复用、地图策略失败保留 Gantt、AMAP complete 超时/HERE 样式错误、SDK 延迟加载与刷新竞态、窄屏/主题/语言/键盘、XSS、已知空/未知集合、Gateway 非就绪/终态无模型展示、不可播放向量与合成大数据 |
| `edge-cases.spec.mjs` | 部分工程师可播放、缺失引用原序号、零时长服务/零距离段、同任务刷新保留选择/视角/游标、Gantt 滚动保持、浏览器时区/DST 一致、失败手动重试不轮询、缺失工程师与窄屏键盘焦点 |

该组测试不读取开发任务数据或真实地图凭据，不引入默认外部地图调用。模型参考 helper 只用于测试，不进入浏览器构建，也不充当 Gateway 生产投影。模拟宿主验证与离线契约相互补充；SDK 替身不证明真实瓦片、鉴权、HERE worker/WASM 或客户端安全策略可用。

## 7. 已知缺口

* 部分求解约束仍缺少非触发、空值、未指派和 justification 边界测试。
* `SolverJob` 的异常、指标和历史字段仍缺少更完整的纯领域测试。
* REST 对 malformed JSON、缺失字段和部分响应 Schema 的断言仍不完整。
* Repository 对损坏 JSON、缺失文件和不可写目录的错误路径覆盖仍有限。
* External 负向场景受真实服务成本和稳定性限制，不进入默认门禁。
* MCP Apps 的 Gateway 生产投影、资源发布与鉴权、批准 CSP、真实地图网络/公开 key 限制及四个真实宿主联调不在本仓离线和模拟测试覆盖内；独立页面的本仓验证单列于 §6.1，不能据此标记 Issue #183 生产上线完成。

这些缺口是测试维护信息，不自动构成产品需求或本次任务范围。

## 8. 更新规则

测试类职责或已知缺口变化时更新本文；不要重新加入逐方法清单或无报告来源的固定数量。测试任务、标签、门禁或执行命令变化时同时按[文档总览的更新规则](../README.md#6-更新规则)维护测试说明。
