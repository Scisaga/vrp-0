# Gateway 外部对接资料

本目录集中保存**由引擎维护、供外部 Gateway 对接使用的版本化资料**，不是 Gateway 源码，也不是引擎运行时模块。Gateway 版本导入时读取的三份元数据保存在仓库根目录 `gateway/`，与默认导入路径一致；说明文档、参考 Schema 和测试样例保存在本目录，不保留重复副本或符号链接。

目录划分不改变机器可读文件的用途：Gateway 导入根目录元数据，本仓构建和测试仍读取对应的配置、Schema 与 fixtures。

## 1. 内容与事实源

| 文件或目录 | 用途 |
| --- | --- |
| [`gateway/image-version.yaml`](../../../gateway/image-version.yaml) | 引擎 ImageVersion 元数据、请求 Schema 来源和可选 `mcp_ui` 声明 |
| [`request-schema.json`](request-schema.json) | 请求 Schema 参考文件；Gateway 不读取此文件，请求契约来源为仓库 `docs/openapi.yaml` |
| [`gateway/result-summary-schema.json`](../../../gateway/result-summary-schema.json) | 已有结果摘要契约，不等同于安全 MCP 展示模型 |
| [`gateway/constraint-config.yaml`](../../../gateway/constraint-config.yaml) | 约束配置交付文件 |
| [`mcp-result-view-schema.json`](mcp-result-view-schema.json) | 安全 `engine_view` 的 Draft 2020-12 Schema，亦是 View 构建期校验器的输入 |
| [`fixtures/mcp-result-view/`](fixtures/mcp-result-view/) | 合成输入、独立期望投影、语义断言及包装样例；不是业务归档或生产投影实现 |

字段映射和降级语义仍以 [MCP 结果展示契约](../../components/mcp-result-view-contract.md) 为准，页面实现及验收边界见 [独立 MCP Apps 结果查看器](../../components/mcp-app.md)。不在本目录重复维护实现文档。

manifest 的 `request_schema_source.file: docs/openapi.yaml` 相对**引擎仓库根目录**解释，不相对元数据目录；此次目录调整不改变其含义、契约版本、Schema `$id`、字段或求解行为。

## 2. 本仓维护

- `gateway/` 只存放 Gateway 版本导入读取的 `image-version.yaml`、`result-summary-schema.json`、`constraint-config.yaml`；构建、测试和文档分别引用其实际位置。
- `skills/vrp0-metadata/` 生成器默认将这三份元数据写入 `gateway/`，将参考 `request-schema.json` 写入 `docs/integrations/gateway/`。
- 生成器仍支持显式 `--output-dir` 指定元数据输出目录，不要为修改目录而重新生成并覆盖已有配置或 Schema。
- 修改 Schema 或 `mcp_ui` 时按[测试说明](../../operations/testing.md#81-独立-mcp-apps-view)重建、校验和回归；仅路径迁移也须确认构建/测试仍能定位资料。
- MCP HTML 交付到 `src/main/resources/META-INF/resources/static/mcp-map-app.html` 与 `mcp-gantt-app.html`，不保留旧单资源文件，也不迁入文档目录。

## 3. Gateway 导入交接

Gateway 默认从代码库 tag 的 `gateway/` 目录读取元数据，与本仓目录一致。若部署曾覆盖元数据根目录配置，应在 Gateway 侧恢复为：

```text
GATEWAY_CODE_REPOSITORY_METADATA_ROOT=gateway
```

它对应 Gateway 的 `gateway.code-repository.metadata-root`；也可移除覆盖以使用默认值 `gateway`。此项不是引擎侧配置，不应写入引擎 `.env`。

**该配置目前是 Gateway 实例级，而非每个引擎或 tag 独立配置。** 变更前须核对同实例的其他引擎及历史 tag 的目录布局，不能宣称透明兼容。本次目录调整未修改 Gateway 代码、部署配置、已有 tag 或已导入快照；同步目标 tag 必须包含 `gateway/image-version.yaml`，仅移动工作区文件不会改变已发布版本。

Gateway 的 OpenAPI 路径和 HTML 资源读取目录是独立约定，不随元数据目录一起移动。后续同步外部契约 fixtures 快照时，也需更新其来源路径记录。真实 Gateway 发布、地图网络与四宿主联调仍属于未验证项。
