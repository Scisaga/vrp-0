# MCP 结果展示投影契约

## 1. 状态与范围

**状态：双 Profile 安全展示契约与离线验证；不是 Gateway 生产投影实现。** 本文承接 [Issue #183](https://git.sefo.cc:233/x-force/vrp-0/-/issues/183) 的字段、映射与 fixtures；Map/Gantt 双资源实现见[独立 MCP Apps 查看器](mcp-app.md)，不能据此宣称真实 tag 导入、地图网络或四个宿主已经验收。

契约产物包括：

* [`docs/integrations/gateway/mcp-result-view-schema.json`](../integrations/gateway/mcp-result-view-schema.json)：Draft 2020-12 安全 `engine_view` 对象 Schema。
* [`docs/integrations/gateway/fixtures/mcp-result-view/`](../integrations/gateway/fixtures/mcp-result-view/)：人工合成源结果与人工编写的期望投影。
* [`scripts/tests/test_mcp_result_view_contract.py`](../../scripts/tests/test_mcp_result_view_contract.py)：标准 Schema、语义和 golden mapping 三层离线验证。
* [`scripts/tests/mcp_result_view_support.py`](../../scripts/tests/mcp_result_view_support.py)：仅用于测试的参考投影与分析，不是生产代码。

本轮未修改原 `scenario.html`、引擎 REST/MCP、`docs/openapi.yaml` 或既有 [`gateway/result-summary-schema.json`](../../gateway/result-summary-schema.json)。`gateway/image-version.yaml` 已切换为双资源声明；本文继续只负责唯一安全模型和双 Profile 参考测试，不以浏览器实现替代 Gateway 服务端白名单投影、授权或联合验收。

## 2. 与 Gateway 外层契约的关系

Gateway 的权威公共契约是其 `docs/design/mcp-apps-contract.md`；工具、产物与 UI 语义分别由该仓对应 API、ImageVersion 和 MCP Apps UI 文档负责。Issue #183 附有原文快照及 SHA-256。本文件只负责该交接中 `engine_view` 的安全白名单与引擎映射，不另行定义 Gateway 工具、鉴权、传输或资源发布规则。

固定外层语义包括 `_meta.gateway_ui.contract_version=gateway_mcp_result_v1`，Gateway `job_id`/`image_version_id`、当前资源固定 `display_tool_name`/`view`、`result_state`、`engineer_id`、`platform_timezone`、白名单 `task`、固定 `result_summary=null`、`engine_view` 与 `map_context`。Map 工具为 `gateway.ui.map_result_<32hex>`，Gantt 为 `gateway.ui.gantt_result_<32hex>`；只有成功展示态允许非空模型，Gantt 的工程师定位固定为空。

本文 Schema 的根是**非空 `engine_view` 对象**，不是整个 tool result，也不允许根 `null`；Gateway 外层允许 `engine_view=null`。参考投影不能形成安全模型时返回 `null` 并附测试诊断，调用者不能拿空根对象伪装成功。测试诊断和分析结果不新增 wire 字段。

以下事项仍由 Gateway 对接确认，不能用样例猜测生产行为：

| 事项 | 本次边界 |
| --- | --- |
| `result_summary` | 样例使用 `null`。现有声明要求的路线数/工单数不等于 Gateway 当前归档摘要的实际 shape；不能直接引用旧摘要或补零，也不能把参考分析结果写入外层摘要 |
| `task` | 仅采用 Issue 的安全白名单；不引用整个 `SolverJobDetail`，不增加创建人、内部实例、归档、约束或写操作字段 |
| `map_context` | Map 的公开 browser key 和批准来源由 Gateway 决定；Gantt 只保留 provider/locale，固定禁用，并令 `browser_key=""`、`js_url=""`、`css_url=null` |
| 错误 `details` | Issue 的 `display_tool_name/supported_views` 对象访问方式与现有 Gateway 数组型错误详情需要对齐；本次不改错误封装 |
| 状态映射 | 不新增任务状态；非成功状态固定 `engine_view=null`，不能携带等待模型 |
| 工程师输入上限 | 输出工程师 ID 不截断；超过 128 字符的初始工具定位仍受 Gateway 现有输入限制。本地选择不受影响；只读刷新可省略可选 `engineer_id` 并保留本地选择，本次不修改工具输入限制 |
| 规模与网络 | HTML 默认上限为每资源 4 MiB，Gateway 结果默认上限为 8 MiB；超限明确失败、不截断，不补 CSP 通配来源或实际地图凭据 |

## 3. 安全对象与源码映射

### 3.1 固定根与身份

`engine_view` 固定包含 `kind="vrp0"`、`schema_version=2`、`display_model="vrp0_solver_job"` 和 `solver_job`。它沿用已有展示模型的标识，但不允许把现有网页模型整体复制进来。

`solver_job.id` **只取调用方已鉴权的 Gateway job ID**，覆盖引擎源结果里的任务 ID；不得保留内部任务 ID 作为页面主身份或跳转依据。日工程师、工单、POI ID 均是不透明字符串，不按名称匹配，不截断、hash、猜测或拆日期后缀。

### 3.2 字段白名单

下表列出允许字段；精确类型、枚举与数值范围以 Schema 为准。每个对象封闭，声明字段都必须出现；缺失且允许为空的值明确为 `null`，不顺带保留其他源字段。

| 对象 | 允许字段 | 来源与限制 |
| --- | --- | --- |
| `solver_job` | `id, name, status, start_date_time, end_date_time, plan` | `db/dto/SolverJob`；仅 `id` 由 Gateway 覆盖，名称和时间不从其他字段猜测 |
| `plan` | `agents, tickets, pois` | `domain/RoutePlan`，保留已有业务集合，不传整个规划对象 |
| agent | `id, name, date, virtual, shift_start_time, shift_off_time, tickets_done_time, start_loc, tickets, routes` | `domain/agent/AgentEachDay`；`tickets` 保留执行顺序，位置和工单关系规范为 ID 引用 |
| ticket | `id, type, status, agent, loc, min_start_time, max_end_time, arrival_time, start_service_time, departure_time, duration` | `domain/ticket/Ticket` 的公开结果字段；归属和位置规范为 ID，不带约束与业务自由文本全集 |
| POI | `id, name, address, location` | `geo/POI` 的受控公开位置；不包含图商完整响应、联系方式或附属元数据 |
| route | `origin, destination, polyline, route_source, transit` | `geo/Route`；去除通行费、路径服务失败记录及其他非白名单字段 |
| transit | `distance, duration` | `geo/transit/Transit`，分别为米和秒；不保留生成时间 |
| legacy LOC | `lat, lon` | 保持源 `geo/LOC` 的历史字段顺序，见坐标规则 |

矩阵、约束、成本、技能资质、原请求、归档信息、异常堆栈、图商原始响应和 `routing_failures` 均不进入投影，无论它们出现在顶层还是嵌套对象中。

源字段映射采用引擎实际 snake_case 序列化，不兼容性猜测任意别名。`SolverJob.name` 在常规创建时是时间标签，但归档或等待模型也可能包含用户文本；它与工程师名称、POI 名称及地址一样只可作为不可信纯文本展示，不作为 HTML、URL、工具名或指令。缺名时 UI 可使用 Gateway ID，不扩大投影到 `scenario_name`。

### 3.3 空值、身份与引用

* `plan` 缺失、`null` 或不能形成对象时，不构造假计划：`engine_view=null`，测试诊断为 `missing_plan`。
* 集合缺失为 `null`；已知空集合为 `[]`，两者不可互换。字段未知、非法或不可安全表达时保留明确空值/诊断，不能补默认零、时间或位置。
* 实体 ID 缺失、同一 `plan` 集合内重复 ID，以及同一 POI 的非空公开字段冲突不能悄悄采用“最后一个”，参考投影拒绝形成模型。
* 内联 POI 与已有 POI 的同 ID 非空字段一致时可以合并补全；不能覆盖冲突值。关联不完整时保留缺失事实，不能创建虚构工单、POI 或归属。
* 工程师的有序 `tickets` 必须是非空字符串 ID 的数组；含非法项时整个序列为 `null`，不能删项后伪装完整排程。合法但悬空的字符串 ID 原样保留并报告 `unknown_reference`，不改成另一对象或“未指派”。
* `ticket.agent` 省略或原始 `null` 保持未指派语义；非空原始值若类型非法或 ID 为空白，则拒绝形成 `engine_view` 并报告 `invalid_type/invalid_value`。不能先把坏归属变成 `null`，再将其误计为未安排工单。
* 路线数组允许空段位，必须保留原索引。非法折线中的任一点使整条 `polyline` 不可用，不能过滤坏点后把剩余点拼成新的道路轨迹。
* `AgentEachDay` 的常规 ID 是原 ID 加 `-yyMMdd`，但源 ID 无 128 字符上限，不能据此反向解析身份或给输出 schema 加同样上限。

### 3.4 同一 Schema 的双 Profile

两种 Profile 不复制 Schema 或协议，只裁剪同一安全对象：

* **Map**：`pois` 只保留工程师起点或工单位置实际引用项；路线保留坐标、端点、折线、来源和度量，并执行 §4 的地图几何与回放资格分析。
* **Gantt**：`pois` 同样只保留时间轴/右栏引用项，但 `location` 固定为 `null`。`agent.routes=null` 表示未知；非空数组完整保留长度、顺序和 `null` 空段，只保留合法 `route_source`，每个非空路线的 `origin/destination/polyline/transit` 固定为 `null`。Gantt 校验身份、引用、顺序、班次、计划时间、路线段位和来源，不运行地图几何或回放资格分析。

因此 Gantt 中契约性空坐标和空路线几何不是错误，也不能被页面重新补全。两种 Profile 都不得输出未引用 POI。

## 4. 坐标、时间和路线语义

### 4.1 历史坐标字段

`POI.location` 保持引擎的 `经度,纬度` 文本。仅对 **Route 中的历史 `LOC`**，字段名与使用语义不一致：`lat` 保存经度、`lon` 保存纬度。投影保持原字段和数值，不交换字段来“修正” wire；后续地图适配必须显式按该历史口径转换。此约定不能套用到 `POI.loc`；POI 不投影该对象，也不在 `location` 缺失时从它或入口坐标猜测补值。

值必须可解析、有限且处于对应地理范围。`location` 的两段文本去除首尾空白后，只接受 ASCII 十进制数字（允许正负号、小数和科学计数法），不接受下划线分隔、非 ASCII 数字或十六进制等平台特有形式。不得根据数值大小猜测应否交换经纬度；坐标非法时说明不可定位，而不是写成 `(0,0)`。路线 `origin/destination/polyline` 使用相同口径，路线端点与工单/工程师公开位置的关系属于语义校验，不靠 JSON 类型检查替代。

### 4.2 计划时间

引擎计划日期使用 `yyyy-MM-dd`，计划日期时间使用严格的 `yyyy-MM-dd HH:mm:ss`，数字仅接受 ASCII，且必须是真实日历/时分秒值，不带时区。它们是业务本地时间，不按浏览器时区转换，不追加 `Z` 或 `+08:00`。Gateway `created_at/started_at/finished_at` 的平台时间与这些字段不是一类数据，不能互相补值。

工单计划服务区间来自真实 `start_service_time` 至 `departure_time`；`arrival_time` 与服务开始间的等待必须保留语义。参考投影不重新执行求解器，也不根据创建时间、期望求解时长或粗略路线时间制造排程。工单 `duration` 沿用非负 Java Duration 字符串语义，与 `transit.duration` 的整数秒不同；非法、负值或无法安全表达的时间和数值不作为有效计划。路线距离/秒数最多为 JavaScript 安全整数 `9007199254740991`；`Long.MAX_VALUE` 不可达哨兵和超出安全范围的值必须转为 `null`，不能当作巨大真实距离或改写成零。

到达、服务开始和离开时间直接读取归档 JSON，不对残缺领域对象重新调用派生 getter；缺失时间不补十五分钟，也不使用当前时间生成回放区间。

Duration 字符串使用 ASCII 数字，可保留最多九位小数秒，按 Java `long` 秒与纳秒范围精确校验；它不是 JSON 数字，不能误用上述 JavaScript 安全整数上限。字符串可表示的合法极大时长也不自动证明排程或回放可用。

### 4.3 路线与规划回放

路线保留来源枚举与原段位。真实道路来源、估算来源和零距离来源不能混称为实际道路；AMAP/HERE 道路来源和具有真实道路几何的 `CAR_FALLBACK` 可以参与回放资格判断。`ESTIMATED` 或未知来源不能仅因有坐标就当作可信道路；`ZERO_DISTANCE` 只有在端点确实相同、关联一致，且 `transit` 明确为 0 米、0 秒时表达原地停留，不伪造移动路线。无法满足条件时保留其他可展示信息，但不能伪造轨迹或播放。

有 `N` 个顺序工单时，参考回放资格采用保守的 **`N+1` 条原路线段位**校验：前 `N` 段分别通向每个工单，最后一段是返程。不能删除空段后重新配对，也不能根据端点相似度重排路径。

播放从该按日工程师的 `shift_start_time` 开始，只覆盖前 `N` 段与真实工单服务时间，结束于末单 `departure_time`。每单须有真实 `arrival_time ≤ start_service_time ≤ departure_time`，且到达不早于上一单离开或首段起点时间。允许真实零时长服务，但不以缺失时间冒充零时长。

返程不扩展播放范围；缺少返程时间不能用 `tickets_done_time`、路线耗时或其他值假造返程结束时间。返程几何损坏不会自动使已满足条件的前 `N` 段不可回放，但其原段位必须保留。回放资格还要求引用、归属、端点和顺序时间完整一致；`Route.origin/destination` 与相应 `POI.location` 的逐坐标比较容差为 `0.000001` 度，不允许用容差重排段位。

图商道路吸附点可能偏离 POI，因此**不要求道路折线首尾贴合 POI**。道路几何检查全部原始点是否合法，至少具有两个点；起终位置不同时，折线还必须存在不同的相邻点，不能用全重复点假装移动。沿原始折线表达规划示意，不补造 POI 至吸附点之间的首尾连接线。仅有一串折线不足以证明可回放；已有计划时间和道路几何充分时，也不因为独立的道路距离/耗时未知而补造这些指标。上述道路规则不放宽 `ZERO_DISTANCE` 的明确零值要求。

真实空工程师、虚拟工程师和虚拟标志未知的工程师不可回放。部分工程师具备资格时，只汇总这些工程师的最早开始和最晚结束，并保留其他工程师的不可播放原因，不能把局部可播放称为所有工程师完整回放。

不具备回放资格的工程师仍可展示已有静态路线、工单和 Gantt，不展示推演位置；缺失引用明确说明“引用对象缺失”，不删除缺失列表项后重新编号。

测试参考分析只报告“能否依据现有事实回放”，不实现播放动画；独立 View 的回放实现见[组件说明](mcp-app.md#4-map-app)，必须标示“规划回放”，不得称实时位置。

## 5. 可确定的只读计数

计数是测试分析，不新增 wire 指标，也不直接生成外层 `result_summary`。只以 `virtual=false` 明确标识的按日工程师为真实工程师；`virtual=null` 不当作 `false`，跨日实体不按名称或 ID 后缀合并为自然人。

View 不依赖 `result_summary`；分数只读取 Gateway 白名单 `task.result_score`，不从原始任务或旧摘要补取。按日实体计数的展示名称为“工程师排程数”，不能标成去重后的自然人数。

只有 agent/ticket 集合、工单引用及双向归属完整一致时，才计算以下测试分析值；计数不要求 POI 坐标或路线可用，地图缺失不应抹去能够确定的安排数量。

| 分析字段 | 计算口径 |
| --- | --- |
| `engineer_schedule_count` | `virtual=false` 的按日工程师实体数，包括真实但暂无工单的工程师，不合并跨日实体 |
| `assigned_ticket_count` | 确认归属于真实工程师，且在其有序列表中一致出现的工单数 |
| `unassigned_ticket_count` | 确认未指派的工单，以及归属于虚拟工程师的工单数；未知工程师引用不是“未指派” |

agent/ticket 集合缺失、工单引用悬空、重复/冲突归属或未知虚拟状态使完整口径无法确认时，上述计数均为 `null`，不凭局部数据推断完整总数，也不伪补零。已知空集合对应真实零值。工单顺序只取 agent 的工单引用列表；不得从 `plan.tickets` 数组序号、到达时间排序或工单名称猜测。

路线条数、道路段数、工程师数含义不同，本次不替 Gateway 选择 `route_count` 口径。精确分析字段及场景期望由 fixtures 与语义测试共同固定，不能被当作已发布的结果摘要 API。

## 6. Fixtures 与验证

Fixture 文件使用以下组织方式，不是生产消息：

| 文件/字段 | 作用 |
| --- | --- |
| `base-source.json` | 人工合成的原始引擎结果，内部任务 ID 与 Gateway ID 不同；非白名单字段由安全用例补丁注入 |
| `base-expected.json` | 独立人工编写的 Map 安全 `engine_view` 基线，不由运行时投影生成 |
| `gantt-expected.json` | 同一 59-case 集合的 Gantt profile 完整 golden、独立诊断与语义断言 |
| `cases.json` | 每例给出 `name`、可选 `gateway_job_id`，以及源/Map 期望补丁；补丁支持 JSON Pointer 上的 `add/replace/remove` |
| `expected_null` | 该例必须拒绝形成模型；不能拿缺失期望值跳过投影断言 |
| `diagnostics` | 断言诊断项中提供的 `code/path` 子集；空 `[]` 表示必须没有诊断 |
| `analysis` | 对提供的只读分析字段递归断言，未提供字段不代表新增生产默认值 |
| `required_reasons` | 按完整工程师 ID 检查不可回放原因包含指定项 |
| `large-recipe.json` | 可重复的大结果生成配方及独立期望规模，不是产品限额 |
| `payloads.json` | 交接用完整工具结果、工具业务错误、资源错误与认证错误样例；不将这些外层包装扩入本 Schema |

[`scripts/tests/mcp_result_view_fixtures.py`](../../scripts/tests/mcp_result_view_fixtures.py) 只装载两组 golden、应用人工补丁及在内存生成大结果，不导入参考 projector。当前大结果配方包含 200 个按日工程师、1,000 个工单，并使 Map 首段折线包含 4,097 个点，用于验证序列、规模和几何未被静默截断；这些数值不是平台支持上限。

测试诊断的 `{code,path}` 和 `analysis` 都不进入 `_meta.gateway_ui`，也不构成新增错误码或数据接口。golden 的期望对象、诊断断言和分析断言须人工维护，不以被测 projector 的输出反向覆盖期望文件。

外层样例始终使用 `result_summary=null`。Map 使用不可用的明确测试 browser key；Gantt 固定禁用网络配置。SDK 地址只是交接形状示例，不表示 CSP 已批准或可在真实宿主联网。`payloads.json` 分别覆盖两资源 ready/空结果/失败或未就绪，并分开表达 `isError` 工具错误和 JSON-RPC 资源/认证错误；不存在非成功仍携带模型的样例。

三层验证分别负责：

1. **标准 Schema**：Draft 2020-12、封闭对象、必填键、枚举、空值与合法基础类型。
2. **语义**：真实日期、地理范围、身份与引用完整性、路线原索引、时间先后以及计数/回放适用条件。
3. **Golden mapping**：每个合成源结果分别执行 Map/Gantt 白名单参考投影并与各自人工期望比较；未知源字段不泄漏，非法源值不变成伪造的有效值。

运行命令、锁定依赖和临时虚拟环境见[测试说明](../operations/testing.md#41-mcp-结果展示离线契约)。测试不得调用地图、Gateway 或读取真实归档。缺 Schema 校验依赖时应明确失败，不静默跳过标准校验。

## 7. 后续交接与验收边界

Gateway 需以本契约和同组 fixtures 实现服务端生产白名单投影并完成映射测试，不能依靠 View 收到完整对象后再过滤；通过后才能按其发布规则标记 UI ready，不能直接用本仓参考脚本代替生产授权和投影链路。若外层或安全字段变化，先更新权威契约再同步双方样例，不让 Issue 快照与本文件独立演进。

独立 HTML、同 tag 构建声明、只读刷新、实例隔离、地图/Gantt、全屏及规划回放的引擎实现与本仓验证进度见[组件说明](mcp-app.md#7-验证与发布交接)。真实 Gateway 的 manifest/CSP 审核、资源身份与缓存、任务权限和生产投影，以及 ChatGPT、Claude、Quick Desktop、WorkBuddy 各自的真实客户端版本与能力仍需联合验收。离线契约及模拟宿主测试不覆盖这些生产链路，未运行项统一记为“未验证”，不以文档或脚本存在替代上线证据。
