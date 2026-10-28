# 运行与部署

1536 JPEG 底图增量需配套交付 Gateway 与支持 1.5× 的 Map HTML，并重建/校验 Map、Gantt 两份 HTML；不新增图片档声明或版本分流。只支持 1×/2× 的现有页面不能与新出图代码混用。本地先用 Gateway 工作区预览验证；正式交付使用新资源 hash，不覆盖历史资源 URI，不自动导入或部署。

### 2026-10-28 开发 SNAPSHOT 重发授权

用户明确要求提交、发布并重打 tag，本次保持 `1.1.4-alpha-SNAPSHOT`，配套 Gateway `1.1.1-SNAPSHOT`，将各自同名 annotated tag 移至本次增量提交。这是对下文初次源码交付“不移动 tag”边界的显式开发 SNAPSHOT 例外，不放宽其他正式版本及历史资源 URI 的不可变规则。VRP0 原 tag 指向 `a084cfc`；操作前记录并在本地保留原 tag 对象，远端 tag 以精确旧对象 lease 更新，并与各仓 main 提交原子推送，远端变化则停止。

本次提交只包含 1.5× 图片读取、最终 Map HTML、相关契约与测试；Gantt 字节不变。用户确认本次发布仅为代码和 tag 推送，不构建或推送容器镜像，不执行 Gateway 原子重导入、实际部署或生产配置修改，不宣称真实 GPT 展示已通过。开发 SNAPSHOT 后续重导入仍须显式启用 Gateway 既有开关并生成新 hash。

## 1. 文档目的与边界

本文负责开发运行、JVM/native/container 构建、Docker Compose、文件目录、运行配置、密钥、地图服务、MCP、Metrics 和启动验证。

本文不设计云平台、集群编排、发布流水线、网络拓扑或新的健康检查能力，也不保存任何真实密钥。

## 2. 运行前提

* 开发和 JVM 构建使用 JDK 21 与仓库内 Gradle Wrapper。
* native 构建按当前 Gradle 配置使用容器 builder，需要可用的 Docker 环境。
* 默认 HTTP 端口为 `8080`。
* 服务进程必须能够写入场景和任务存储目录；启动时还会在进程工作目录读写 `deploy_info.json`，因此该目录也必须可写。服务还需能够访问所配置的外部地图服务。

## 3. 开发运行

```bash
./gradlew quarkusDev
```

本地后台调试可使用：

```bash
scripts/devctl.sh start
scripts/devctl.sh restart
scripts/devctl.sh stop
```

该脚本通过独立的非 daemon Gradle 进程调用 `quarkusRunDebug`，默认开放 JDWP `5005`，每次启动从仓库根目录 `.env` 重新加载运行变量，并把 PID 与日志写入 `build/local/`。停止时会同时终止 Gradle 启动链与对应的 Quarkus 开发 JVM；即使 `gradle clean` 已删除 `build/local/` 中的 PID 文件，也会根据命令行中的当前仓库路径和 Quarkus Dev 参数扫描残留进程后停止，避免旧实例继续占用端口。`.env` 不提交到仓库。

## 4. JVM 构建与运行

```bash
./gradlew quarkusBuild -x test
java -jar build/quarkus-app/quarkus-run.jar
```

正式构建前通常先运行 `./gradlew allStableTest`。JVM 容器使用 `src/main/docker/Dockerfile.jvm`，以非 root 用户运行，并预创建 `/data/scenarios` 和 `/data/solver_jobs`。

稳定测试的图商配置独立于开发或部署配置：Gradle `test`、`appTest` 的子进程默认禁用真实地图及地址服务调用，避免场景导入因 `.env` 中 HERE/AMAP 配置而超时。该隔离仅作用于稳定测试，应用打包、实际运行和显式启用的外部测试仍使用各自的既有配置，详见[测试说明](testing.md#4-fixture-与文件隔离)。不通过跳过应用测试或扩大 HTTP 超时掩盖构建失败。

当前工作区版本为 `1.1.4-alpha-SNAPSHOT`，同步维护 Gradle 应用版本、发布 OpenAPI 的 `info.version` 和 Gateway 镜像元数据版本。该版本交付服务端 SVG 地图 View、高清与边界/路段交互，Gantt 语义及 API/MCP Schema 不变；源码交付使用新 annotated tag `v1.1.4-alpha-SNAPSHOT`，配套 Gateway `1.1.1-SNAPSHOT`。本地提交/tag 不代表远端推送、容器镜像发布或 Gateway 导入，既有 tag 不移动或覆盖。

```bash
./gradlew quarkusBuild -x test
docker build -f src/main/docker/Dockerfile.jvm -t vrp-0:local .
docker run --rm -p 8080:8080 \
  -v vrp-data:/data \
  -e JAVA_OPTS_APPEND="-Dquarkus.http.host=0.0.0.0 -Dvrp.scenario.store.dir=/data/scenarios/ -Dvrp.solverjob.store.dir=/data/solver_jobs/ -Djava.util.logging.manager=org.jboss.logmanager.LogManager" \
  vrp-0:local
```

运行容器时通过环境或 `JAVA_OPTS_APPEND` 注入存储、地图和 MCP 配置，不把配置写入镜像层。

## 5. Native 构建与运行

```bash
./gradlew quarkusBuild -Dquarkus.package.type=native -x test
./build/*-runner -Dquarkus.http.host=0.0.0.0
```

仓库同时保留 native 与 native-micro Dockerfile。native 镜像只复制可执行文件；若启用 MCP 文档端点，还必须确保运行目录的祖先路径中存在固定的 `docs/reference/mcp.md`，否则该文档请求返回不存在。

## 6. Docker Compose

`docker-compose.yml` 构建 JVM 镜像、把容器 `8080` 映射到宿主机回环地址，并把命名卷 `vrp-data` 挂载到 `/data`。运行前先生成 JVM 构建产物：

```bash
./gradlew quarkusBuild -x test
docker compose up --build
```

Compose 默认关闭 MCP，地图密钥与 MCP Token 均从环境变量读取。需要 MCP 时必须同时设置 `VRP_MCP_ENABLED=true`、强随机 `VRP_MCP_AUTH_TOKEN` 和适当的 `VRP_MCP_ALLOWED_ORIGINS`；用于非本地环境时还必须通过入口代理控制 REST、静态控制台和管理端点的暴露范围。

## 7. 数据目录

| 配置 | 默认值 | 内容 |
| --- | --- | --- |
| `vrp.scenario.store.dir` | `./data/scenarios/` | 当前场景主体、元数据和矩阵 |
| `vrp.solverjob.store.dir` | `./data/solver_jobs/` | 任务索引、历史任务、元数据和矩阵 |

容器示例改用 `/data/scenarios/` 和 `/data/solver_jobs/`。两个目录需要同一实例独占写入；当前文件仓库没有跨实例写协调。除此之外，进程工作目录需允许创建或更新 `deploy_info.json`。详细布局见[数据存储](../design/data-storage.md)。

## 8. 配置与密钥

默认配置位于 `src/main/resources/application.properties`，可通过 Quarkus 支持的系统属性或环境映射覆盖。主要配置组包括：

* 场景和任务存储目录；
* 地图服务启用、服务端密钥、限流、配额、超时和地址解析；
* 当前运行实例使用的地图适配器及相关矩阵能力；
* MCP 开关、路径、Bearer Token 和 Origin 允许列表；
* HTTP CORS、请求体上限和日志格式。

规则：

* 不提交 `.env`、Token、API key 或生产配置文件。
* MCP 默认关闭；启用时使用非空、非占位 Token，并按实际浏览器客户端配置 Origin。
* 浏览器地图需要下发 key 时，在地图平台限制域名和 API 权限。
* 当前默认 CORS 范围较宽，暴露到受控网络之外前应按部署入口收紧。
* 配额页可以更新当前运行实例的 AMap 和地址解析配置，因此其网络访问应受保护。

安全边界见[安全说明](../design/security.md)。

## 9. 地图服务

应用通过现有地图适配层提供地址解析、POI、路线和矩阵能力。部署时至少验证：

1. 所选适配器已启用且密钥有效。
2. 服务端能够访问外部 API 或配置的地址解析服务。
3. 配额、QPS 和超时适合当前请求规模。
4. 浏览器能够加载地图 SDK，域名限制允许当前控制台地址。
5. 场景位置与矩阵构建用一次受控小样例验证，不用大场景做启动探测。

## 10. MCP

MCP 使用 Streamable HTTP，默认路径和完整接入参数见 [MCP 参考](../reference/mcp.md)。部署检查：

* 显式设置开关和强 Token；
* 仅向需要的客户端开放网络入口；
* 浏览器客户端配置准确的 Origin 允许列表；
* JVM 镜像中保留 `docs/reference/mcp.md`，使参考文档端点可用；
* 不在日志、页面或客户端仓库配置中明文保存真实 Token。

### 10.1 独立 MCP Apps 产物

新版引擎交付只包含 `mcp-map-app.html`、`mcp-gantt-app.html` 两份 MCP Resource，随同一版本打包；原 `scenario.html` 与网页构建链路不变。Map manifest 声明 `render_mode: svg_snapshot_v1`，不声明 renderer；两资源的 CSP 网络域名数组为空。Gateway 原子导入两份 HTML，鉴权后从归档生成真实底图 SVG，经工具结果交付，不在公共模板或静态路由保存任务地图。

```bash
cd src/main/resources/META-INF/resources/static
npm ci --include=dev
npm run build:mcp-app
npm run verify:mcp-app
npm run test:mcp-unit
npm run test:mcp-ui
```

Node 只是构建/测试依赖，Gradle 不自动重建 HTML；禁止手改压缩产物。回到仓库根目录执行原引擎构建，核对 JAR 内两份 HTML 字节一致、不含 renderer 和 `static/node_modules`。

Map/Gantt HTML、manifest 与 Gateway SVG 契约必须成套交接。Gateway SVG 模式使用 v5 发布策略并将 render_mode 纳入 hash；未声明模式的旧 renderer 版本保持 v4 原身份。不得覆盖正式 tag/旧 URI，开发 SNAPSHOT 重导入仍须显式启用 Gateway 既有开关；新 hash 后重开卡片。本次按用户确认升版、提交并创建上述本地 tag，不推送、发布镜像、导入或部署。

上线前确认 Gateway 的服务端图商配置、静态地图授权与配额、署名和缓存授权；客户端不再需要图商域名或 iframe 来源，但目标宿主仍须支持内嵌 data 图片。分别记录真实 Gateway/AMAP/HERE 和 ChatGPT、Claude、Quick Desktop、WorkBuddy 的卡片、全屏、权限及失败重试验收；离线模拟不等于生产 UI ready。

元数据仍位于根 `gateway/`，参考 Schema/fixtures 仍在 `docs/integrations/gateway/`，不改变 REST/OpenAPI、版本号或线上状态。详见[组件说明](../components/mcp-app.md)。

## 11. Metrics 与启动验证

应用包含 Micrometer Prometheus registry，指标入口为 `/q/metrics`。Swagger UI 在当前配置中随应用提供，可用于开发联调，不应替代契约文件或生产访问控制。

当前构建没有专用 Health 扩展，Compose 也没有声明 healthcheck。启动验证使用现有可观察入口：

```bash
curl -I http://localhost:8080/
curl -fsS http://localhost:8080/q/metrics >/dev/null
curl -fsS http://localhost:8080/scenario/optional >/dev/null
```

预期根地址重定向到静态控制台，Metrics 可读取，当前场景可选查询在有无场景时都能正常返回。启用 MCP 后，再从受控客户端完成 initialize、tools/list 和一次只读 Tool 调用。

启动时会把磁盘中遗留的运行中任务重置为 `NOT_SOLVING`；验证时应确认这类任务没有被误认为仍在执行。

## 12. 非目标

本文不定义 Kubernetes、负载均衡、自动伸缩、分布式存储、备份周期或新监控告警平台，也不把启动探测等同于应用已实现的专用健康接口。
