# MCP 能力说明

## 入口

- MCP 服务默认挂载到 `/mcp`
- 传输方式固定为 `Streamable HTTP`
- 后台说明页入口为 `/#/mcp`
- 服务会同时映射 `/mcp` 与 `/mcp/`
- 当前只开放 `tools`
- 仓库内参考文档路径为 `docs/reference/mcp.md`

## 鉴权

- 远程 MCP 使用 `Bearer Token`
- 不复用任何浏览器登录态
- 启用 MCP 时必须设置 `vrp.mcp.auth.token`
- 浏览器型 MCP 客户端会先发 `OPTIONS` 预检；预检请求不要求 Bearer Token
- 缺少 `Authorization` 头或格式错误时返回 `401`
- Bearer Token 不正确时返回 `403`
- 当配置了 `vrp.mcp.allowed-origins` 时，会额外校验 `Origin`

## 配置项

- `vrp.mcp.enabled`
- `vrp.mcp.path`
- `vrp.mcp.auth.token`
- `vrp.mcp.allowed-origins`

说明：

- `vrp.mcp.enabled` 默认是 `false`
- `vrp.mcp.path` 默认是 `/mcp`
- `vrp.mcp.auth.token` 在 MCP 启用时不能为空
- `vrp.mcp.allowed-origins` 只在浏览器型 MCP 客户端需要跨域访问时设置
- `Codex`、`VS Code` 这类本地桌面或 CLI 客户端通常不需要额外配置 CORS

## Tool 契约

未列出的参数不会被 Tool 处理。无参数 Tool 仍接收空对象 `{}`。

### 场景与运力

| Tool | 输入 | 默认值与约束 | 成功返回 |
| --- | --- | --- | --- |
| `get_current_scenario` | `{}` | 当前场景必须存在 | `Scenario` |
| `upsert_current_scenario` | `scenario`、`build?`、`matrix_mode?` | `scenario` 必填；`build=false`；`matrix_mode=ROUTING`，可选 `ROUTING`、`MANHATTAN` | 保存后的 `Scenario` |
| `delete_current_scenario` | `{}` | 当前场景必须存在；运行中任务会阻止删除 | `Msg` |
| `get_available_agents` | `{}` | 当前场景及规划时间范围必须存在 | 2 小时粒度的可用 Agent 窗口数组 |

`upsert_current_scenario` 调用普通更新语义，不提供 `replace` 参数，因此不会清理任务历史。无论 `build` 是否为真，保存前都会尝试补齐缺失位置，解析失败只记录告警；只有 `build=true` 才完整构建 POI 和场景矩阵。

### 地理与矩阵

| Tool | 输入 | 默认值与约束 | 成功返回 |
| --- | --- | --- | --- |
| `search_pois` | `keywords`、`city?`、`types?`、`page?` | `keywords` 必填且非空；`city=""`；`types=""`；`page=1` 且最小为 1 | 当前地图适配器返回的 `POI` 数组 |
| `get_matrix` | `{}` | 仅 `MAP_PROVIDER=AMAP` 可用 | 当前进程内 AMap 路由缓存 `TransitMatrix` |
| `set_matrix` | `matrix` | `matrix` 必填；仅 `MAP_PROVIDER=AMAP` 可用 | `Msg` |
| `get_amap_conf` | `{}` | 无 | 当前 AMap 适配器配置 |

`get_matrix` 与 `set_matrix` 不直接读取或覆盖当前场景、任务文件中的 `plan.matrix`；它们操作 `AmapTransitCalculator` 的进程内路由缓存。非 AMap 模式返回 `matrix_cache_provider_unsupported`。

### 求解任务

| Tool | 输入 | 默认值与约束 | 成功返回 |
| --- | --- | --- | --- |
| `start_solver_job` | `solve_time?`、`matrix_mode?`、`build_transit_matrix?`、`draw_route?`、`callback?` | `solve_time=PT30S` 且须为合法 ISO-8601 duration；`matrix_mode=ROUTING`，可选 `ROUTING`、`MANHATTAN`；两个布尔选项默认为 `false`；`callback=""` | 已异步提交的 `SolverJob` |
| `get_current_solver_job` | `remove_virtual?` | `remove_virtual=false` | 最新 `SolverJob`，返回前移除 `plan.matrix` |
| `terminate_current_solver_job` | `{}` | 仅调度中或求解中的最新任务可终止 | 终止操作后的 `SolverJob` |
| `apply_current_solver_job` | `{}` | 当前场景和最新任务必须存在，方案对象集合必须兼容 | 应用后的 `Scenario` |
| `delete_current_solver_job` | `{}` | 最新任务必须存在且不能处于运行中 | `Msg` |

启动求解前，当前场景的 POI 和矩阵必须已构建完整。`matrix_mode` 与 `build_transit_matrix` 当前只记录到任务并用于 REST 任务列表筛选，不会在求解阶段重新构建输入矩阵；最终后处理只根据 `draw_route` 选择路线或变更工单矩阵处理。

按产品约束只应应用已停止任务。当前 `apply_current_solver_job` 实现只检查任务异常、方案存在性和对象兼容性，尚未显式校验任务状态；客户端不得利用这一实现缺口在求解运行中回写场景。

### Tool 调用结果

成功时 `isError=false`，业务对象同时写入结构化结果，并以 JSON 文本放入 `content`。失败时 `isError=true`，结构化结果和文本内容均为：

```json
{
  "error_code": "stable_error_code",
  "message": "diagnostic message",
  "status": 400
}
```

当前 Tool 错误结果不包含 REST 错误响应中的 `error_params`。

## 默认业务规则

- MCP 与现有 REST API 共用同一份当前场景和求解任务数据
- 服务模型是单当前场景；MCP 只暴露最新任务的 current 操作，REST 仍保留任务历史
- `start_solver_job` 为异步提交，不会同步等待求解完成
- 当前已有运行中的求解任务时，再次 `start_solver_job` 会返回 `solver_job_already_running`
- 求解任务运行中，`upsert_current_scenario` 和 `delete_current_scenario` 会被拒绝；结果应用路径的当前状态校验缺口见上文
- `upsert_current_scenario` 更新同一当前场景，不清理任务历史；`delete_current_scenario` 会清理全部任务历史
- `get_current_solver_job` 返回结果时会移除 `plan.matrix`
- `search_pois` 和场景构建都使用当前运行实例选择的地图适配器

## 常见错误码

Tool 失败结果中的 `error_code` 直接使用服务端稳定业务错误码，不再折叠为通用类别。常见情况包括：

- 当前场景不存在：`scenario_not_found`
- 当前求解任务不存在：`solver_job_not_found`
- 参数缺失或格式错误：`invalid_argument`
- 场景缺少 `plan` 或时间范围：`scenario_plan_missing`、`scenario_schedule_missing`
- POI 或矩阵未构建：`scenario_poi_not_built`、`scenario_transit_matrix_not_built`
- 已有运行中的求解任务：`solver_job_already_running`
- 运行中修改场景：`scenario_mutation_blocked`
- 地图能力不可用或调用失败：`map_provider_unavailable`、`map_provider_request_failed`
- 非 AMap 模式访问矩阵缓存：`matrix_cache_provider_unsupported`
- 未分类内部错误：`internal_error`
- Token 校验失败：`permission_denied`；Origin 未命中允许列表时请求以 HTTP `403` 拒绝

调用者应直接读取返回结果中的 `error_code`，不要根据 `message` 文本判断流程。

## 典型智能体流程

1. `upsert_current_scenario` 写入当前场景
2. 如需在保存时顺带构建 POI 与矩阵，传 `build=true`
3. `get_available_agents` 检查当前场景的可用运力窗口
4. `start_solver_job` 启动求解
5. `get_current_solver_job` 轮询查看当前任务状态
6. 等任务停止后，使用 `apply_current_solver_job` 把结果写回当前场景
7. `delete_current_solver_job` / `delete_current_scenario` 清理当前状态

## 客户端配置示例

下面示例统一假设：

- MCP 地址：`https://your-host.example.com/mcp`
- Bearer Token：部署时配置的 `vrp.mcp.auth.token`

### Harness

Harness Worker Agent 通过 MCP Server Connector 接入远程 MCP 服务。先在 Harness Secret Manager 中保存完整的 `Bearer <你的 Bearer Token>`，再使用 Custom Header 认证引用该 Secret：

```yaml
connector:
  name: VRP-0 MCP
  identifier: vrp0_mcp
  accountIdentifier: <your_account_id>
  orgIdentifier: <your_org_id>
  projectIdentifier: <your_project_id>
  type: Mcp
  spec:
    serverUrl: https://your-host.example.com/mcp
    auth:
      type: CustomHeader
      spec:
        headerName: Authorization
        headerValueRef: <your_vrp0_bearer_secret>
    executeOnDelegate: false
```

### VS Code

VS Code 可把 MCP 配置保存在工作区 `.vscode/mcp.json` 或用户级 `mcp.json`。为了避免把 token 明文写进仓库，建议使用 `promptString` 输入变量：

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "vrp0-mcp-token",
      "description": "VRP-0 MCP Bearer Token",
      "password": true
    }
  ],
  "servers": {
    "vrp0": {
      "type": "http",
      "url": "https://your-host.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${input:vrp0-mcp-token}"
      }
    }
  }
}
```

### Codex

Codex 建议把 Bearer Token 放进环境变量，再在 `~/.codex/config.toml` 中引用：

```bash
export VRP0_MCP_TOKEN='<你的 Bearer Token>'
```

```toml
[mcp_servers.vrp0]
enabled = true
url = "https://your-host.example.com/mcp"
bearer_token_env_var = "VRP0_MCP_TOKEN"
```

## 后台说明页

- 控制台导航中提供 `MCP` 说明页入口
- 页面路径固定为 `/#/mcp`
- 该页展示接入摘要、Bearer Token 认证方式与占位符、客户端配置片段、能力范围、典型流程和安全规则，不读取或展示真实 Token
- 页面用于接入说明展示，不承担 Markdown 文档编辑功能；完整说明仍以本页文档为准
