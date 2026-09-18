# Gateway 外部对接资料

本目录集中保存**由引擎维护、供外部 Gateway 对接使用的版本化资料**，不是 Gateway 源码，也不是引擎运行时模块。它从原仓库根目录 `gateway/` 整体迁入；不在旧位置保留副本或符号链接，避免出现两份契约来源。

放在 `docs/integrations/` 表示职责归属，不表示这些文件只是文字示例：构建、测试和外部版本导入仍会读取其中的机器可读配置及 Schema。

## 1. 内容与事实源

| 文件或目录 | 用途 |
| --- | --- |
| [`image-version.yaml`](image-version.yaml) | 引擎 ImageVersion 元数据、请求 Schema 来源和可选 `mcp_ui` 声明 |
| [`request-schema.json`](request-schema.json) | 已有 Gateway 请求 Schema 交付文件；实际来源按 manifest 声明，当前指向仓库 OpenAPI |
| [`result-summary-schema.json`](result-summary-schema.json) | 已有结果摘要契约，不等同于安全 MCP 展示模型 |
| [`constraint-config.yaml`](constraint-config.yaml) | 约束配置交付文件 |
| [`mcp-result-view-schema.json`](mcp-result-view-schema.json) | 安全 `engine_view` 的 Draft 2020-12 Schema，亦是 View 构建期校验器的输入 |
| [`fixtures/mcp-result-view/`](fixtures/mcp-result-view/) | 合成输入、独立期望投影、语义断言及包装样例；不是业务归档或生产投影实现 |

字段映射和降级语义仍以 [MCP 结果展示契约](../../components/mcp-result-view-contract.md) 为准，页面实现及验收边界见 [独立 MCP Apps 结果查看器](../../components/mcp-app.md)。不在本目录重复维护实现文档。

manifest 的 `request_schema_source.file: docs/openapi.yaml` 相对**引擎仓库根目录**解释，不相对本目录；此次搬迁不改变其含义、契约版本、Schema `$id`、字段或求解行为。

## 2. 本仓维护

- 本仓构建、测试、文档链接及 `skills/vrp0-metadata/` 生成器默认目录统一使用 `docs/integrations/gateway/`。
- 生成器仍支持显式 `--output-dir`，不要为修改目录而重新生成并覆盖已有配置或 Schema。
- 修改 Schema 或 `mcp_ui` 时按[测试说明](../../operations/testing.md#81-独立-mcp-apps-view)重建、校验和回归；仅路径迁移也须确认构建/测试仍能定位资料。
- MCP HTML 仍交付到 `src/main/resources/META-INF/resources/static/mcp-app.html`，不迁入文档目录。

## 3. Gateway 导入交接

本次只迁移引擎仓库资料，**未修改 Gateway 代码、部署配置、已有 tag 或已导入快照**。当前 Gateway 已提供元数据根目录配置，导入采用新布局的 tag 时，需要在 Gateway 侧将：

```text
GATEWAY_CODE_REPOSITORY_METADATA_ROOT=docs/integrations/gateway
```

与对应部署对齐。它对应 Gateway 的 `gateway.code-repository.metadata-root`，现有默认值是 `gateway`；不更新配置时，默认导入路径不会自动发现本目录。此项不是引擎侧新增配置，也不应写入引擎 `.env`。

**该配置目前是 Gateway 实例级，而非每个引擎或 tag 独立配置。** 变更前须核对同实例的其他引擎和仍使用旧目录的历史 tag：全局切换可能影响它们的后续导入或重新导入，不能宣称透明兼容。历史版本保持原样，发布/导入方案须在 Gateway 联调时确认；本轮不通过保留两份元数据或修改 Gateway 实现绕过这一限制。

Gateway 的 OpenAPI 路径和 HTML 资源读取目录是独立约定，不随元数据目录一起移动。后续同步外部契约 fixtures 快照时，也需更新其来源路径记录。真实 Gateway 发布、地图网络与四宿主联调仍属于未验证项。
