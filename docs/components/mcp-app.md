# 独立 MCP Apps 结果查看器

## 1. 状态与边界

本文记录 Issue #183 后续引擎实现；本轮引擎实现、单文件打包及模拟宿主验收已完成，尚不代表生产 UI ready。白名单、字段单位、空值和安全投影的事实源仍是 [MCP 结果展示契约](mcp-result-view-contract.md) 与 [`docs/integrations/gateway/mcp-result-view-schema.json`](../integrations/gateway/mcp-result-view-schema.json)，本文负责独立 View、构建和交付行为。

本轮范围是独立完整 HTML、标准 View 桥、只读地图/Gantt/单工程师/规划回放、构建声明及模拟宿主验收。不修改 Gateway、REST/OpenAPI、旧结果摘要或求解行为，不拆分、重新嵌入或替代原 `scenario.html`。真实 Gateway 服务端投影、导入发布、授权、地图网络、公开 browser key 与 ChatGPT、Claude、Quick Desktop、WorkBuddy 联调仍是外部验收项。

**引擎实现与模拟验收完成，不等于 Gateway UI ready，也不等于双图商在四个真实宿主可用。**

## 2. 源码与单文件构建

| 位置 | 职责 |
| --- | --- |
| [`src/main/mcp-ui/`](../../src/main/mcp-ui/) | 独立页面模板、样式、词典、原生 DOM 入口、View 桥、模型及地图适配；不导入官网 Controller 或 Scenario Runtime |
| [`model.mjs`](../../src/main/mcp-ui/model.mjs) | canonical 模型的标量校验、只读索引、计数、回放资格和规划位置纯函数；不做原始归档投影 |
| [`bridge.mjs`](../../src/main/mcp-ui/bridge.mjs) | 官方 MCP Apps SDK 连接、宿主通知、只读刷新、全屏请求、尺寸通知、取消和销毁 |
| [`sdk.mjs`](../../src/main/mcp-ui/sdk.mjs) / [`sdk-config.mjs`](../../src/main/mcp-ui/sdk-config.mjs) | 使用 SDK 普通入口及共享 Zod，在 SDK 模块初始化前关闭 JIT；不使用内嵌另一份 Zod 的 `app-with-deps` |
| [`maps.mjs`](../../src/main/mcp-ui/maps.mjs) | AMAP/HERE 原生适配、公开坐标与路线覆盖物、加载错误和生命周期 |
| [`gateway/image-version.yaml`](../../gateway/image-version.yaml) 的 `mcp_ui` | 固定契约标识、视图与显示模式、待审核精确网络来源；也是构建期网络策略的唯一输入 |
| [`build-mcp-app.cjs`](../../src/main/resources/META-INF/resources/static/scripts/build-mcp-app.cjs) | 构建期 Tailwind、esbuild 与 Ajv standalone，生成 `static/mcp-app.html` |
| [`verify-mcp-app.cjs`](../../src/main/resources/META-INF/resources/static/scripts/verify-mcp-app.cjs) | 检查产物是否过期、构建确定性、单文件结构、第一方依赖范围和 manifest 来源格式 |
| [`src/test/mcp-ui/`](../../src/test/mcp-ui/) | 模型、桥接和模拟宿主测试；不读取开发任务目录或真实地图密钥 |

构建目标是 `src/main/resources/META-INF/resources/static/mcp-app.html`，与 `scenario.html` 位于同一静态资源目录、随同一引擎版本交付，但它是包含 `html/head/body` 的完整 UTF-8 文档，不是 `<script export>` 组件片段。第一方 JavaScript、样式、语言包、图标和 View 桥均内联；浏览器不请求官网第一方静态路径、远程字体或第一方 CDN。图商 SDK 与地图资源是单独申报的外部依赖。

依赖及锁文件沿用 `src/main/resources/META-INF/resources/static/package.json` 和 `package-lock.json`。Node 只参与安装、构建和测试，不成为引擎部署运行依赖。Schema 在构建期编译为静态校验函数，浏览器不执行 Ajv 编译；第一方代码不使用 `eval`、`Function` 或运行时模板编译，View 桥禁止 SDK 动态求值，不为第三方能力探测放宽 CSP。

View 使用官方 `@modelcontextprotocol/ext-apps@2.0.0` 普通入口，与锁定的 Zod 4.6.5 共用同一实例；独立配置模块先执行 `config({ jitless: true })`，随后才初始化 SDK 依赖，App 构造时仍显式设置 `allowUnsafeEval:false`、`strict:true`。只在 App 构造时关闭 JIT 不足以阻止预打包 `app-with-deps` 内旧 Zod 的导入期探测，因此构建依赖检查拒绝该入口。

产物校验对整份 HTML 执行与当前 Gateway 相同的 `eval` / `new Function` 静态拒绝规则，不再豁免被 `catch` 捕获的能力探测。静态扫描不是任意 JavaScript 的安全证明；浏览器回归还需在应用脚本执行前监测动态编译调用与 CSP 事件，要求 SDK 初始化、收发和销毁均无此类调用，不能依靠换调用形式躲过扫描。该检查不代表真实 Gateway 导入、授权和地图联网审核已通过。

构建使用 esbuild `drop: ["console"]` 移除随页面打包的应用代码和 MCP Apps SDK 的 console 调用，产物校验进一步拒绝此类日志入口，避免协议 payload、公开地图配置和业务数据进入应用/桥的日志。这不等于清理浏览器 DevTools 的网络记录、CSP 原生诊断，也不控制运行时加载的外部图商脚本。

## 3. 宿主与数据边界

View 在连接之前安装输入、结果、取消、宿主上下文和 teardown 处理器，通过官方 SDK 与父宿主通信，不自行定义另一套 `postMessage` 协议。每张卡片拥有独立实例、选择、请求代次和播放状态，不共享任务缓存，不使用 `localStorage`、`sessionStorage` 或 IndexedDB。

展示数据只读取工具结果的 `_meta.gateway_ui`，不从聊天文本或普通摘要拼装结果。接收顺序是：

1. 校验外层契约版本、任务、ImageVersion、展示工具及模型身份的一致性。
2. 非空 `engine_view` 经过构建期生成的 JSON Schema validator。
3. `validateViewSemantics` 检查 Schema 正则无法保证的真实日历、Java Duration 范围、公开坐标和非空白标识。
4. `buildViewModel` 创建 `Map` 索引及派生分析；出现重复、缺失或非法实体身份时，通过 `invalidIdentity` 拒绝模型。合法但悬空的引用不整体拒绝，保留顺序并标示缺失。

View 校验不是生产安全投影：Gateway 仍必须在服务端从归档执行白名单裁剪，不能先发送矩阵、约束、密钥或原始请求，再依靠页面丢弃。名称、地址、ID 和其他展示文本只作为纯文本处理，不解释为 HTML。

刷新由用户显式触发，不默认轮询；只通过宿主调用当前结果返回、并已验证版本身份的只读 `display_tool_name`。不直接读取引擎 REST、对象存储、认证凭据或原始归档，不发送聊天消息、重新求解或执行写工具。完整工程师 ID 在本地不截断；超出工具输入长度限制时省略可选 `engineer_id`，仍保留本地选择。

同任务刷新保留仍存在的选择和视角；对象消失时明确清除选择，不静默切换到其他工程师。不同任务重置视图上下文。请求取消、更新输入或较新的结果到达后，旧响应不能覆盖新状态。一般刷新失败可保留标为旧数据的前次结果；认证、权限、模型身份及安全校验失败时清除展示数据和地图。teardown 释放请求、地图、事件监听和播放资源。

## 4. 页面与计划数据语义

### 4.1 精简与全屏

会话内精简模式展示地图或 Gantt、任务总计、工程师选择和紧凑详情，没有常驻工程师侧栏或播放控件。选定单工程师时展示原始执行顺序的工单列表；引用缺失也保留其序号，不按 ID 重排。

全屏向宿主请求，只有宿主确认后才进入；拒绝或不支持时继续保留精简模式。全屏使用工程师/工单页签、检索与详情侧栏，以及主地图或 Gantt。窄屏侧栏以可收起覆盖层承载。语言、主题跟随宿主；不支持或未提供的语言回退简体中文，主题缺省为浅色。

Gantt 使用已有服务、等待和行程时间，缺少或先后不一致的区间显示不可用，不补十五分钟或按 `duration` 推算缺失时间；零时长服务采用明确的点状标记。列表、地图、Gantt 的工程师身份与颜色保持一致。任务计数不随局部选择改写；无法确定的计数显示未知，不显示零。

### 4.2 纯模型 API

| API | 语义 |
| --- | --- |
| `parsePlanTime` / `formatPlanTime` | 固定 `yyyy-MM-dd HH:mm:ss` 与毫秒业务轴之间转换；以 UTC 方法实现无时区轴，不表示真实 UTC 时刻、不随浏览器时区或 DST 改变；非法输入分别返回 `null` / 空字符串 |
| `isPlanDuration` | ASCII 非负 Java Duration，最多九位小数秒，精确检查 `long` 秒范围；不把合法字符串的范围缩为 JavaScript 安全整数 |
| `poiPosition` / `routePosition` | POI 只取 `location` 的“经度,纬度”；历史 Route.LOC 的 `lat` 是经度、`lon` 是纬度，显式转为 `[lng, lat]`；非法返回 `null` |
| `validateViewSemantics` | 检查非空标量真实性；合法空值、悬空引用或不可播放不等于模型非法 |
| `buildViewModel` | 保留 `agents/tickets/pois` 的数组或 `null`，建立 ID 索引，返回 `invalidIdentity` 与 `analysis`，不变异 wire 数据 |
| `analyze` | 与第一阶段 Python 测试参考一致的计数、逐工程师原因及回放范围；派生信息不写回 wire |
| `buildReplay` | 为有资格的工程师预计算路线累计长度，以二分查找定位路段和时间；`at` 返回规划位置及阶段，不重算求解、不修改工单业务状态 |

计数只依赖完整的工程师/工单集合与双向归属，不要求 POI 或几何可用。只有 `virtual=false` 是真实工程师排程；`virtual=true` 的工单计入未安排，`virtual=null` 不能当作真实。跨日工程师按完整实体 ID 处理，不按名称或 ID 后缀合并为自然人。

### 4.3 规划回放

仅全屏地图提供回放，默认暂停；切出地图、退出全屏、页面隐藏或地图失败时暂停并保留时间位置，返回后不自动续播。不可回放的工程师仍保留详情、已有静态结果及原因；部分工程师可播放不代表全部计划完整。

资格继承 [路线契约](mcp-result-view-contract.md#43-路线与规划回放)：有 `N` 单须保留 `N+1` 个原路线段位，只播放前 `N` 段，开始于班次开始，结束于末单真实 `departure_time`。坏返程几何不阻止合格的前 `N` 段，也不允许推算返程结束。缺失值没有 fallback，`ESTIMATED` 与未知来源不得当作已证实道路回放，`ZERO_DISTANCE` 需要明确零距离、零耗时和相同位置。

阶段为未出发、行程、等待、服务、计划完成；时间边界使用半开区间，允许真实零时长服务。出发前停在原始起点，最后离开后停在末单 POI，不画返程位置。道路吸附点允许偏离 POI：行程仅沿原折线，等待/服务使用业务 POI，不补连接线；阶段切换处可能跳点，因此始终标示“规划回放 · 非实时位置”。跨经度 180° 的插值沿相邻原始点的短弧处理，不绕行整个地球。

播放时复用静态路线和工单覆盖物，只更新工程师位置，不在每帧读取原折线、重新挂载 SDK 或刷新底图。

## 5. 地图、网络与安全降级

AMAP 与 HERE 使用各自原生适配，不能把 HERE 伪装为全局 AMap。图商以任务快照及 Gateway 的 `map_context` 为准，配置与任务不一致时拒绝加载。AMAP 坐标按 GCJ-02、HERE 按 WGS84 解释；不新增 wire 坐标字段，不擅自转换或根据数值大小交换轴。第一方入口只接受 manifest 允许的 HTTPS origin，不能由任务文本控制任意脚本加载。

当前 [`mcp_ui.csp`](../../gateway/image-version.yaml) 是**待审核候选**，不是完整真实地图网络验收：

| 精确 origin | 候选需求及证据 |
| --- | --- |
| `https://webapi.amap.com` | AMAP 1.4.15 SDK 入口；[官方加载说明](https://lbs.amap.com/api/javascript-api/guide/abc/prepare)不等于当前 key 下后续瓦片/鉴权来源完整清单 |
| `https://js.api.here.com` | HERE 3.2 模块、样式、字体及图片；[官方 CSP 说明](https://docs.here.com/maps-api-for-js/docs/content-security-policy)也要求相应 CDN 连接 |
| `https://vector.hereapi.com` | 当前默认 ROW 矢量瓦片；[官方 Vector 文档](https://docs.here.com/map-rendering/docs/quickstart-vector-tile-api) |
| `https://maps.hereapi.com` | 默认 ROW 栅格图层及元数据，包含夜间栅格 fallback；[官方 Raster API](https://docs.here.com/map-rendering/reference/gettile) |

manifest 的 `connect_domains` 与 `resource_domains` 仅接受精确 HTTPS origin，不接受通配符、路径、凭据或空 CSP 冒充地图支持。不申报本功能不使用的导航、地址搜索、实时交通或 IML 服务。SDK 内部网络是否完整覆盖，仍须在批准策略和受限公开 key 下观测确认；不得从失败日志自动扩大权限。

HERE 3.2 使用 HARP，官方要求的 blob worker、WASM 等能力不是 origin，不能添加到这两个数组或由页面放宽宿主 CSP。[HERE 3.2 迁移说明](https://docs.here.com/maps-api-for-js/docs/migration-guide)说明切换栅格底图不等于恢复旧渲染器。AMAP key 的安全配置与 iframe/referrer 限制须由 Gateway 和图商配置确认，View 不私加安全码字段、使用服务端私钥或搭建代理绕过限制。滚动 SDK 地址也不能视为永不变化的依赖，真实发布要记录批准版本和网络证据。

`browser_key` 是刻意交给浏览器图商 SDK 的**公开受限 key**，不是可在客户端保密的服务端凭据。请求 URL 可能带此值，DevTools 网络面板、加载失败或 CSP 原生诊断也可能显示 URL；禁止应用 payload 日志不能据此承诺浏览器中隐藏 key。Gateway 和图商配置必须限制允许的引用域/referrer、API 权限及适用配额，并在真实宿主的 iframe/origin 条件下验证；不能把私钥作为 `browser_key` 下发。

适配层检测配置错误、SDK 加载失败/超时、相关 CSP 违规，以及以下可观察的图商事件；检测到失败后停止回放，显示失败提示并允许手动重试，保留 Gantt、工单和工程师详情：

* AMAP 初始化等待 `complete`，超过 20 秒未收到则按加载超时处理。[官方 complete 示例](https://lbs.amap.com/demo/JavaScript-api/example/map-lifecycle/map-complete)描述的是地图加载完成事件，不是通用鉴权错误事件。
* HERE 对可提供样式对象的图层监听 `error` 和 `change`，并检查 `Style.State.ERROR`，销毁时解除监听。[官方 HARP Style API](https://docs.here.com/maps-api-for-js/page/maps-api-for-javascript-api-reference-3-2-h-map-render-harp-style)说明这些事件用于样式加载、解析及变更。

上述信号**不能保证识别所有后续瓦片失败或 HTTP 401**，也不能代替真实图商就绪与鉴权验收。不无限自动重试，不用伪造零坐标、直线连接或假底图宣称地图已就绪。

## 6. 构建与发布交接

在 `src/main/resources/META-INF/resources/static` 下执行：

```bash
npm ci --include=dev
npm run build:mcp-app
npm run verify:mcp-app
```

构建更新单文件产物；校验只检查，不写文件。修改源码、Schema、依赖锁文件或 `mcp_ui` 后需重新构建并校验。不能只构建 JVM 就假定前端产物已更新；详细容器步骤仍见[运行与部署](../operations/deployment.md#101-独立-mcp-apps-产物)。旧 `build:scenario` 与新构建分别维护自己的产物，互不替代。

Gateway 按其独立 MCP 导入状态审核 HTML、契约和网络策略；`pending` 不发布展示工具，失败不得沿用旧 UI 快照继续发布。声明存在不赋予网络权限；即使导入成功，仍要满足版本启用、用户授权、服务端安全投影等条件。发布后产物与批准 CSP 参与不可变资源身份，不覆盖旧 tag 变更网络清单。

## 7. 验证记录与未验证项

以下为 2026-09-18 首轮实现的本地记录，SDK 导入期探测修复后的专项结果另见 §7.1：MCP 专项构建、测试和模拟验收通过；旧页面浏览器及 JVM 稳定门禁仍有经原始 HEAD 对照确认的基线失败，不能宣称全部门禁通过。相关命令、覆盖分层及离线 fixtures 见[测试说明](../operations/testing.md)，功能覆盖见[覆盖清单](../testing/coverage-inventory.md)。

| 验证项 | 本轮结果 |
| --- | --- |
| Python 离线契约 | 17/17 通过 |
| MCP Node | 120/120 通过 |
| MCP 模拟宿主浏览器 | 真实 Chromium 中 30/30 通过；生产 HTML、官方 View SDK 与图商替身，不访问真实地图服务 |
| MCP 手工页面检查 | agent-browser 检查桌面及 375px 窄屏、简体中文/英文、浅色/深色；窄屏筛选重叠已修复并加入浏览器回归 |
| 旧页面 Node | 110/110 通过 |
| 旧 CSS/Scenario 构建与产物校验 | 已通过 |
| 前端依赖安装 | 独立临时目录执行 `npm ci --include=dev --offline` 成功，安装 353 个包；依赖树仅有 esbuild 0.25.12 |
| MCP 构建与产物校验 | `build:mcp-app` / `verify:mcp-app` 通过，两次构建字节一致；单文件 HTML 为 546258 字节 |
| JVM 产物打包 | 隔离工作区执行 `./gradlew quarkusBuild -x test --offline --no-daemon` 成功；JAR 内 `META-INF/resources/static/mcp-app.html` 与当次源产物字节一致，全部 `quarkus-app` JAR 均无 `static/node_modules` |
| 旧页面浏览器 | 19 项通过、1 项失败；`visual density` 的 `quotaHeaderBottom` 期望 0、实际 1，已在 `git archive HEAD` 创建的隔离基线中复现，记为既有基线失败，不为本次任务修改旧页面 |
| JVM `allStableTest` | Unit 138/138 通过；App 60/75 通过、15 项失败。当前代码与原始 HEAD 在相同无 `.env`、无地图密钥的隔离环境运行，XML 中失败方法集合完全一致；稳定门禁未通过 |

JVM 对照使用 `allStableTest --offline --no-daemon`，在去除本地环境影响的独立工作区执行。上述 App 失败涉及已有场景 build 和 MCP 测试的地图依赖，在 AMAP 未启用/占位 key 条件下复现；原始 HEAD 对照支持其为既有环境基线限制，不把配置覆盖或跳过测试当作稳定门禁通过。打包时的 `-x test` 仅验证产物交付，不替代测试门禁。

真实 Gateway 导入/鉴权/资源身份、AMAP 后续来源完整性、公开 key 限制、HERE worker/WASM 和四个真实客户端的版本及行为均为**未验证**。模拟宿主、SDK 替身与离线 fixtures 只能证明本仓对应路径，不能替代这些联合验收。

### 7.1 SDK 导入期动态编译探测修复

首轮只验证了严格 CSP 下页面仍可运行，未覆盖 Gateway 对整份 HTML 的动态代码静态拒绝规则；旧 `app-with-deps` 中被捕获的探测仍会导致导入拒绝。本次改为共享 Zod、初始化前关闭 JIT，并取消产物扫描中的探测豁免，不修改 Gateway 或放宽 CSP。

本次专项复验：Python 契约 **17/17**、MCP Node **122/122**、模拟宿主 Chromium **32/32**、旧页面 Node **110/110** 全部通过；`verify:scenario`、`build:mcp-app` 和 `verify:mcp-app` 通过。新 HTML 为 **667006 字节**，构建可重复，Gateway 同款动态代码正则匹配为零。运行时监测确认 SDK 初始化、消息收发、刷新与销毁全程 `Function` / `eval` 调用为零；独立负向控制能够识别被捕获的探测，原生 CSP 禁止动态求值的自测仍通过。

上游库中未执行的编译实现不等于已从依赖源码删除；保证的是配置与执行路径禁用探测/JIT，并由静态与运行时回归共同验证。本次未重跑 JVM 和旧页面浏览器门禁，上表仍为首轮结果；真实 Gateway 导入及外部联调继续列为未验证，不因这次静态规则复验而改变状态。
