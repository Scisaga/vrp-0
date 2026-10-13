# 双资源 MCP Apps 结果查看器

## 1. 状态与边界

Issue #183 的引擎侧双资源能力已实现。实施基线是 Gateway 契约 `docs/design/mcp-apps-contract.md` 的 SHA-256 `ddec63924b90f8bcce09c4066ee1d50782b9ed3f2c9ffd5dbf068c3532f6cd83`；Issue 评论只作历史交接。引擎继续使用 `gateway_mcp_result_v1`、`vrp0`、`schema_version=2` 和唯一 [`mcp-result-view-schema.json`](../integrations/gateway/mcp-result-view-schema.json)。当前源码版本为 `1.1.3-alpha-SNAPSHOT`，Gradle、OpenAPI 的版本声明和 Gateway 元数据同步；REST/引擎 MCP 行为及 Schema 不变。本次源码交付使用本地 tag `v1.1.3-alpha-SNAPSHOT`，不包含远端推送、镜像发布或部署。

当前只完成源码、确定性产物、离线契约和模拟宿主验证。**真实 VRP-0 tag 导入、批准 CSP/browser key、HERE Worker/WASM、真实地图网络及 ChatGPT、Claude、Quick Desktop、WorkBuddy 联合验收未验证。** 同版快照重导入只允许 Gateway 显式开启 `allow-snapshot-ui-refresh` 的开发态；正式发布仍需新 ImageVersion/tag。

## 2. 资源、工具与构建

`gateway/image-version.yaml` 对外仍只声明两个 MCP 资源，同时在 Map 声明下附带一个内部 renderer 产物：

| 资源 | 文件 | 工具 | 输入 | CSP |
| --- | --- | --- | --- | --- |
| Map | `mcp-map-app.html` | `gw_map_<32位image_version_id>` | `job_id`、可选 `engineer_id` | 父页不直接获得图商网络，只允许 Gateway renderer origin |
| Gantt | `mcp-gantt-app.html` | `gw_gantt_<32位image_version_id>` | 仅 `job_id` | 两个域名数组均为空 |

Gateway 展示工具采用 `gw_map_` / `gw_gantt_` 短前缀，完整 32 位小写 ImageVersion ID 不变，原始名称长度为 39 / 41；当前 Quick `planly_mcp__` 包装后为 51 / 53。这不是 MCP 的统一长度上限。引擎 View 只接受新名称，继续严格核对视图、任务和版本；页面刷新只使用已校验信封返回的工具名，不猜测名称，也不接受旧前缀。Gateway 与本仓 HTML 必须成套切换，旧会话需要同步目录并重开卡片。

`mcp-map-renderer.html` 不是第三个 Tool 或 MCP Resource。Gateway 与前两份页面原子导入它，并以带 ImageVersion ID 和 renderer bundle hash 的 HTTPS 地址发布。Map 父页从已校验 `map_context` 取得该精确地址，在运行时创建跨源 sandbox iframe；图商 SDK、瓦片、`unsafe-eval`、WASM 动态求值和 blob Worker 只存在于 renderer 的 HTTP CSP。父页、Gantt 和 MCP Host 的严格 CSP 不因此放宽。

Map/Gantt 都支持 `inline/fullscreen`，没有旧 `mcp-app.html` 或单资源兼容逻辑；三份产物任一失败时由 Gateway 将整套 MCP UI 判为不可发布。工具参数拒绝 `view`、版本 ID 和未知字段，ID 非空且最长 128 个 Unicode code points。

源码位于 `src/main/mcp-ui/`：`viewer.mjs`、`bridge.mjs`、`model.mjs`、`i18n.mjs` 和 `palette.mjs` 为共享层；`map-main.mjs` / `map-template.html` 与 `gantt-main.mjs` / `gantt-template.html` 是两个严格 MCP App 入口。Map 父页使用 `iframe-map.mjs` 和纯数据的 `map-scene.mjs`；只有 `renderer-main.mjs` / `renderer-template.html` 的构建入口导入 `maps.mjs` 与构建期 `mcp-network-policy`。构建器分别内联所需第一方 CSS/JS，并检查三份文件为严格 UTF-8、完整 HTML5、自包含且不超过默认 4 MiB；Map/Gantt 父页依赖闭包不得出现图商 adapter 或网络策略，Gantt 也不得出现 renderer 逻辑。

```bash
cd src/main/resources/META-INF/resources/static
npm ci --include=dev
npm run build:mcp-app
npm run verify:mcp-app
```

SDK 固定为 `@modelcontextprotocol/ext-apps@2.0.0` 普通入口，共享 Zod；`sdk-config.mjs` 在 SDK 初始化前设置 `jitless`。Map/Gantt 父页继续拒绝动态代码执行、静态嵌套页面、表单、跳转、未批准外部资源、秘密、调试路径和 `node_modules` 打包。Map 父页仅允许代码创建契约规定的一个 renderer iframe；renderer 的第一方代码仍禁止动态编译，声明中的放宽仅供所选图商 SDK 使用。

## 3. 信封与实例边界

页面只读取 `_meta.gateway_ui`，强制校验当前资源的固定 `view`、当前工具名、ImageVersion、任务身份、`result_summary=null` 和工程师定位：Map 的 `engineer_id` 为已验证焦点或 `null`，Gantt 固定为 `null`。只有 `result_state=ready`（Gateway 成功任务的展示态）且安全投影成功时 `engine_view` 才能非空；其他状态必须为 `null`。

每个卡片实例独立保存选择、视窗、滚动、全屏和播放状态。不使用 Cookie、Web Storage、全局任务缓存、REST 或对象存储。页面隐藏结果刷新按钮且不轮询；保留的只读刷新边界只允许调用信封中已验证的当前资源工具，Map 可携带当前合法工程师，Gantt 只携带任务 ID。取消、新输入、较新通知、权限失效和 teardown 都会使旧请求失效；销毁时释放地图、计时器、监听器和 SDK。

## 4. Map App

Map 父页保留 MCP SDK、信封校验、选择、布局和回放状态；renderer 只接收绘图所需的 marker、路线点、颜色/标签和公开 browser key，不接收 Gateway Token、完整信封或工具名。父页严格校验 HTTPS renderer origin、固定路径、ImageVersion ID 和 hash；随机 nonce 放在 URL fragment 中，首次握手只转移 `MessageChannel`，之后父子消息同时核对协议和 nonce。MCP Host 的父级 sandbox 会把后代 origin 继承为 opaque，因此首次 `postMessage` 不能使用精确 `targetOrigin`；安全边界由精确 iframe URL、父资源 `frameDomains`、HTTPS、无重定向的 Gateway 路由、随机 nonce 和私有 MessagePort 共同组成。销毁时关闭 port 并移除 iframe。

父页与 renderer 在私有通道上只交换白名单化的诊断状态，不传递原始异常、堆栈、URL、Key 或业务数据。成功阶段按 `renderer_iframe_created`、`renderer_document_loaded`、`renderer_channel_connected`、`amap_script_loaded`、`amap_sdk_ready`、`amap_map_created`、`amap_ready`、`amap_overlays_added`、`amap_fit_complete` 单调推进。Renderer iframe、通道、AMap 脚本、SDK、地图构造、ready、覆盖物和视图适配分别转换为稳定安全错误码；卡片失败时显示最后成功阶段与错误码，成功时不显示诊断行。强制 CSP 违规先作为诊断证据记录，不能因图商可选遥测、光标、标签或能力探测被宿主拦截就主动终止已经可用的地图；只有必要脚本或 ready 阶段实际失败时才归因 `MAP_CSP_BLOCKED`。异步失败后的销毁取消也不得用 `MAP_ABORTED` 覆盖首个可操作错误。HERE 与既有配置、无坐标及尺寸错误语义保持不变。

Inline Map 只展示全部/单工程师本地切换、点位、工单序号、路线方向、图例、平移、缩放与适配路线；不重复任务名称、任务状态、平台时间、结果指标或独立对象详情。切换工程师不请求后端，页面不显示结果刷新按钮。页面下方的“查看 Gantt 排程”只有用户点击才调用 `ui/message`，内容严格为一个 `user` 文本 ContentBlock：

```json
{"intent":"show_job_gantt","job_id":"<已验证任务>","image_version_id":"<已验证版本>"}
```

发送中禁止重复。失败、拒绝或超时未知时不自动重发、不离开地图，并显示可选择复制的文本。

Map 会话与全屏均移除底部“只读结果 · 业务计划时间”说明行及其分隔线、占位高度；保留下方 Gantt 入口，既有只读边界、业务时间与规划回放语义不变。

会话画布按实际可用宽度在桌面保持 3:2、窄屏保持 1:1；不以 iframe 当前高度计算会话高度，避免尺寸上报与宿主调整形成反馈循环。全屏入口并入工程师筛选和适配路线工具栏，不单独占用页头；图例移到画布下方，在有界区域内换行、滚动，不覆盖路线。适配路线为姓名标签与工单序号预留边距；尺寸变化只触发地图大小调整，保留实例、选择与视角。全屏仍使用剩余高度，不沿用会话比例。

路线取景改为取景框内带路线/点位的仅图标按钮。悬浮和键盘聚焦显示“显示完整路线”（英文“Show full routes”），与按钮可访问名称同步；提示可保持悬浮并由 Escape 关闭，重新悬浮或聚焦后恢复。取景继续调用既有地图适配逻辑，只调整当前筛选的视野，不清空工程师选择、不改写任务或重新求解；地图未就绪时保持禁用。提示及其事件监听随当前卡片销毁，不增加共享状态或资源。

Fullscreen Map 沿用只读侧栏、焦点、视角、规划回放、速度、进度和跟随能力。回放默认暂停；退出全屏、页面隐藏、地图失败、权限失效或销毁时暂停。回放只使用 Map profile 已验证的原路线几何和计划时间，不能伪造直线、返程时间或实时位置。

## 5. Gantt App

Inline Gantt 使用真实业务时间轴、工程师本地筛选、紧凑的行程/等待/服务阶段条和局部滚动；默认采用原缩小一档的时间轴密度，不再提供放大或缩小按钮。明确的虚拟工程师从排程行、工程师筛选和全屏工程师列表中隐藏；未知类型保留，原投影、工单归属和业务计数不改写。顶部刻度只显示时分秒，完整业务日期在左侧工程师名下单独展示；刻度提示及可访问名称保留完整日期时间。会话排程高度随可见行数收缩，行多时在有界区域内滚动，单工程师详情紧贴排程，不留固定高度空白；未选择对象时不保留空详情区。Gantt 移除底部“只读结果”说明行，时间轴可访问说明仍标明业务计划时间。

页面不包含任务摘要、地图页签、地图 SDK、browser key、adapter 或网络请求。Fullscreen 在完整时间轴右侧提供工程师/工单侧栏、检索、详情和选择联动；不包含地图或回放，仍填满宿主剩余高度。结果通知将已选工程师明确标为虚拟时清除该工程师的本地焦点及详情，不把其继续保留在隐藏排程中。

Gantt 阶段图例和工程师筛选共用同一行，图例左对齐、筛选右对齐，不保留独立筛选工具栏。窄屏仅允许图例内部换行，筛选仍在同行右侧且保留可访问名称；对象列表入口移到页头操作区。未选择对象的会话或全屏详情区保持空且不占位，不显示选择工程师或工单的说明注释，选择后的详情及 Map 既有提示不变。

Map/Gantt 顶栏均不显示 VRP-0 Logo 或系统名称；Gantt 仍显示当前视图标题，Map 页面操作并入工具栏。两个 App 都跟随宿主中英文、浅深主题、显示模式和尺寸，保持键盘焦点、读屏名称、非纯色状态表达与 `prefers-reduced-motion` 支持。视觉事实源仍是 [`docs/ui/theme.md`](../ui/theme.md)。

## 6. 双 Profile 与安全投影

唯一 Schema 不变。同一 59-case 合成集合同时覆盖 Map/Gantt 人工 golden、诊断和语义断言：

* Map 只输出工程师起点或工单位置引用的 POI，保留坐标、路线端点、折线、来源与度量；校验坐标、路线段位、几何及回放资格。不可播放只给出安全原因，不伪造路线或时间。
* Gantt 只输出其侧栏/时间轴引用的 POI，并固定 `location=null`；`agent.routes` 未知为 `null`，已知则保留长度、顺序和空洞，仅保留合法 `route_source`，其他四个路线字段固定为 `null`。它校验身份、引用、顺序、班次、计划时间、路线段位和来源，不运行地图几何或回放资格分析。
* Gantt `map_context` 只保留 provider/locale，固定 `enabled=false`、`browser_key=""`、`js_url=""`、`css_url=null`、`renderer_url=""`、`renderer_origin=""`。

外层 fixtures 分别覆盖两资源的 ready、空结果与失败/未就绪状态，已删除“非成功仍携带模型”样例。大向量保留 200 工程师、1,000 工单和 4,097 点折线；Gateway 默认 8 MiB 结果上限由 Gateway 明确失败处理，页面和投影不得截断。

## 7. 验证与发布交接

测试命令和分层见 [`docs/operations/testing.md`](../operations/testing.md)，覆盖构建确定性、双资源初始化、renderer 握手、刷新按钮隐藏及固定工具边界、`ui/message`、全屏拒绝、权限清理、多卡隔离、销毁、双语、主题、窄屏、键盘、恶意文本、大结果及 Gantt 零地图请求。发布前还需执行 `./gradlew allStableTest` 和 JVM 打包，核对 JAR 内三份 HTML 与工作区逐字节一致，且任何 JAR 都不含 `static/node_modules`。

Gateway 双资源与隔离 renderer 能力已实现，但真实导入与宿主验收仍按 §1 标为未验证。Renderer CSP 只是精确来源申请，不是地图可用证明；不得用通配符、服务端密钥或放宽 MCP 父页 CSP 绕过。正式发布不得移动或覆盖已发布 tag。

### 2026-10-08 短展示工具名验证记录

本地使用 Node 24.21.0 完成 `npm run build:mcp-app`、`npm run verify:mcp-app`、`npm run test:mcp-unit`（135 项通过）与 `npm run test:mcp-ui`（22 项通过）；`python3 -B -m unittest discover -s scripts/tests -p 'test_mcp_result_view_contract.py' -v`（17 项通过）。npm 命令在静态资源目录执行。Map/Gantt HTML 已重新生成，renderer 字节不变，业务投影 golden 不变。Gateway 对应 JVM 183 项、前端 215 项通过。

此记录不是全量 `allStableTest` 或发布验收。未执行线上部署、tag 发布、版本停用或真实导入；Quick 真机工具调用与卡片渲染均待分别验收。发布与切换步骤仍按部署文档执行。

### 1.1.2-alpha-SNAPSHOT 源码发布门禁

版本升级后再次通过 MCP 产物验证、135 项 Node 单元测试、17 项 Python 契约测试和 22 项 Playwright 页面测试。在线 Gradle 首次执行因本机代理连接拒绝而失败；随后 `./gradlew --offline allStableTest quarkusBuild` 使用缓存依赖成功，稳定测试 138 项单元、76 项进程内应用测试均通过。`vrp-0-1.1.2-alpha-SNAPSHOT.jar` 中三份 MCP HTML 与工作区逐字节一致，且不包含 `static/node_modules`。源码推送仍不包含镜像发布、线上部署、Gateway 导入或版本启用，Quick 真机验收仍待执行。

### 2026-10-13 地图画布比例与工具栏回归

会话画布改为桌面 3:2、窄屏 1:1，全屏入口并入工具栏，图例移到画布下方，AMAP/HERE 适配路线均预留标签边距。使用已有 Node 24.21.0 通过产物确定性校验、136 项 Node 单元测试和 28 项 Playwright 页面测试；新增回归检查 920/760px 桌面、700/375/320px 窄屏、宿主跟随尺寸通知、全屏进出、实例/选择/视角保留，以及 200 名工程师图例的有界滚动。离线图商替身的桌面与窄屏布局截图已检查，临时检查文件仅保留在 Gateway 的忽略预览目录。

`./gradlew --offline allStableTest quarkusBuild` 通过（138 项单元、76 项进程内应用测试，失败/错误/跳过均为 0）；JAR 内三份 MCP HTML 与工作区逐字节一致，且不包含 `static/node_modules`。未修改 Schema、版本号、tag 或权限，未发布、部署或导入线上版本；真实瓦片及四个真实宿主仍未验收。

### 2026-10-13 Gantt 紧凑排程回归

Gantt 默认采用原缩小一档的密度并移除缩放按钮，排程行/工单条缩为约 52px/36px；虚拟工程师不出现在排程、筛选和全屏工程师列表中，未知类型及原投影数据保留。顶部只显示时分秒，左侧单独显示完整日期；会话排程按可见行数收缩，详情紧接排程，Gantt 底部只读说明行移除。Map 的比例、图例和页脚保持既有行为。

使用已有 Node 24.21.0 通过产物确定性校验、136 项 Node 单元测试与 36 项 Playwright 页面测试。新增 8 项 Gantt 回归覆盖默认密度、紧凑尺寸、虚拟/未知类型、日期与时间分区、宿主高度收缩、窄屏/双语/全屏、跨日、选中工程师变为虚拟后的清理、未知集合及零时长服务。合成样例的全部工程师和单工程师详情截图已检查，临时文件仅在 Gateway 忽略预览目录，未访问真实任务或地图。

首次全量 JVM 应用测试中，既有场景导入用例发生一次 HTTP 读取超时；未修改用例或超时设置，随后单独复跑 `./gradlew --offline allStableTest quarkusBuild` 通过（138 项单元、76 项应用测试，失败/错误/跳过均为 0）。JAR 内三份 MCP HTML 与源码产物逐字节一致，且不包含 `static/node_modules`。未变更 Schema、版本号、tag、权限或线上状态；部署、Gateway 导入及真实客户端展示仍未验收。

### 2026-10-13 Gantt 图例同行筛选与空详情回归

工程师下拉框并入阶段图例行右侧，移除独立筛选行；窄屏图例内部换行，筛选仍保持同行右侧并保留可访问名称，对象列表入口移到页头。Gantt 未选对象的会话及全屏详情区均为空、不占位且不显示选择说明；选择后的详情与 Map 既有提示保持。

已有 Node 24.21.0 下通过产物确定性校验、136 项 Node 单元测试和 42 项 Playwright 页面测试；新增 6 项检查 920/760/375/320px 的同行左右位置及双语可访问名称，以及两种语言下未选择、选择和清除选择的详情状态。桌面及窄屏合成样例截图已检查，临时文件仅在 Gateway 忽略预览目录。`./gradlew --offline allStableTest quarkusBuild` 通过（138 项单元、76 项应用测试，失败/错误/跳过均为 0）；JAR 内三份 HTML 与工作区逐字节一致，且不含 `static/node_modules`。未变更协议、版本、tag、权限或线上状态，真实 Gateway 导入及客户端展示仍未验收。

### 2026-10-13 Map 路线取景图标与提示回归

路线取景改为仅显示取景框/路线点位的内联图标，悬浮及聚焦提示“显示完整路线”，英文为“Show full routes”；提示可悬浮、Escape 关闭并在重新触发后恢复，按钮可访问名称与提示同步。原路线适配调用、筛选保留和未就绪禁用不变，销毁释放提示监听。

已有 Node 24.21.0 下通过产物确定性校验、136 项 Node 单元测试和 49 项 Playwright 页面测试；新增 7 项检查图标保留、悬浮/键盘提示、双语与主题更新、320/920px 会话/全屏边界、原适配调用及筛选保留、禁用态和销毁清理。合成样例图标及悬浮提示截图已检查，临时文件仅在 Gateway 忽略预览目录。`./gradlew --offline allStableTest quarkusBuild` 通过（138 项单元、76 项应用测试，失败/错误/跳过均为 0）；JAR 内三份 HTML 与工作区逐字节一致，且不含 `static/node_modules`。未修改协议、版本号、tag、权限或线上状态；真实 Gateway 导入及客户端验收仍待执行。

### 2026-10-13 Map 底部说明行移除回归

Map 会话与全屏移除“只读结果 · 业务计划时间”说明行、分隔线及占位，保留 Gantt 入口和规划回放提示。已有 Node 24.21.0 下通过产物确定性校验、136 项 Node 单元测试与 50 项 Playwright 页面测试；覆盖桌面/窄屏底部布局、筛选、双语与主题切换、全屏进出及既有 Gantt 查看意图。合成样例截图已检查，临时文件仅在 Gateway 忽略预览目录。

首次 JVM 稳定门禁出现两个既有场景导入 HTTP 读取超时及一个预期 404、实际 400 的断言失败；未修改用例、断言或超时设置，独立复跑 `./gradlew --offline allStableTest quarkusBuild` 通过（138 项单元、76 项应用测试，失败/错误/跳过均为 0）。JAR 内三份 HTML 与工作区逐字节一致，且不含 `static/node_modules`。未修改协议、版本号、tag、权限或线上状态；未部署、导入 Gateway 或执行真实宿主验收。

### 2026-10-13 1.1.3-alpha-SNAPSHOT 版本升级验证

工作区版本由 `1.1.2-alpha-SNAPSHOT` 升为 `1.1.3-alpha-SNAPSHOT`，同步 Gradle、发布 OpenAPI 和 Gateway 镜像元数据；应用契约测试同时验证运行时、发布 OpenAPI 与镜像元数据版本一致。API/MCP Schema 与三份 HTML 字节未因本次版本升级改变，历史验证记录和既有 tag 保持不变。

通过 4 项元数据目录测试、MCP 产物确定性校验、136 项 Node 单元测试及 `./gradlew --offline allStableTest quarkusBuild`（138 项单元、76 项应用测试，失败/错误/跳过均为 0）。新版本 JAR 中三份 HTML 与工作区逐字节一致，runner manifest 为 `1.1.3-alpha-SNAPSHOT`，打包不含 `static/node_modules`。本次未重复执行此前已通过的 50 项页面测试；未创建或推送新 tag，未发布镜像、部署或导入 Gateway。

### 2026-10-13 1.1.3-alpha-SNAPSHOT 本地源码交付

本次界面调整、生成的 MCP HTML、回归测试、版本声明和对应文档统一提交，在该提交上创建本地 annotated tag `v1.1.3-alpha-SNAPSHOT`。既有 tag 不移动或覆盖；不推送提交或 tag，不发布容器镜像、部署或导入 Gateway。上节版本升级门禁和此前界面回归结果保持，源码 tag 不表示真实宿主或图商验收完成。
