# MCP 结果展示契约 Fixtures

本目录只包含人工合成的数据，不读取业务归档、不发起地图或 Gateway 请求。它验证的是[契约设计](../../../../components/mcp-result-view-contract.md)，不是已经实现的 Gateway 投影或 MCP Apps 页面。

## 1. 文件与独立预期

| 文件 | 用途 |
| --- | --- |
| `base-source.json` | 合成原始 SolverJob；内部任务 ID 与 Gateway ID 故意不同。 |
| `base-expected.json` | 人工定义的 Map profile 安全 `engine_view` 基线。 |
| `gantt-expected.json` | 同一 59-case 集合的 Gantt profile 完整人工期望、诊断与身份/引用/顺序/班次/计划时间/路线段位语义断言。 |
| `cases.json` | 基于安全基线的独立输入/Map 期望补丁、诊断及语义断言。 |
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

单例包含同一源数据的 Map/Gantt 两组期望。大结果在内存中生成，用于验证 200 个工程师、1,000 个工单和 Map 首段 4,097 点折线不被截断，不修改 `data/` 或 `db/`。

## 3. 验证与安全边界

安装[测试依赖](../../../../../scripts/tests/requirements-mcp-contract.txt)后，在仓库根目录运行：

```bash
python -B -m unittest discover -s scripts/tests -p 'test_mcp_result_view_contract.py' -v
```

验证包含唯一 Draft 2020-12 Schema、两 Profile golden 比较、引用 POI 裁剪、Gantt 空几何/保序段位、Map 几何与回放、不同 `TZ` 的一致性及大结果无截断检查。参考映射和语义工具仅供测试，不是引擎或 Gateway 的生产实现。

所有 `TEST_ONLY_*` 值均为故意注入的合成测试标记，包括不可用的地图 key；`example.invalid` 链接不会被请求。公开 SDK URL 仅用于展示配置形状，不代表 CSP 已获批准。错误 `details` 对象形状来自 issue 的交接设计，不表示 Gateway 当前实现已迁移。

外层样例固定 `result_summary=null`，分别覆盖 Map/Gantt 的 ready、空结果与失败/未就绪；非成功状态不携带模型。Gantt map_context 固定禁用，`browser_key` 与 `js_url` 使用契约规定的空字符串，`css_url=null`。不能把该示例集合当作另一份 Gateway 协议，权威外层契约仍在 Gateway 仓库。
