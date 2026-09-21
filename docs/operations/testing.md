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

`scripts/tests/test_gateway_metadata_layout.py` 验证根目录 `gateway/` 仅包含 Gateway 导入的三份元数据，参考 Schema、说明和 fixtures 留在 `docs/integrations/gateway/`；生成器默认输出及显式 `--output-dir` 均在临时目录验证，不覆盖仓库文件。

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
| 地图 Node | AMAP/HERE 上下文及 URL 策略、原段位/坐标轴/几何、不可播放来源、缺失数据、纯文本 marker、父页 renderer URL 校验、最小 scene、AMAP complete 超时、HERE 样式错误、容器尺寸合并/隐藏/销毁及失败、覆盖物与实例释放 |
| 构建 Node 与产物校验 | manifest/renderer 字段、精确 origin、Ajv standalone、父页与 renderer 依赖闭包、共享 Zod/拒绝 SDK with-deps、三份 HTML 自包含、敏感信息、第一方动态代码静态拒绝、确定性与过期产物 |
| 模拟浏览器 | 使用真实构建 HTML 与官方 View SDK，在 opaque-origin MCP App、跨源 renderer 和图商 SDK 替身中检查双资源初始化、nonce/MessageChannel 握手、布局、选择、刷新按钮隐藏与固定工具边界、消息发送、地图/Gantt、全屏拒绝、回放、Gantt 零地图请求、安全降级、实例隔离和生命周期；具体执行结果见当次记录 |

浏览器测试以不同合成 origin 的宿主、App iframe 和 renderer iframe 运行。宿主给 App `sandbox="allow-scripts"`，使父页及其后代继承 opaque origin；Map 父资源 CSP 仅允许 renderer origin，renderer HTTP CSP 才允许测试图商和动态执行。路由拦截提供 AMAP/HERE SDK 替身，未知请求中止；不请求真实瓦片、读取 `.env` 或使用真实 key。此配置验证严格父页、跨源握手与隔离绘图，不证明 HERE 真实 worker/WASM 或图商鉴权可用。

父页 SDK 安全回归在最终 Map/Gantt HTML 的应用脚本之前，用 parser 执行的测试脚本监测 `Function` / `eval` 调用和 CSP 动态求值违规，覆盖初始化、通知及 teardown，要求调用次数为零；进入 renderer 的 DevTools 操作不计入父页监测，因为调试器本身可能使用页面 `eval`。独立负向控制验证监测能发现被 `catch` 吞掉的探测。Renderer 的 `unsafe-eval` / WASM / blob Worker 只按其独立 CSP 验证；第一方 renderer 源码仍须通过静态无动态编译检查。

模拟测试使用 `playwright.config.mjs`，失败 trace/截图写入 `/tmp/vrp0-mcp-ui-playwright`，不进入业务目录或仓库。测试不向产品新增调试 wire 字段，也不把图商替身放入生产构建。CSP 错误、地图失败与数据/授权失败需分别断言；认证或权限失败应检查已渲染文本和视图缓存已清除，而非只检查错误横幅。地图替身覆盖 AMAP complete 超时及 HERE 样式错误/监听解除，但不能证明真实 SDK 的所有瓦片或 HTTP 401 失败都能被观测，具体检测边界见[地图与安全降级](../components/mcp-app.md#5-地图网络与安全降级)。

修改源码、模板、样式、词典、Schema、依赖锁文件或 `mcp_ui` 后都需重建并运行产物校验。`verify:mcp-app` 不写文件；CI 在重建后还对 `mcp-map-app.html`、`mcp-gantt-app.html` 与 `mcp-map-renderer.html` 执行 `git diff --exit-code`，防止任一产物落后于源码。MCP 构建独立于 `build:scenario`；共享 `result-presentation.css` / `result-presentation.mjs` 变化需运行 `build:css`、`build:scenario`、`build:mcp-app`，并由 `presentation.spec.mjs` 对照两端生产样式。共享展示层或前端工具链变化还需回归原 Node、Scenario 构建校验和 i18n 浏览器测试；不能因新增 View 通过而省略旧页面回归。

当次通过数量与执行状态只记录在[组件验证记录](../components/mcp-app.md#7-验证记录与未验证项)或测试报告，不在本文固定。真实 Gateway 与四宿主联合验收必须单列客户端版本、批准策略和受限 key 条件；模拟宿主通过不能将外部未验证项标为通过。

#### 显式启用真实 AMAP 联调

`src/test/mcp-ui/real-sdk-check.mjs` 不匹配默认 Node/Playwright 测试入口。它使用调用方提供的本地模拟宿主工具目录、其私有 PAT 配置以及指定的真实任务，只读调用 Gateway，直接使用结果中的 `map_context`，不更换 browser key。联调时必须读取 Gateway 实际发布的父资源和 renderer URL；不得再通过给 MCP 父页追加 `unsafe-eval` 或 blob Worker 模拟兼容模式。脚本与临时宿主如尚未适配三产物协议，应明确失败，不能用旧直载 SDK 结果作为 iframe 架构证据。

使用 Node 22，在仓库根目录执行（路径和任务 ID 由联调者提供；凭据不写在命令行）：

```bash
agent-browser --session vrp0-map-check open about:blank
MCP_REAL_SDK=1 \
MCP_PREVIEW_DIR=/absolute/path/to/mcp-live-preview \
MCP_REAL_JOB_ID='<job-id>' \
node src/test/mcp-ui/real-sdk-check.mjs
```

脚本检查 Gateway 返回的精确 renderer URL、父资源 `frameDomains`、renderer HTTP CSP、真实 SDK/Worker/瓦片请求、主画布尺寸、播放标记移动、筛选、视野和游标保留、全屏/退出/容器变化及关闭。动态执行权限只允许出现在 renderer 响应，不写入 MCP 父资源，也不代表目标桌面宿主已经验收。

默认脱敏报告及截图写入 `/tmp/vrp0-mcp-real-sdk`，可通过 `MCP_REAL_REPORT_DIR` 指定隔离目录；`MCP_BROWSER_SESSION` 可指定已启动的独立 agent-browser 会话。报告不记录 PAT 或 browser key，真实业务截图不提交到仓库。脚本只进行受控的小规模读取和地图操作，不进入稳定门禁；HERE 和实际桌面宿主仍需单独验收。

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
