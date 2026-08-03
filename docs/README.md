# vrp-0 文档总览

## 1. 文档目的与边界

本文是项目文档的统一入口，负责说明阅读顺序、各文件职责、文档之间的关系和更新规则。

本文不重复业务需求、接口字段、求解约束或部署参数的详细定义；这些内容以对应专题文档为准。文档只记录当前代码、配置、契约、测试或已确认运行口径能够支撑的事实，不作为新增能力的设计稿。

## 2. 当前核心边界

* 引擎在一个运行实例中只维护一个当前场景（current scenario）。场景可被创建、读取、替换和删除，不提供场景集合管理。
* 求解任务可以保留历史记录；“当前求解任务”指任务索引中的最新任务。
* 同一时刻只允许一个任务处于调度中或求解中。
* REST API、MCP 和静态控制台操作的是同一份当前场景和求解任务数据。
* 本文档体系描述现有求解引擎，不定义外部系统集成方案。

## 3. 建议阅读顺序

1. 新成员先读本页和[产品定位](./overview/product.md)。
2. 开始修改前读[通用开发规则](./agent-rules/general.md)。
3. 确认行为范围时读[当前需求](./overview/requirements.md)。
4. 按改动类型读取设计、接口、UI 或运维专题文档。
5. 涉及精确 REST 路径或字段时直接查阅 [OpenAPI 契约](./openapi.yaml)；涉及 MCP Tool 时查阅 [MCP 参考](./reference/mcp.md)。
6. 修改测试前结合[测试说明](./operations/testing.md)和[覆盖清单](./testing/coverage-inventory.md)。

## 4. 文件目录与权威分工

| 文件 | 负责内容 | 不负责内容 |
| --- | --- | --- |
| `docs/README.md` | 文档入口、阅读顺序、职责分工、关系和维护规则 | 专题事实的完整说明 |
| [`agent-rules/general.md`](./agent-rules/general.md) | 开发规则、变更边界、测试要求和完成定义 | 产品与实现细节 |
| [`overview/product.md`](./overview/product.md) | 产品定位、使用方式、目标、非目标和完成标准 | 详细需求与技术实现 |
| [`overview/requirements.md`](./overview/requirements.md) | 当前已实现的能力要求与业务边界 | 精确接口字段和代码结构 |
| [`design/architecture.md`](./design/architecture.md) | 组件职责、依赖方向和主要调用流程 | 类级 API 清单与部署步骤 |
| [`design/solver.md`](./design/solver.md) | 求解模型、约束类别、状态和求解生命周期 | REST 字段及页面布局 |
| [`design/domain-model.md`](./design/domain-model.md) | 领域对象、关系、职责和序列化边界 | 存储目录和接口字段全集 |
| [`design/data-storage.md`](./design/data-storage.md) | 文件布局、并发保护、原子写入、恢复和删除 | 业务需求与部署平台设计 |
| [`design/security.md`](./design/security.md) | 调用边界、MCP 认证、跨域、密钥、日志与文件访问 | 部署网络方案和未实现的身份系统 |
| [`interfaces/api.md`](./interfaces/api.md) | REST 语义、资源分组、状态、错误和兼容规则 | 精确路径、参数和 Schema 的重复定义 |
| [`interfaces/frontend.md`](./interfaces/frontend.md) | 控制台导航、页面行为和通用交互状态 | 视觉 token 及后端内部实现 |
| [`ui/theme.md`](./ui/theme.md) | 当前视觉语言、组件样式、响应式和可访问性规则 | 页面业务流程和视觉重设计 |
| [`operations/testing.md`](./operations/testing.md) | 测试任务、分层、隔离规则和完成门槛 | 逐个测试用例的覆盖状态 |
| [`operations/deployment.md`](./operations/deployment.md) | 运行、构建、容器、配置、数据目录和启动验证 | 产品需求与基础设施扩展设计 |

以下文件是辅助权威来源：

| 文件 | 权威范围 |
| --- | --- |
| [`openapi.yaml`](./openapi.yaml) | REST API 的精确机器可读路径、参数、请求体、响应和 Schema |
| [`reference/mcp.md`](./reference/mcp.md) | MCP 传输、认证、Tool 名称、参数和返回约定 |
| [`testing/coverage-inventory.md`](./testing/coverage-inventory.md) | 当前测试层级、功能域覆盖和已识别缺口的清单 |
| [`components/scenario-ui-componentization.md`](./components/scenario-ui-componentization.md) | Scenario UI 构建产物、Engine Host 集成边界和组件化维护细节 |

`功能描述.md`、`vrp-0-详细设计文档.md` 和 `测试代码指南.md` 是迁移前保留的旧文档，不再作为当前事实源。若其内容与本页列出的专题文档、代码或生成契约冲突，以当前专题事实源和实现为准。

## 5. 文档之间的关系

```text
product ──> requirements ──> architecture/domain/solver/storage/security
                                      │
                                      ├──> API 语义 ──> openapi.yaml
                                      ├──> 前端行为 ──> UI 主题
                                      └──> 测试与部署

MCP 语义 ──> reference/mcp.md
测试规则 ──> operations/testing.md ──> testing/coverage-inventory.md
```

上层文档说明“为什么”和“需要什么”，设计文档说明“当前怎样实现”，接口文档说明“怎样交互”，运维文档说明“怎样验证和运行”。同一事实只在负责它的文档中详细定义，其他文档仅摘要并链接。

## 6. 更新规则

| 变更 | 必须同步检查或更新 |
| --- | --- |
| REST 接口或对外模型 | 代码中的 OpenAPI 注解、`docs/openapi.yaml`、`interfaces/api.md`、相关测试 |
| 当前场景生命周期 | `overview/requirements.md`、`design/domain-model.md`、`interfaces/api.md`、`interfaces/frontend.md`、测试 |
| 求解约束、状态或生命周期 | `overview/requirements.md`、`design/solver.md`、`design/domain-model.md`、API/前端说明、测试 |
| 页面行为 | `interfaces/frontend.md` 和对应页面测试 |
| 视觉样式 | `ui/theme.md` 和必要的页面测试 |
| 文件存储 | `design/data-storage.md`、部署与存储测试 |
| 认证、密钥或访问边界 | `design/security.md`、`operations/deployment.md` 和安全测试 |
| 测试任务或覆盖变化 | `operations/testing.md`、`testing/coverage-inventory.md` |
| 部署方式或运行配置 | `operations/deployment.md`；涉及安全时同时更新 `design/security.md` |
| 文档增删改名 | 本页目录和所有受影响链接 |
| 核心事实源或全局约束 | 根目录 `AGENTS.md` |

更新时只修改受影响文档，不顺带扩写无关设计。遇到无法从实现或已确认口径判断的事项，应先确认，不以推断补全文档。

## 7. 常用命令

```bash
# 开发运行
./gradlew quarkusDev

# 稳定测试
./gradlew test
./gradlew appTest
./gradlew allStableTest

# 构建
./gradlew quarkusBuild -x test
```

完整测试与部署说明分别见[测试说明](./operations/testing.md)和[运行与部署](./operations/deployment.md)。

## 8. 非目标

本文不创建新的产品、架构或流程设计，只组织当前事实源及其维护关系。
