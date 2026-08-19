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
| Script | `scripts/tests` | 本地开发运维脚本的环境隔离和进程生命周期 | 按相关脚本改动运行 |
| Static UI | `src/main/resources/META-INF/resources/static/tests` | 页面逻辑、布局契约、地图上下文和 i18n | 按前端改动运行 |

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

## 9. 完成标准

* 纯后端行为变更：相关定向测试通过，`./gradlew allStableTest` 通过。
* REST/MCP 变更：契约、拒绝路径、鉴权或状态一致性测试通过。
* 求解变更：约束或生命周期测试覆盖触发与边界路径。
* 本地开发脚本变更：运行 `scripts/tests` 下对应的 Shell 回归测试。
* 页面变更：相关 Node/Playwright 测试和组件校验通过。
* 外部能力变更：稳定测试使用替身或纯逻辑测试；真实联调结果单独说明。
* 纯文档变更：Markdown 链接、标题、术语和 `git diff --check` 通过，不强制运行代码测试。
* 实际覆盖变化后更新[测试覆盖清单](../testing/coverage-inventory.md)。

## 10. 非目标

本文不设定新的覆盖率阈值、不要求默认运行外部服务、不把 manual 脚本计入稳定门禁，也不创建新的测试平台。
