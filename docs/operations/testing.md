# 测试说明

## 1. 文档目的与边界

本文负责当前 Gradle 测试任务、测试分层、Fixture、文件隔离、外部地图测试、求解器测试、页面测试和完成标准。

本文不逐项维护每个测试方法的覆盖状态；当前清单与缺口以[测试覆盖清单](../testing/coverage-inventory.md)为准，也不把清单中的建议缺口自动提升为产品需求。

## 2. 测试分层

| 层级 | 位置或标签 | 负责内容 | 默认门禁 |
| --- | --- | --- | --- |
| Unit | `src/test/java/unit`，无特殊标签 | 纯逻辑、领域模型、约束、序列化、存储路径等 | 是 |
| App | `src/test/java/app`，`@Tag("app")` | 进程内 Quarkus、Repository、REST、MCP 和门面流程 | 是 |
| External | `src/test/java/integration`，`@Tag("external")` | 真实地图服务和远程服务调用 | 否，显式启用 |
| Manual | `src/test/java/manual`，`@Tag("manual")` | 人工运行脚本、报表和观察性样例 | 否 |
| Script | `scripts/tests` | 本地开发运维脚本的环境隔离、进程生命周期，以及 MCP 结果展示离线契约 | 按相关脚本或契约改动运行 |
| Static UI | `src/main/resources/META-INF/resources/static/tests` | 页面逻辑、布局契约、地图上下文和 i18n | 按前端改动运行 |
| MCP Apps UI | `src/test/mcp-ui` | 独立 View 的模型/桥/地图/构建 Node 测试与隔离浏览器中的模拟宿主测试 | 按 MCP View 改动运行；CI `static-ui` job 单独执行 |

## 3. Gradle 任务

```bash
# 稳定单元测试；排除 app、external、manual
./gradlew test

# 进程内 Quarkus 应用测试
./gradlew appTest

# 聚合稳定单元与应用测试
./gradlew allStableTest

# 与 allStableTest 一起作为 check 的一部分
./gradlew check

# 聚合稳定测试的 JaCoCo HTML/XML 报告
./gradlew jacocoStableTestReport
```

所有 JVM 测试统一使用 JUnit Platform、UTF-8、Quarkus 日志管理器和最大 4 GiB 堆。`integrationTest` 是 `externalTest` 的兼容别名，不是另一套测试层级。

## 4. Fixture 与文件隔离

* 可重复使用的测试输入放在 `src/test/resources/fixtures/`，场景样例放在其 `scenarios/` 子目录。
* 公开演示场景可以从仓库 `scenarios/` 读取，但测试不得修改源 Fixture。
* test profile 将场景和任务仓库指向 `build/test-data/scenarios/` 与 `build/test-data/solver_jobs/`。
* 测试在开始和结束时清理自己创建的数据，不依赖执行顺序，不读取开发环境的 `data/`。
* 测试所需 token 或地图配置使用测试值、环境变量或临时配置文件，不能写入仓库。
* Gradle 的 `test`、`appTest` 默认固定选择高德（AMAP），使用合成 AMap key 保持本地曼哈顿矩阵前置校验有效，同时通过测试专用的位置补全替身隔离地理编码；HERE 默认使用不可用占位 key，关闭其远程矩阵和地址解析服务回退。不得继承开发 `.env` 或 shell 中的真实图商接入设置。地图上下文等专项 App 测试可通过既有 `QuarkusTestProfile` 显式使用合成配置，不发起真实请求。`externalTest`、`manualTest` 及应用打包/运行不启用该替身，不受稳定测试隔离设置影响；真实位置补全逻辑继续由其独立 Unit Fixture 覆盖。
* `StableMapConfigurationTest` 检查默认稳定 App 测试的 AMAP 选择、合成 key、本地矩阵前置条件、HERE 不可用及位置补全替身已启用；使用合成的 HERE/AMAP shell 配置执行时仍须通过。场景导入与后续资源不存在断言不应因地图网络超时或未结束的导入请求相互污染，不通过增加超时或跳过测试处理。
* 指标采样测试的合成 Gauge 状态在注册表生命周期内须保留强引用，避免临时数值对象被 GC 回收后变为非有限值而产生偶发失败；仅调整 Fixture 生命周期，不改变生产指标的读取逻辑或得分断言。

### 4.1 MCP 结果展示离线契约

Issue #183 的独立契约样例放在 `docs/integrations/gateway/fixtures/mcp-result-view/`，使用人工合成数据，不读取真实任务归档、开发环境数据、Gateway 服务或地图服务。字段设计与外部对接边界见 [MCP 结果展示投影契约](../components/mcp-result-view-contract.md)。该目录不改变上述 JVM Fixture 约定。

运行前安装 `scripts/tests/requirements-mcp-contract.txt` 中锁定的 `jsonschema==4.10.3`。推荐使用仓库外的临时虚拟环境：

```bash
MCP_CONTRACT_VENV="$(mktemp -d /tmp/vrp0-mcp-contract.XXXXXX)"
python3 -m venv "$MCP_CONTRACT_VENV"
. "$MCP_CONTRACT_VENV/bin/activate"
python -m pip install -r scripts/tests/requirements-mcp-contract.txt
python -B -m unittest discover -s scripts/tests -p 'test_mcp_result_view_contract.py' -v
deactivate
```

测试分三层：标准 Draft 2020-12 JSON Schema 校验、跨字段语义校验、原始引擎结果到人工编写期望投影的 golden mapping。`scripts/tests/mcp_result_view_support.py` 是 **test-only reference projector**，只帮助验证契约，不是 Gateway 生产投影实现；期望结果不能由同一 projector 自动生成后再与自身比较。

修改 Schema、映射规则、参考 projector 或此目录 Fixture 时运行上述命令。CI 中独立的 `mcp-result-view-contract` job 执行相同命令；该测试不加入 JVM 默认稳定门禁，不修改 REST/OpenAPI 或旧结果摘要契约。**离线契约本身不执行页面**；独立 View 的 Node/模拟浏览器验证另见 §8.1，两者不能互相替代。通过其中任一组测试均不表示 Gateway 生产投影、导入、鉴权、真实地图网络或四个真实宿主联调通过，未执行的外部验证须标为“未验证”。

### 4.2 Gateway 元数据目录

`scripts/tests/test_gateway_metadata_layout.py` 验证根目录 `gateway/` 仅包含 Gateway 导入的三份元数据，参考 Schema、说明和 fixtures 留在 `docs/integrations/gateway/`；生成器默认输出及显式 `--output-dir` 均在临时目录验证，不覆盖仓库文件。该测试同时断言地点字段必填、`plan.pois` 保持条件可选、POI ID/对象双形式、集中式示例引用闭合，以及仓库参考 Schema 与生成器输出一致。

```bash
python3 -B -m unittest discover -s scripts/tests -p 'test_gateway_metadata_layout.py' -v
```

## 5. 求解器测试

### 5.1 约束

`RoutePlanConstraintProviderTest` 使用 OptaPlanner 测试支持验证约束惩罚。修改约束时至少检查：

* 触发条件产生正确分数级别和数量级；
* 不触发条件不产生惩罚；
* 未指派、空引用和边界时间不会导致异常；
* 约束默认权重为零时，不把存在性测试写成默认启用行为。

### 5.2 规划链和派生变量

Agent/Ticket 链变化需要覆盖到达时间级联、取消指派、pinned 行为和矩阵传播。领域对象初始化、虚拟 Agent、原始指派和结果应用应尽量在 Unit 层验证。

### 5.3 异步任务

在 App 层覆盖创建、状态轮询、严格更优解写入、完成、终止、重复启动、删除限制、应用结果和重启状态重置。测试等待异步任务时使用有上限的轮询，不使用无界 sleep。

## 6. Repository、REST 与 MCP

* Repository 测试覆盖当前场景、任务历史、最新指针、矩阵拆分、状态重置和删除。
* REST 测试同时断言 HTTP 状态与稳定业务错误，不只检查返回文本。
* API 或模型变化时同步更新 OpenAPI 注解和 `docs/openapi.yaml`，并增加字段或响应契约断言。
* `OpenApiLocationContractTest` 同时检查运行时 `/q/openapi` 与已发布 `docs/openapi.yaml` 的地点 required、字符串/内联双形式、条件说明、集中式示例和版本，并校验 Gateway 镜像元数据版本与运行时版本一致，防止版本或发布契约漂移。
* MCP 测试覆盖 Bearer Token、Origin、预检、初始化、Tool 列表、Tool 调用，以及与 REST 状态一致性。
* 大对象响应测试应确认任务查询和回调不携带矩阵，矩阵专用接口仍可工作；启动和终止响应按当前实现单独断言。

## 7. 外部地图测试

External 测试默认跳过。只有明确需要真实联调，并已准备受限密钥时才运行：

```bash
VRP_EXTERNAL_TESTS=true ./gradlew externalTest
# 或
./gradlew externalTest -Dvrp.external.enabled=true
```

规则：

* 使用 `ExternalTestSupport.requireExternalTestsEnabled()` 保护真实调用。
* 请求规模必须小且次数明确；HERE Matrix 现有联调只使用 `1×3` 和 `2×3` 小矩阵。
* 不把真实业务地址、密钥或完整外部响应写入测试报告和日志。
* 外部限流、网络波动或服务不可用不能影响默认稳定门禁。

## 8. 静态页面测试

静态资源位于 `src/main/resources/META-INF/resources/static/`。首次运行先在该目录安装锁定依赖：

```bash
npm ci
```

根据改动运行对应脚本，例如：

```bash
npm run test:score-progress
npm run test:datetime24
npm run test:solver-job-list
npm run test:solver-job-detail-layout
npm run test:solver-job-gantt
npm run test:solver-job-map-layout
npm run test:scenario-solve
npm run test:i18n
npm run test:i18n-ui
```

修改 Scenario Web Component 的页面、模块或样式时，还需执行：

```bash
npm run sync:vendor
npm run build:css
npm run build:host-dependencies
npm run build:scenario
npm run verify:scenario
```

页面测试应覆盖加载、空状态、错误、按钮可用条件、双语文案和关键布局契约；不以像素级截图替代业务断言。

场景导入测试还应覆盖：车辆燃料/油耗/每日成本缺失时界面留空且请求省略字段。

### 8.1 独立 MCP Apps View

短展示工具名验收覆盖 `gw_map_<32位ID>` / `gw_gantt_<32位ID>` 的初始化、刷新、视图与版本匹配，以及对旧名和非法后缀的拒绝。断言原始长度 39 / 41、当前 Quick 前缀下长度 51 / 53；名称缩短不改变投影 golden。Python 交接样例与 Gateway 快照联动更新工具名及相应来源指纹。Quick 真实客户端的工具调用成功与卡片渲染成功必须分别记录；没有真机测试时仍标记未验证。

源码和构建边界见[独立 MCP Apps 查看器](../components/mcp-app.md)，测试位于 `src/test/mcp-ui/`，不复用官网页面测试作为替代验收。运行目录仍为 `src/main/resources/META-INF/resources/static/`：

```bash
npm ci --include=dev
npx playwright install --with-deps chromium
npm run build:mcp-app
npm run verify:mcp-app
npm run test:mcp-unit
npm run test:mcp-ui
```

Node 测试需要可执行的 `python3`：模型 fixture helper 以 `python3 -B` 从已有人工编写的 canonical goldens 和测试参考分析导出数据，使用 Python 标准库，不调用 projector 生成期望值。§4.1 的完整 Python Schema 测试仍须独立安装其锁定依赖并运行。缺工具或依赖应明确失败，不静默跳过校验。

验证职责分开：

| 层次 | 主要职责 |
| --- | --- |
| 模型 Node | 人工 fixtures 与 Python 分析 parity；不变异、`null`/空集合、完整 ID、双向归属、标量语义、业务时区轴、回放资格、阶段边界、吸附原折线、跨经度与合成大向量 |
| View 桥 Node | 官方 SDK 边界替身；先注册处理器再连接、结果身份、白名单错误映射、只读工具名、Map/Gantt 固定工具与输入边界、显式刷新、`ui/message`、输入/通知竞态、取消、显示模式与 teardown |
| 地图 Node | SVG context/投影/元素映射、历史坐标、原段位/真实几何、颜色与原回放、缺失和超限语义；旧 renderer 源码仅作历史实现，不进入新版产物 |
| 构建 Node 与产物校验 | render_mode、Map/Gantt 两份 HTML、4 MiB 上限、自包含/确定性、Ajv standalone、SDK 2.0.0/共享 Zod/jitless、无旧 renderer 与网络 adapter 依赖 |
| 模拟浏览器 | 真实构建 HTML 与官方 SDK，在 opaque-origin sandbox、禁止 connect/frame/Worker/eval 的 CSP 下验证 SVG 白名单、PNG/JPEG data 图片、恶意载荷、署名、映射点击、筛选/取景/缩放/平移/回放/全屏、零外部请求、双卡片隔离及完整 Gantt 回归 |

合成宿主仅通过拦截提供 HTML 和已鉴权工具结果；未知浏览器请求一律失败。新版 Map 无嵌套 renderer，不使用图商 SDK 替身，不读取开发数据/真实密钥。真实图商与四宿主单列验收；内嵌图片是否获目标 CSP 允许须实际验证。

Map 布局保持桌面 3:2、窄屏 1:1、工具栏全屏入口、画布下方有界图例和无横向溢出。宿主尺寸通知不能形成高度反馈；resize/全屏保留选择和视窗。适配路线按当前过滤内容与标签留白，本地缩放/平移仅操作全任务快照范围，不请求新底图。署名独立固定可见，不被筛选、缩放或回放隐藏。

Map 会话、全屏、筛选及语言/主题切换后均不得出现底部只读说明行、分隔线或占位；检查页面底部直接结束于 Gantt 入口区域，入口仍可正常发送既有只读查看意图，规划回放提示保持。

Map 路线取景图标回归检查图标在初始化、筛选及语言/主题切换后保留，按钮没有可见文字且可访问名称正确；悬浮/键盘聚焦显示本地化提示，提示可悬浮、Escape 可关闭并在重新触发后恢复。点击及 Enter 只触发已有适配，保留工程师筛选、不请求业务工具；地图未就绪仍禁用。窄屏及全屏提示不得产生横向溢出或被画布裁剪，销毁后不残留提示监听。

Gantt 回归须检查独立服务块的短地点与真实服务时长、地址保守简化和名称/未知回退、完整编号与地址详情、蓝色行程线与无底框汽车/时长（含短行程和悬浮态）、灰色斜纹等待带、实际区间几何不变、规则刻度/网格、缩放按钮移除、行高与工单条高度、虚拟工程师在排程/筛选/全屏列表中的隐藏及未知类型保留、顶部仅时间与左侧完整日期和计划执行区间、完整业务时间提示、单工程师详情紧贴排程及宿主随尺寸通知收缩、行多时有界滚动、无底部只读说明行。全屏、窄屏、双语、跨日、零时长、缺失数据、已选工程师变为虚拟后的清理和 Gantt 零地图请求均需保持。

执行范围回归覆盖同班次不同完成时间、引擎提供的含返程完成时间、完成时间缺失时回退有效阶段结束、提前服务、班次开始缺失、无效完成时间、无工单/无真实阶段的 `-`、零长度阶段不回退完整班次、原页面范围优先级对照、同日/次日/跨月/多日、日期未知、双语和时区不变。不得根据时长补算工单缺失时间，也不新增返程条。姓名下日期与执行范围保持同行，不换行或裁切；班次起止仍可在会话及全屏详情查看。表头和各行左列保持对齐，语言、结果通知、工程师筛选和全屏切换后重新检查布局。

Gantt 图例/筛选合并回归须检查桌面及窄屏的实际左右位置、无独立筛选行、双语下拉框可访问名称、页头对象列表入口，以及未选择/清除选择时会话和全屏详情区为空、不显示选择说明；选择后的详情及既有 Map 布局/提示保持。

父页 SDK 安全回归在最终 Map/Gantt HTML 的应用脚本之前，用 parser 执行的测试脚本监测 `Function` / `eval` 调用和 CSP 动态求值违规，覆盖初始化、通知及 teardown，要求调用次数为零；进入 renderer 的 DevTools 操作不计入父页监测，因为调试器本身可能使用页面 `eval`。独立负向控制验证监测能发现被 `catch` 吞掉的探测。Renderer 的 `unsafe-eval` / WASM / blob Worker 只按其独立 CSP 验证；第一方 renderer 源码仍须通过静态无动态编译检查。

模拟测试使用 `playwright.config.mjs`，失败 trace/截图在 `/tmp/vrp0-mcp-ui-playwright`；只写隔离测试产物，不向产品添加调试 wire。修改源码、模板、样式、Schema、依赖或 manifest 后都须重建两份 HTML 并验证确定性；CI 检查两份产物未过期，旧 renderer 必须不存在。原网页未变时不重建 Scenario；共享展示层改变时仍按原规则回归。

实际执行数量记录在[组件验证记录](../components/mcp-app.md#6-验证与交付)或报告。模拟宿主/合成底图通过不等于真实图商或四宿主验收。

#### 显式启用真实 Gateway SVG 联调

`src/test/mcp-ui/real-sdk-check.mjs` 文件名保留历史兼容，但内部只验证 SVG。它不进入默认测试；使用调用方的本地模拟宿主、私有 PAT 和指定任务，只读调用真实 Gateway，核对已发布 Map HTML、空 frame 权限、SVG/context/署名、全屏和销毁，并断言浏览器无第三方地图请求。不注入 key、不放宽 CSP，不证明四个真实客户端兼容。

```bash
MCP_REAL_SVG=1 MCP_PREVIEW_DIR=/absolute/path/to/mcp-live-preview \
MCP_REAL_JOB_ID='<job-id>' node src/test/mcp-ui/real-sdk-check.mjs
```

脱敏报告与截图默认位于 `/tmp/vrp0-mcp-real-sdk`，不得提交真实任务截图、PAT 或服务端图商配置。Java 合成信封可另用 `MCP_SVG_INTEROP_FILE` 指向隔离文件运行 `node src/test/mcp-ui/interop-check.mjs`；该脚本只验证跨仓生产/消费链，合成底图不是真实图商验收。

## 9. 完成标准

* 纯后端行为变更：相关定向测试通过，`./gradlew allStableTest` 通过。
* REST/MCP 变更：契约、拒绝路径、鉴权或状态一致性测试通过。
* 求解变更：约束或生命周期测试覆盖触发与边界路径。
* 本地开发脚本变更：运行 `scripts/tests` 下对应的 Shell 回归测试。
* 页面变更：相关 Node/Playwright 测试和组件校验通过。
* 独立 MCP Apps 变更：按受影响范围运行 Python 契约、MCP Node、构建/产物校验及模拟浏览器测试；涉及共享工具链时同时回归旧 UI。真实 Gateway/图商/四宿主结果单列，不用模拟结果宣称生产 UI ready。
* 外部能力变更：稳定测试使用替身或纯逻辑测试；真实联调结果单独说明。
* 纯文档变更：Markdown 链接、标题、术语和 `git diff --check` 通过，不强制运行代码测试。
* 实际覆盖变化后更新[测试覆盖清单](../testing/coverage-inventory.md)。

## 10. 非目标

本文不设定新的覆盖率阈值、不要求默认运行外部服务、不把 manual 脚本计入稳定门禁，也不创建新的测试平台。

### SVG 高清及地图交互回归（2026-10-27）

补充旧 1×/新 2× 图片、DPR 1/2 清晰缩放上下限、极端宽高比完整路线优先、四边拖动/聚焦/回放不越界、触边去重/双语、resize 取景态与手动态保持、路段独立高亮/透明命中/原段位及返程/键盘/空白清除/拖动误触/筛选保持、多卡片和销毁。保持默认合成夹具，不调用真实图商；既有 Gantt 浏览器套件完整运行。真实 Gateway/图商联调单独显式执行，实际宿主无法验证时注明未验收。

#### 本轮执行结果

* Node 22.23.4 下两份 HTML 构建/确定性校验、189 项 Node、84 项串行 Playwright、17 项 Python 离线契约及 `./gradlew --offline quarkusBuild` 通过。包含旧/高清图片与 DPR 组合、极端画幅完整取景、边缘约束、独立路段高亮及保持回放运行状态，既有 Gantt 全量浏览器回归通过。本轮未运行 JVM 稳定测试，Java 与求解代码未改。
* 实际 Gateway Java 工作区服务、校验、安全投影、HTTP 图片下载及合成 SVG 生成单任务夹具，实际构建页面与官方 MCP 桥的跨仓验证通过；3 工程师、9 工单、12 路线，地图外部网络和地图子 iframe 均为 0。独立同页预览夹具人工检查了桌面路段选择、360px 宽度、全屏及 Map→Gantt，无脚本错误；图片与版本/管理员目录明确为合成数据，不冒充登录后的真实 Gateway 联调。
* Gateway 另用真实图商服务验证 2048×1536 和公开坐标位移对齐：AMAP 理论/实测逻辑位移 116.508/116，HERE 58.254/58，均成功合成单任务 SVG。HERE 当前 Java 直连失败，隔离测试经环境代理通过，未修改产品网络配置。授权图片只在内存处理，未以真实底图截图代替目标宿主验收。
* 最终 Map/Gantt HTML 使用新 hash，JAR 中两份 HTML 与工作区逐字节一致，不含 renderer 或静态 node_modules；版本保持 `1.1.3-alpha-SNAPSHOT`。未推送、导入、发布镜像或部署。真实运营任务、目标宿主内嵌图片 CSP、署名/缓存授权和部署环境 HERE 直连仍未验收；临时日志、合成截图与夹具仅在 Gateway 忽略预览目录。

#### 路线焦点黑框与全屏引导修正（2026-10-27）

原产物新增回归复现鼠标点击 SVG 路段时浏览器默认 `outline:auto`，以及缩放上限缺少全屏引导。修正后，明暗主题下鼠标/键盘路线均无矩形轮廓，沿线衬线与原配色、返程虚线保持；画布键盘焦点仍可见。中英文验证会话缩放/触边提示引导全屏，全屏及退出后的可见提示自动切换，相同模式/尺寸更新不重复播报，原手势去重保持。

两 HTML 构建/确定性校验、189 项 Node、88 项串行 Playwright（含完整 Gantt）、17 项 Python 契约及 `quarkusBuild` 通过；最终 JAR 与工作区 HTML 逐字节一致。消费实际 Gateway 工作区服务生成的合成高清单任务夹具，跨仓浏览器验证通过，地图外部网络及地图子 iframe 为 0。agent-browser 人工检查沿线高亮、两处中文提示及窄屏深色，临时浏览器已关闭；合成验证不是实际智能体宿主验收。本轮只修改 View、样式、文案和对应文档/测试，未运行 JVM 或真实图商测试，未升级版本、发布或部署。

#### 缩放与触边提示文案精简（2026-10-28）

中英文会话/全屏四种提示仅保留限制和操作引导，精确校验完整文案，不再附加范围或细节不会增加的解释。两 HTML 重建及确定性校验、189 项 Node、88 项串行 Playwright（含 Gantt 回归）通过；最终 HTML 中旧附加文案检查通过。未改变缩放、范围或交互逻辑，未运行 JVM、Python 契约、应用打包或真实图商测试；不代表实际宿主新增验收。未升级版本、发布或修改生产配置。

#### 1.1.4-alpha-SNAPSHOT 源码交付验证（2026-10-28）

升版后 Map/Gantt 构建/确定性校验、189 项 Node、88 项串行 Playwright（含完整 Gantt）、17 项 Python 展示契约及 4 项元数据目录契约通过。`allStableTest quarkusBuild` 串行完整复跑通过，138 项单元及 77 项应用测试均无失败/错误/跳过。初轮与 Gateway JVM 测试并发时，McpServerTest 因测试端口 8081 被占用无法启动；未改测试、断言或超时，串行复跑排除端口冲突后通过。1.1.4 JAR 中两份 HTML 与工作区逐字节一致，不含 renderer 或 static/node_modules。

Gradle、OpenAPI info.version、版本契约断言和镜像元数据同步。按用户确认提交源码并创建新本地 annotated tag，不推送、不发布镜像、不导入 Gateway 或部署；既有 tag/URI 不变。未重复进行真实图商或实际智能体宿主验收。
