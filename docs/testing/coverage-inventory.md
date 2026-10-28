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
| MCP Apps UI | `src/test/mcp-ui` | 独立 View 的纯模型、协议桥、图商适配、构建校验及模拟宿主浏览器测试；另有显式启用的真实 Gateway/AMAP 本地联调，不含四个真实宿主验收 |

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

`SolverSearchProgressTrackerTest` 的合成指标状态在测试注册表中保留强引用，保证 hard/medium/soft 值不随 GC 偶发丢失；生产采样逻辑及多任务隔离断言保持不变。

## 4. App 覆盖

| 功能域 | 代表性测试类 | 当前覆盖重点 |
| --- | --- | --- |
| 场景存储 | `ScenarioRepositoryTest` | 当前场景、矩阵拆分、状态恢复和删除 |
| 任务存储 | `SolverJobRepositoryTest` | 任务历史、最新指针、指标、状态重置和删除 |
| 场景 REST | `ScenarioResourceTest`、`ScenarioResourceAuxTest`、`ScenarioResourceRegressionTest` | 当前场景保存、替换、删除、运行中变更限制和回归场景 |
| 求解 REST | `SolverJobResourceTest` | 启动、查询、列表、终止、应用、删除和任务历史 |
| OpenAPI 契约 | `OpenApiLocationContractTest` | 运行时、发布文件与 Gateway 镜像元数据版本一致，以及地点必填性、双编码说明及集中式示例一致性 |
| 节点与地图 REST | `NodeResourceTest`、`NodeHereResourceTest`、`PoiResourceDisabledTest` | `/quota`、`/map_context`、`/matrix`、MCP 摘要及地图不可用路径 |
| 稳定测试地图隔离 | `StableMapConfigurationTest` | 默认 AMAP 选择、合成 key、本地矩阵前置条件、HERE 禁用及位置补全替身启用；开发环境或 `.env` 不得使稳定测试访问真实图商，专项合成 Profile 保持可用 |
| MCP | `McpServerTest` | Bearer Token、Origin、初始化、Tool 清单、调用和共享状态 |
| 错误映射 | `VrpApplicationFacadeExceptionMappingTest` | 门面到稳定业务错误的映射 |

当前求解终止接口按实现为 `POST /solver_job/terminate`；节点相关测试使用 `/quota`、`/mcp/meta` 和 `/mcp/doc`。

## 5. External 与 Manual

External 测试覆盖 AMap/HERE 真实服务、地址搜索、矩阵、场景创建和真实求解请求。它们默认关闭，必须显式启用并使用受控小请求。

Manual 测试用于报表、求解样例和人工观察，不计入稳定门禁。具备稳定业务断言的场景应优先下沉到 Unit 或 App，而不是扩充手工脚本。

Script 测试当前覆盖 `devctl.sh` 的运行环境隔离、`.env` 加载、非 daemon Gradle 启动参数，以及 PID 文件被 `gradle clean` 删除后扫描并清理 Gradle 启动链和 Quarkus 开发 JVM。

`scripts/tests/test_gateway_metadata_layout.py` 验证 Gateway 导入文件与文档资料的目录分离、生成器默认目录和自定义元数据目录输出，以及地点双编码、条件可选 `plan.pois`、集中式示例引用和参考 Schema 一致性；测试使用临时目录，不读写业务数据。

`scripts/tests/test_mcp_result_view_contract.py` 单独验证 Issue #183 的 MCP 结果展示契约，覆盖标准 JSON Schema、跨字段语义和 test-only 参考投影的 golden mapping。样例位于 `docs/integrations/gateway/fixtures/mcp-result-view/`，重点包括白名单及未知字段隔离、ID 与引用完整性、`null`/空集合、历史坐标口径、计划时间、路线段位和回放资格、可确定的只读计数与缺失数据降级；范围及外部未决项见 [MCP 结果展示投影契约](../components/mcp-result-view-contract.md)。该离线契约本身不执行页面或生产 Gateway；页面的独立模拟验证见 §6.1，Python 运行命令见[测试说明](../operations/testing.md#41-mcp-结果展示离线契约)。

## 6. Static UI 覆盖

当前 Node/Playwright 脚本覆盖：

* 场景导入与已保存场景求解，缺失车辆成本字段的空白展示和请求省略，以及校验摘要的单项/多项文案、技术路径隐藏和手动关闭行为；顶部工具栏左右操作及保存、独立导入/导出按钮、删除分组，导入弹窗不提供手动格式化或全部折叠操作，场景表格的列宽范围、被截断信息列的优先扩展、剩余空间加权分配与编辑态锁定、浅色间隔行、操作按钮水平居中、位置与技能视觉区分、关联工单定位高亮、约束输入边界，以及仓库、车辆/工程师和工单坐标的直接编辑与 POI 位置同步；
* 任务列表最近七日默认筛选、靠右查询操作、名称展示且不展示任务 ID、`1600px` 桌面单屏列宽、三段式分数颜色及完成时间展示，日期时间输入的 24 小时制契约及月历/时分秒滚动选择交互、任务详情首次加载与空状态切换、运行态后台刷新及终态停止、详情布局（包括摘要值对齐、任务 ID 复制通知、去除自动刷新开关与请求参数复制、工具栏悬浮提示和按钮行底部阴影）、Gantt、原生深色地图、回放实际起止边界、静态覆盖物复用与动态 Marker 原位更新、底图复用、右侧任务值等宽样式、大屏下一工单定位和分数过程；
* 中英文文案与浏览器交互，包括场景五类表格全部列头的语义 key 完整性及英文→中文→英文切换时原位更新、三类地址单元格解析按钮在预览与编辑状态中的双语切换、载重/重量与容积/体积表头单位、成本参数的非货币单位后缀与保底费“元/车次”后缀、结果成本单位、输入关联、窄屏适配，以及大屏内联 Logo 的浏览器解码；固定尺寸直接迁移后的 `16.25px` 正文、`37.5px` 控件、`1600px` 工作区断点及移动地图高度均有计算样式或布局断言；
* Scenario Web Component 构建产物、内联 Logo 和 Host 依赖校验。

视觉回归以 `1536×864 / DPR 1.25` 基线和 `1920×1080 / DPR 1.0` 目标截图进行物理像素对照；动态时钟和第三方地图底图不作为像素差异门禁。截图覆盖场景六页签、关键弹窗、任务列表、任务详情、一张图、地图接口和 MCP，临时原图及差异文件只保存在 `/tmp`，不进入仓库。

精确命令以静态资源目录的 `package.json` 为准。

### 6.1 双资源 MCP Apps View

双资源验证与旧 Scenario/控制台分开；命令见[测试说明](../operations/testing.md#81-独立-mcp-apps-view)，边界见[组件说明](../components/mcp-app.md)。

| 测试文件/层次 | 当前覆盖重点 |
| --- | --- |
| Python 契约 | 同一 59-case 集合的 Map/Gantt 两组 golden、诊断与语义；唯一 Schema；引用 POI 裁剪；Map 几何/回放与 Gantt 空几何/保序段位分离；200/1,000/4,097 大向量 |
| `model.test.mjs` | 标量、空/未知集合、身份、归属、时间轴、Map 回放资格、阶段边界、原始几何与大结果 |
| `bridge.test.mjs` | 两种固定工具名与输入 Schema、信封 view/版本/任务/工程师边界、显式刷新、单次 `ui/message`、取消、竞态、显示模式和 teardown |
| 地图 Node | 原安全模型/路线语义、SVG context、Mercator 投影、元素映射与白名单；旧 SDK/iframe 仅作历史源码回归 |
| `build.test.mjs` / `verify:mcp-app` | SVG render_mode、Map/Gantt 两产物、自包含/确定性/4 MiB、无 renderer/图商网络闭包，SDK/jitless/Ajv 与安全拒绝 |
| Playwright | SVG 图片/安全/点击/署名、筛选/缩放/平移/fit/全屏/回放、零浏览器网络/iframe/动态编译、多卡片及权限清理；Gantt 全量原行为回归 |

模拟测试不读取真实任务或密钥，不证明真实图商授权、目标宿主 data 图片或四客户端验收。首版固定全任务快照，不包含视口出图接口。

Map 路线取景图标回归覆盖图标与本地化可访问名称保留、悬浮/聚焦提示、提示悬浮与 Escape 关闭/恢复、窄屏/全屏边界、既有适配调用及筛选保留、未就绪禁用和销毁清理。

Map 页脚移除回归覆盖桌面/窄屏、会话/全屏、筛选及双语/主题切换后无只读说明行或占位，页面底部紧接 Gantt 入口区域，既有查看意图与规划回放提示保持。

Gantt 展示回归覆盖短地址保守预处理、名称/未知回退、地点与真实服务时长、完整信息详情、无底框行程标注及真实区间几何、斜纹等待带、规则刻度/网格、键盘选择与缩放按钮移除、行高与工单条高度、虚拟工程师展示过滤、未知类型保留、时间/日期分区、左侧计划执行范围（同班次不同完成时间、有效阶段回退、提前服务、无工单/缺失阶段、原页面范围优先级对照、同日/次日/多日、未知日期）及完整时间提示、详情班次起止、执行范围信息不换行/裁切及左列对齐、单工程师详情与宿主高度收缩、多行滚动、页脚移除，以及全屏、窄屏、双语、跨日和选中对象变为虚拟后的清理。

Gantt 图例/筛选合并回归同时检查桌面/窄屏的同行左右位置、无独立筛选行、双语可访问名称、页头对象列表入口，以及未选择/清除选择时空详情无注释、选择后详情恢复。


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

### Gateway 展示工具短名称切换

MCP Apps 的 Node 桥测试、Python 合成契约和模拟页面测试覆盖新短名称、完整版本 ID、Map/Gantt 视图身份、刷新及旧名称拒绝；自动化结果以本次实际执行记录为准。Quick 真机调用与卡片渲染分别验收，未执行时标记未验证。

### SVG 高清与视口/路线补充覆盖

新增像素密度与视口约束纯函数测试、1×/1.5×/2× PNG/JPEG 图片和 DPR 浏览器测试及未知/不同比例的拒绝。补充极端画幅完整取景、边缘/缩放/resize/回放统一约束及路段仅高亮的鼠标/键盘/隔离验证，验证选择与清除高亮不暂停正在运行的回放。具体执行结果写入测试说明；默认夹具不代表真实图商或宿主验收。

补充明暗主题下路段鼠标/键盘焦点无默认矩形框、沿线衬线与画布键盘焦点保留；中英文会话/全屏缩放上限与触边引导、模式切换后提示更新及未变化内容的播报去重回归。

中英文缩放/触边提示按会话与全屏四种状态校验完整文案，只保留限制和操作引导，不追加范围或细节不会增加的解释。
