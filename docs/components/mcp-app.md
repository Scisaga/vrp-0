# 双资源 MCP Apps 结果查看器

## 1. 状态与边界

Issue #183 的引擎侧双资源能力已实现。实施基线是 Gateway 契约 `docs/design/mcp-apps-contract.md` 的 SHA-256 `ddec63924b90f8bcce09c4066ee1d50782b9ed3f2c9ffd5dbf068c3532f6cd83`；Issue 评论只作历史交接。引擎继续使用 `gateway_mcp_result_v1`、`vrp0`、`schema_version=2` 和唯一 [`mcp-result-view-schema.json`](../integrations/gateway/mcp-result-view-schema.json)，未修改 REST、引擎 MCP、OpenAPI、版本号或 tag。

当前只完成源码、确定性产物、离线契约和模拟宿主验证。**真实 VRP-0 tag 导入、批准 CSP/browser key、HERE Worker/WASM、真实地图网络及 ChatGPT、Claude、Quick Desktop、WorkBuddy 联合验收未验证。** 同版快照重导入只允许 Gateway 显式开启 `allow-snapshot-ui-refresh` 的开发态；正式发布仍需新 ImageVersion/tag。

## 2. 资源、工具与构建

`gateway/image-version.yaml` 只声明两个资源：

| 资源 | 文件 | 工具 | 输入 | CSP |
| --- | --- | --- | --- | --- |
| Map | `mcp-map-app.html` | `gateway.ui.map_result_<32位image_version_id>` | `job_id`、可选 `engineer_id` | 当前有依据的精确 HTTPS origins |
| Gantt | `mcp-gantt-app.html` | `gateway.ui.gantt_result_<32位image_version_id>` | 仅 `job_id` | 两个域名数组均为空 |

两者都支持 `inline/fullscreen`，没有旧 `mcp-app.html` 或单资源兼容逻辑；任一资源失败时由 Gateway 将整套 MCP UI 判为不可发布。工具参数拒绝 `view`、版本 ID 和未知字段，ID 非空且最长 128 个 Unicode code points。

源码位于 `src/main/mcp-ui/`：`viewer.mjs`、`bridge.mjs`、`model.mjs`、`i18n.mjs` 和 `palette.mjs` 为共享层；`map-main.mjs` / `map-template.html` 与 `gantt-main.mjs` / `gantt-template.html` 是独立入口。只有 Map 入口导入 `maps.mjs` 与构建期 `mcp-network-policy`。构建器分别内联 CSS、SDK、Zod 与 Ajv standalone validator，并检查每份文件为严格 UTF-8、完整 HTML5、自包含且不超过默认 4 MiB；Gantt 依赖闭包不得出现地图模块、地图 origin 或网络策略。

```bash
cd src/main/resources/META-INF/resources/static
npm ci --include=dev
npm run build:mcp-app
npm run verify:mcp-app
```

SDK 固定为 `@modelcontextprotocol/ext-apps@2.0.0` 普通入口，共享 Zod；`sdk-config.mjs` 在 SDK 初始化前设置 `jitless`。构建和校验拒绝动态代码执行、嵌套页面、表单、跳转、未批准外部资源、秘密、调试路径和 `node_modules` 打包。

## 3. 信封与实例边界

页面只读取 `_meta.gateway_ui`，强制校验当前资源的固定 `view`、当前工具名、ImageVersion、任务身份、`result_summary=null` 和工程师定位：Map 的 `engineer_id` 为已验证焦点或 `null`，Gantt 固定为 `null`。只有 `result_state=ready`（Gateway 成功任务的展示态）且安全投影成功时 `engine_view` 才能非空；其他状态必须为 `null`。

每个卡片实例独立保存选择、视窗、滚动、全屏和播放状态。不使用 Cookie、Web Storage、全局任务缓存、REST 或对象存储。页面隐藏结果刷新按钮且不轮询；保留的只读刷新边界只允许调用信封中已验证的当前资源工具，Map 可携带当前合法工程师，Gantt 只携带任务 ID。取消、新输入、较新通知、权限失效和 teardown 都会使旧请求失效；销毁时释放地图、计时器、监听器和 SDK。

## 4. Map App

Inline Map 只展示全部/单工程师本地切换、点位、工单序号、路线方向、图例、平移、缩放与适配路线；不重复任务名称、任务状态、平台时间、结果指标或独立对象详情。切换工程师不请求后端，页面不显示结果刷新按钮。页面下方的“查看 Gantt 排程”只有用户点击才调用 `ui/message`，内容严格为一个 `user` 文本 ContentBlock：

```json
{"intent":"show_job_gantt","job_id":"<已验证任务>","image_version_id":"<已验证版本>"}
```

发送中禁止重复。失败、拒绝或超时未知时不自动重发、不离开地图，并显示可选择复制的文本。

Fullscreen Map 沿用只读侧栏、焦点、视角、规划回放、速度、进度和跟随能力。回放默认暂停；退出全屏、页面隐藏、地图失败、权限失效或销毁时暂停。回放只使用 Map profile 已验证的原路线几何和计划时间，不能伪造直线、返程时间或实时位置。

## 5. Gantt App

Inline Gantt 使用真实业务时间轴、工程师本地筛选、行程/等待/服务阶段条、缩小时间轴和局部滚动；缩放操作只展示“缩小时间轴”，不展示“放大时间轴”。页面不包含任务摘要、地图页签、地图 SDK、browser key、adapter 或网络请求。Fullscreen 在完整时间轴右侧提供工程师/工单侧栏、检索、详情和选择联动；不包含地图或回放。

两个 App 都跟随宿主中英文、浅深主题、显示模式和尺寸，保持键盘焦点、读屏名称、非纯色状态表达与 `prefers-reduced-motion` 支持。视觉事实源仍是 [`docs/ui/theme.md`](../ui/theme.md)。

## 6. 双 Profile 与安全投影

唯一 Schema 不变。同一 59-case 合成集合同时覆盖 Map/Gantt 人工 golden、诊断和语义断言：

* Map 只输出工程师起点或工单位置引用的 POI，保留坐标、路线端点、折线、来源与度量；校验坐标、路线段位、几何及回放资格。不可播放只给出安全原因，不伪造路线或时间。
* Gantt 只输出其侧栏/时间轴引用的 POI，并固定 `location=null`；`agent.routes` 未知为 `null`，已知则保留长度、顺序和空洞，仅保留合法 `route_source`，其他四个路线字段固定为 `null`。它校验身份、引用、顺序、班次、计划时间、路线段位和来源，不运行地图几何或回放资格分析。
* Gantt `map_context` 只保留 provider/locale，固定 `enabled=false`、`browser_key=""`、`js_url=""`、`css_url=null`。

外层 fixtures 分别覆盖两资源的 ready、空结果与失败/未就绪状态，已删除“非成功仍携带模型”样例。大向量保留 200 工程师、1,000 工单和 4,097 点折线；Gateway 默认 8 MiB 结果上限由 Gateway 明确失败处理，页面和投影不得截断。

## 7. 验证与发布交接

测试命令和分层见 [`docs/operations/testing.md`](../operations/testing.md)，覆盖构建确定性、双资源初始化、刷新按钮隐藏及固定工具边界、`ui/message`、全屏拒绝、权限清理、多卡隔离、销毁、双语、主题、窄屏、键盘、恶意文本、大结果及 Gantt 零地图请求。发布前还需执行 `./gradlew allStableTest` 和 JVM 打包，核对 JAR 内两份 HTML 与工作区逐字节一致，且任何 JAR 都不含 `static/node_modules`。

Gateway 双资源能力已实现，但真实导入与宿主验收仍按 §1 标为未验证。Map CSP 只是精确来源申请，不是地图可用证明；不得用通配符、代理、空 CSP 或服务端密钥绕过。正式发布不得覆盖当前 `1.1.0-alpha-SNAPSHOT` tag。
