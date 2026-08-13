# 运行与部署

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
