# MCP 结果展示契约 Fixtures

本目录只包含人工合成的数据，不读取业务归档、不发起地图或 Gateway 请求。它验证的是[契约设计](../../../../components/mcp-result-view-contract.md)，不是已经实现的 Gateway 投影或 MCP Apps 页面。

## 1. 文件与独立预期

| 文件 | 用途 |
| --- | --- |
| `base-source.json` | 合成原始 SolverJob；内部任务 ID 与 Gateway ID 故意不同。 |
| `base-expected.json` | 人工定义的安全 `engine_view`，不是参考投影器的输出快照。 |
| `cases.json` | 基于上述两个文件的独立输入/期望补丁、诊断及语义断言。 |
| `large-recipe.json` | 200 个每日工程师、1,000 个工单及高点数折线的确定性生成参数和预期不变量；不是产品规模上限。 |
| `payloads.json` | 按 issue 公共契约组织的完整正常工具结果、业务错误、资源错误及认证错误交接样例。 |

补丁只使用 JSON Patch 的 `add`、`replace`、`remove` 和 JSON Pointer 路径；根路径 `""` 表示替换整个对象。`source_patch` 作用于原始输入，`expected_patch` **独立**作用于手写安全基线，不使用待测试的投影函数推算预期。`expected_null=true` 表示必须拒绝生成模型。

`diagnostics=[]` 要求没有诊断；非空时每项要求包含给定的 `code` / `path`。`analysis` 对列出的键递归断言，数组长度及顺序必须一致；`required_reasons` 按完整工程师 ID 断言原因集合包含指定项。这些是测试辅助字段，不加入对外 Schema。

## 2. 导出完整交接数据

在仓库根目录运行（只写标准输出）：

```bash
python -B scripts/tests/mcp_result_view_fixtures.py --list
python -B scripts/tests/mcp_result_view_fixtures.py --case ready-amap-single
python -B scripts/tests/mcp_result_view_fixtures.py --case missing-middle-route-not-reindexed
python -B scripts/tests/mcp_result_view_fixtures.py --large
```

单例与大结果输出均包含原始 JSON、完整期望投影和断言，可交给其他语言的投影实现复用，不要求 Gateway 依赖 Python。大结果的计划从已白名单化的合成模板生成，期望保持所有计划字段与点位不变，任务身份取手写安全基线；不调用参考投影器生成预期。大结果在内存中生成，不提交庞大的展开文件，不修改 `data/` 或 `db/`。

## 3. 验证与安全边界

安装[测试依赖](../../../../../scripts/tests/requirements-mcp-contract.txt)后，在仓库根目录运行：

```bash
python -B -m unittest discover -s scripts/tests -p 'test_mcp_result_view_contract.py' -v
```

验证包含标准 Draft 2020-12 Schema、字段映射 golden 比较、引用/顺序/时间/路线的语义断言、不同 `TZ` 的一致性及大结果无截断检查。参考映射和语义工具仅供测试，不是引擎或 Gateway 的生产实现。

所有 `TEST_ONLY_*` 值均为故意注入的合成测试标记，包括不可用的地图 key；`example.invalid` 链接不会被请求。公开 SDK URL 仅用于展示配置形状，不代表 CSP 已获批准。错误 `details` 对象形状来自 issue 的交接设计，不表示 Gateway 当前实现已迁移。

外层样例固定 `result_summary=null`，绘图数据只在 `_meta.gateway_ui.engine_view`，模型可见摘要不复制折线。不能把该示例集合当作另一份 Gateway 协议：状态映射、禁用地图配置及错误兼容仍以 issue 所引用的 Gateway 权威契约为准。
