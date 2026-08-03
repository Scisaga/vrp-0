# vrp-0 AGENTS

本文只保留每次任务开始前需要立即识别的事实源、核心约束和联动规则。完整开发规则见 [docs/agent-rules/general.md](./docs/agent-rules/general.md)。

## 1. 事实源入口

* [docs/README.md](./docs/README.md) 是文档目录、阅读顺序、职责边界和更新规则入口。
* [docs/overview/requirements.md](./docs/overview/requirements.md) 记录当前已实现需求。
* [docs/design/architecture.md](./docs/design/architecture.md)、[solver.md](./docs/design/solver.md)、[domain-model.md](./docs/design/domain-model.md)、[data-storage.md](./docs/design/data-storage.md) 和 [security.md](./docs/design/security.md) 分别负责对应设计事实。
* [docs/interfaces/api.md](./docs/interfaces/api.md) 负责 REST 语义；精确路径、参数、响应和 Schema 以 [docs/openapi.yaml](./docs/openapi.yaml) 为准。
* [docs/reference/mcp.md](./docs/reference/mcp.md) 负责 MCP 接入和 Tool 契约。
* [docs/interfaces/frontend.md](./docs/interfaces/frontend.md) 与 [docs/ui/theme.md](./docs/ui/theme.md) 分别负责页面行为和视觉规则。
* [docs/operations/testing.md](./docs/operations/testing.md)、[coverage-inventory.md](./docs/testing/coverage-inventory.md) 和 [deployment.md](./docs/operations/deployment.md) 分别负责测试规则、覆盖清单与运行部署。

## 2. 不可破坏的核心约束

* 一个运行实例只维护一个当前场景；创建或更新都写入同一 current 位置，不新增场景列表项。
* 按导入替换语义保存或删除当前场景会清理求解任务历史；任务运行时禁止修改或删除场景。
* 求解任务可以保留历史，最新任务是当前任务；同一时刻只允许一个任务处于调度中或求解中。
* REST、MCP 和静态控制台操作同一份当前场景与任务数据。
* 不根据文档空白新增接口、配置、状态、约束、存储结构或产品能力。

## 3. 现有规则

1. 生成文档时，有不确定的点，统一询问，不要直接猜测。
2. 修改文档时，如果只让你改一部分，不要对其他内容做任何改动。
3. REST 接口或对外模型契约变化时，需要生成并更新 `docs/openapi.yaml`。
4. 修改会影响 OpenAPI 的接口或模型代码时，需要同步补充或更新 OpenAPI 注解/注释（如 @Operation、@Schema），以支撑 OpenAPI 文档生成。

接口契约没有变化的纯说明性文档修改不重写 `docs/openapi.yaml`。

## 4. 文档联动规则

具体联动关系以 [docs/README.md 的更新规则](./docs/README.md#6-更新规则)为准。只修改受影响文件，不顺带扩展无关设计或覆盖工作区中的既有用户改动。
