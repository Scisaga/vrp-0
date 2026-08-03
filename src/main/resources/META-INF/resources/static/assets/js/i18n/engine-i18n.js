export const DEFAULT_LOCALE = "zh-CN";
export const SUPPORTED_LOCALES = Object.freeze(["zh-CN", "en-US"]);
export const ENGINE_LOCALE_STORAGE_KEY = "vrp0.engine.locale";

/**
 * First-party Engine messages are addressed by stable, semantic keys.  New UI
 * copy must use t(key); it must not depend on source-text DOM translation.
 */
export const ENGINE_MESSAGES = Object.freeze({
  "zh-CN": Object.freeze({
    "common.cancel": "取消",
    "common.delete": "删除",
    "common.import": "导入",
    "common.format": "格式化",
    "common.expandAll": "全部展开",
    "common.collapseAll": "全部折叠",
    "common.all": "全部",
    "common.close": "关闭提示",
    "common.search": "查询",
    "common.reset": "重置",
    "common.saveScenario": "保存场景",
    "common.saved": "已保存",
    "common.newScenario": "新建场景",
    "common.unsavedChanges": "有未保存修改",
    "frame.dismissNotification": "关闭提示",
    "frame.expandNavigation": "展开导航栏",
    "frame.collapseNavigation": "收起导航栏",
    "frame.language": "语言",
    "frame.changeLanguage": "切换语言",
    "frame.simplifiedChinese": "中文",
    "frame.initializing": "页面初始化中",
    "frame.initializingHint": "如果这段提示长时间不消失，说明前端脚本没有成功启动，但页面不会再黑屏。",
    "route.scenario.title": "场景详情",
    "route.scenario.desc": "当前场景配置、约束维护与求解入口",
    "route.jobs.title": "任务列表",
    "route.jobs.desc": "筛选、查看与跟踪当前场景的求解任务",
    "route.jobs.menu": "任务列表",
    "route.job.title": "求解任务详情",
    "route.job.desc": "当前求解任务状态、甘特视图与结果操作",
    "route.map.title": "求解任务一张图",
    "route.map.desc": "路径模拟、车辆状态与时间轴控制",
    "route.quota.title": "地图接口",
    "route.quota.desc": "地图接口私钥、QPS、配额与超时配置",
    "route.quota.menu": "地图接口",
    "route.mcp.title": "MCP接入",
    "route.mcp.desc": "远程接入配置、工具范围与服务状态摘要",
    "route.mcp.menu": "MCP接入",
    "mcp.dismissNotification": "关闭提示",
    "mcp.summary.title": "MCP 接入摘要",
    "mcp.summary.description": "为智能体开放当前场景维护、矩阵构建、求解触发与结果查询应用等完整链路。",
    "mcp.transport.label": "传输方式",
    "mcp.transport.description": "当前规划固定为远程 HTTP MCP，不复用后台登录态。",
    "mcp.authentication.label": "鉴权",
    "mcp.authentication.description": "由部署配置提供 Bearer Token，本页不展示真实值。",
    "mcp.authentication.tokenNotes": "Token 说明",
    "mcp.url.label": "MCP 地址",
    "mcp.url.copy": "复制 MCP 地址",
    "mcp.url.openDocumentation": "打开 MCP 文档",
    "mcp.copyUrlSuccess": "MCP 地址已复制",
    "mcp.copyUrlFallback": "MCP 地址：{url}",
    "mcp.tools.title": "工具清单",
    "mcp.tools.scenarioCapacity": "场景与运力",
    "mcp.tools.geocodingMatrix": "地理与矩阵",
    "mcp.tools.solverJobs": "求解任务",
    "mcp.workflow.title": "典型智能体流程",
    "mcp.workflow.step1.number": "1.",
    "mcp.workflow.step1.action": "写入当前场景",
    "mcp.workflow.step2.prefix": "2. 需要时在保存时顺带构建 POI 与矩阵，传",
    "mcp.workflow.step3.number": "3.",
    "mcp.workflow.step3.action": "检查当前场景可用运力",
    "mcp.workflow.step4.number": "4.",
    "mcp.workflow.step4.action": "启动求解",
    "mcp.workflow.step5.number": "5.",
    "mcp.workflow.step5.action": "轮询查看状态",
    "mcp.workflow.step6.number": "6.",
    "mcp.workflow.step6.action": "把结果写回当前场景",
    "mcp.client.title": "客户端配置示例",
    "mcp.client.harness.description": "在 Harness 中创建 MCP Server Connector，并通过 Custom Header 引用保存了完整 Bearer 值的 Secret。",
    "mcp.client.harness.secretComment": "在此 Harness Secret 中保存完整的 \"Bearer <你的 Bearer Token>\"。",
    "mcp.client.vscode.description": "建议使用输入变量保存 Bearer Token，避免把敏感值直接写进工作区配置。",
    "mcp.client.codex.description": "推荐把 Token 放进环境变量，再通过 `bearer_token_env_var` 引用，便于本地切换和管理。",
    "mcp.client.bearerTokenPlaceholder": "你的 Bearer Token",
    "mcp.status.title": "当前 MCP 状态",
    "mcp.status.enabled": "已启用",
    "mcp.status.disabled": "未启用",
    "mcp.origin.allowlist": "Origin 白名单",
    "mcp.origin.none": "未配置白名单",
    "mcp.usage.title": "使用说明",
    "mcp.usage.summary": "该页展示接入摘要、工具范围、客户端配置片段和当前服务状态。",
    "mcp.usage.noToken": "页面不会显示真实 Bearer Token；示例中的 token 均为占位值。",
    "mcp.usage.statusUnavailable.before": "若右上角状态显示异常，请先检查",
    "mcp.usage.statusUnavailable.after": "是否可达。",
    "scenario.host.recreate": "需要重新创建场景",
    "scenario.host.providerMismatch": "当前场景使用的地图服务与当前运行配置不一致，不能继续使用。请先清除当前场景，再重新录入或导入。",
    "scenario.host.clearAndRestart": "清除场景，重新开始",
    "scenario.host.importSolveRequest": "导入求解请求",
    "scenario.host.pasteSolveRequest": "粘贴包含 scenario 的请求 JSON",
    "scenario.host.importHint": "导入后只回填当前页面配置，不会自动保存或求解。",
    "scenario.host.planAndSolve": "规划求解",
    "scenario.host.createSolverJob": "创建求解任务",
    "scenario.host.saveBeforePlan": "请先保存场景",
    "scenario.host.importExport": "导入 / 导出",
    "scenario.host.copyRequest": "复制请求参数",
    "scenario.host.pasteAndUpdate": "粘贴请求参数并更新",
    "scenario.host.buildTransitMatrix": "生成在途矩阵",
    "scenario.host.backToJobs": "返回任务列表",
    "scenario.host.stopSolving": "停止求解",
    "scenario.host.deleteJob": "删除任务",
    "scenario.host.saveRequired": "请先保存场景后再规划求解。",
    "scenario.host.solveTimeInvalid": "solve_time 格式不支持，请使用 PT30S / PT5M / PT1H。",
    "scenario.host.copyFailed": "复制失败，请检查浏览器权限。",
    "scenario.host.invalidJson": "JSON 格式错误，请检查后重试。",
    "scenario.host.missingScenario": "请求 JSON 缺少 scenario 字段。",
    "scenario.host.invalidMatrixMode": "matrix_mode 仅支持 ROUTING 或 MANHATTAN。",
    "scenario.host.scenarioNotReady": "场景组件尚未准备好",
    "scenario.host.ticketNotFound": "当前场景未找到工单：{ticketId}",
    "scenario.host.scenarioSaved": "场景已保存。",
    "scenario.host.scenarioSavedAndBuilt": "场景已保存，并触发地址解析/矩阵生成。",
    "scenario.host.scenarioDeleted": "当前场景已删除。",
    "scenario.host.requestCopied": "请求参数已复制。",
    "scenario.host.importApplied": "已回填当前场景和求解参数；普通保存或求解不会按替换语义清理历史任务。",
    "scenario.host.deleteScenarioConfirm": "确认删除当前场景？这会同时清空当前求解任务。",
    "scenario.host.deleteJobConfirm": "确认删除当前求解任务？",
    "scenario.host.noStoppableJob": "当前没有可停止的求解任务",
    "scenario.host.noDeletableJob": "当前没有可删除的求解任务",
    "scenario.host.stopRequested": "已发送停止任务请求。",
    "scenario.host.jobDeleted": "求解任务已删除。",
    "status.unknown": "未知",
    "status.starting": "启动中",
    "status.solving": "求解中",
    "status.completed": "已完成",
    "status.failed": "失败",
    "status.notStarted": "未开始",
    "boolean.yes": "是",
    "boolean.no": "否",
    "connection.available": "服务可达",
    "connection.unavailable": "服务异常",
    "connection.quotaAvailable": "配额接口可达",
    "connection.quotaUnavailable": "配额接口异常",
    "connection.scenarioAvailable": "场景接口可达",
    "connection.scenarioUnavailable": "场景接口异常",
    "connection.jobAvailable": "任务接口可达",
    "connection.jobUnavailable": "任务接口异常",
    "connection.noJob": "当前无任务",
    "connection.mapReady": "地图页已连接",
    "connection.mapFailed": "地图页加载失败",
    "connection.mcpAvailable": "MCP 说明页可达",
    "connection.mcpDisabled": "MCP 未启用",
    "connection.mcpUnavailable": "说明页接口异常",
    "jobs.filter.status": "任务状态",
    "jobs.filter.createdFrom": "创建时间起",
    "jobs.filter.createdTo": "创建时间止",
    "jobs.filter.buildMatrix": "生成矩阵",
    "jobs.filter.matrixMode": "矩阵方式",
    "jobs.filter.drawRoutes": "生成路线",
    "jobs.refresh": "刷新任务列表",
    "jobs.loading": "正在加载任务列表",
    "jobs.empty": "暂无匹配任务",
    "jobs.emptyHint": "调整筛选条件，或返回场景详情创建新的求解任务。",
    "jobs.column.job": "任务",
    "jobs.column.status": "状态",
    "jobs.column.solveDuration": "求解时间",
    "jobs.column.matrixMode": "矩阵方式",
    "jobs.column.buildMatrix": "生成矩阵",
    "jobs.column.drawRoutes": "生成路线",
    "jobs.column.score": "求解分数",
    "jobs.column.createdAt": "创建时间",
    "jobs.column.solveFinishedAt": "求解完成时间",
    "jobs.column.actions": "操作",
    "jobs.openDetails": "查看详情",
    "jobs.openMap": "打开一张图",
    "jobs.copyIdSuccess": "任务 ID 已复制。",
    "jobs.copyIdFailure": "复制失败，请检查浏览器权限。",
    "quota.geocodingProvider": "地理解析提供方",
    "quota.fallbackTitle": "失败时回退高德",
    "quota.fallbackHint": "默认关闭，仅自然语言地址解析失败时生效。",
    "quota.fallbackTitleHint": "地址解析系统失败时，是否自动回退到高德 geocode。默认关闭。",
    "quota.addressResolverUrl": "地址解析系统 URL",
    "quota.addressResolverHint": "只影响自然语言地址解析，不影响坐标逆解析、POI 搜索和路线规划。",
    "quota.section.address": "地址解析",
    "quota.section.authentication": "认证信息",
    "quota.section.limits": "配额与超时",
    "quota.apiKey": "高德接口私钥",
    "quota.apiKeyPlaceholder": "请输入 AMap Web Service / JS Key",
    "quota.showApiKey": "显示接口私钥",
    "quota.hideApiKey": "隐藏接口私钥",
    "quota.qps": "每秒请求数 (QPS)",
    "quota.total": "总配额",
    "quota.interval": "配额统计周期（秒）",
    "quota.timeout": "请求超时（秒）",
    "quota.save": "保存配置",
    "quota.saveSuccess": "配置已保存",
    "quota.preview": "当前配置预览",
    "quota.notes": "配置说明",
    "quota.note.persist": "保存后会同步更新当前运行实例，并持久化到服务端配置文件，应用重启后仍可继续读取。",
    "quota.note.amap": "地图页、坐标逆解析与路线能力会继续复用这里维护的高德 Key。",
    "quota.note.provider": "地理解析提供方只影响自然语言地址解析；切换到地址解析系统后，场景页中的地址解析入口也会统一遵循这里的配置。",
    "scenario.fallback.title": "空场景工作台",
    "scenario.fallback.description": "当前没有场景数据。页面已正常加载，你可以直接开始录入场景基础信息并保存。",
    "i18n.missing": "文本不可用"
  }),
  "en-US": Object.freeze({
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.import": "Import",
    "common.format": "Format",
    "common.expandAll": "Expand all",
    "common.collapseAll": "Collapse all",
    "common.all": "All",
    "common.close": "Dismiss notification",
    "common.search": "Search",
    "common.reset": "Reset",
    "common.saveScenario": "Save scenario",
    "common.saved": "Saved",
    "common.newScenario": "New scenario",
    "common.unsavedChanges": "Unsaved changes",
    "frame.dismissNotification": "Dismiss notification",
    "frame.expandNavigation": "Expand navigation",
    "frame.collapseNavigation": "Collapse navigation",
    "frame.language": "Language",
    "frame.changeLanguage": "Change language",
    "frame.simplifiedChinese": "Chinese",
    "frame.initializing": "Initializing page",
    "frame.initializingHint": "If this message remains visible, the frontend script did not start successfully, but the page will not stay blank.",
    "route.scenario.title": "Scenario",
    "route.scenario.desc": "Configure the current scenario, constraints, and solve entry point.",
    "route.jobs.title": "Jobs",
    "route.jobs.desc": "Filter, inspect, and track solver jobs for the current scenario.",
    "route.jobs.menu": "Jobs",
    "route.job.title": "Solver job details",
    "route.job.desc": "View job status, Gantt schedule, and result actions.",
    "route.map.title": "Solver job map",
    "route.map.desc": "Route simulation, vehicle status, and timeline controls.",
    "route.quota.title": "Map Api",
    "route.quota.desc": "Configure map keys, QPS, quotas, and timeouts.",
    "route.quota.menu": "Map Api",
    "route.mcp.title": "Mcp Api",
    "route.mcp.desc": "Remote access configuration, tool scope, and service status.",
    "route.mcp.menu": "Mcp Api",
    "mcp.dismissNotification": "Dismiss notification",
    "mcp.summary.title": "MCP integration summary",
    "mcp.summary.description": "Provides agents with the full flow for scenario maintenance, matrix building, solving, result lookup, and apply.",
    "mcp.transport.label": "Transport",
    "mcp.transport.description": "This setup uses remote HTTP MCP and does not reuse a console login session.",
    "mcp.authentication.label": "Authentication",
    "mcp.authentication.description": "The deployment provides the Bearer token; this page never shows its real value.",
    "mcp.authentication.tokenNotes": "Token notes",
    "mcp.url.label": "MCP URL",
    "mcp.url.copy": "Copy MCP URL",
    "mcp.url.openDocumentation": "Open MCP documentation",
    "mcp.copyUrlSuccess": "MCP URL copied",
    "mcp.copyUrlFallback": "MCP URL: {url}",
    "mcp.tools.title": "Tool list",
    "mcp.tools.scenarioCapacity": "Scenario and capacity",
    "mcp.tools.geocodingMatrix": "Geocoding and matrix",
    "mcp.tools.solverJobs": "Solver jobs",
    "mcp.workflow.title": "Typical agent workflow",
    "mcp.workflow.step1.number": "1.",
    "mcp.workflow.step1.action": "write the current scenario",
    "mcp.workflow.step2.prefix": "2. When saving, optionally build POIs and the matrix with",
    "mcp.workflow.step3.number": "3.",
    "mcp.workflow.step3.action": "check available capacity for the scenario",
    "mcp.workflow.step4.number": "4.",
    "mcp.workflow.step4.action": "start solving",
    "mcp.workflow.step5.number": "5.",
    "mcp.workflow.step5.action": "poll for status",
    "mcp.workflow.step6.number": "6.",
    "mcp.workflow.step6.action": "apply the result to the scenario",
    "mcp.client.title": "Client configuration examples",
    "mcp.client.harness.description": "Create an MCP Server Connector in Harness and use Custom Header authentication to reference a Secret containing the full Bearer value.",
    "mcp.client.harness.secretComment": "Store the full \"Bearer <your Bearer Token>\" value in this Harness Secret.",
    "mcp.client.vscode.description": "Use an input variable for the Bearer token so that sensitive values are not written directly into workspace settings.",
    "mcp.client.codex.description": "Store the token in an environment variable and reference it through `bearer_token_env_var` for easier local switching and management.",
    "mcp.client.bearerTokenPlaceholder": "your Bearer Token",
    "mcp.status.title": "Current MCP status",
    "mcp.status.enabled": "Enabled",
    "mcp.status.disabled": "Disabled",
    "mcp.origin.allowlist": "Origin allowlist",
    "mcp.origin.none": "No allowlist configured",
    "mcp.usage.title": "Usage notes",
    "mcp.usage.summary": "This page shows the integration summary, tool scope, client snippets, and service status.",
    "mcp.usage.noToken": "The page never shows a real Bearer token; example tokens are placeholders.",
    "mcp.usage.statusUnavailable.before": "If the top-right status is unavailable, first check whether",
    "mcp.usage.statusUnavailable.after": "is reachable.",
    "scenario.host.recreate": "The scenario must be recreated",
    "scenario.host.providerMismatch": "This scenario uses a different map provider than the running configuration and cannot continue. Clear it, then enter or import it again.",
    "scenario.host.clearAndRestart": "Clear scenario and start over",
    "scenario.host.importSolveRequest": "Import solve request",
    "scenario.host.pasteSolveRequest": "Paste request JSON containing scenario",
    "scenario.host.importHint": "Importing fills only the current page; it does not save or solve automatically.",
    "scenario.host.planAndSolve": "Plan and solve",
    "scenario.host.createSolverJob": "Create solver job",
    "scenario.host.saveBeforePlan": "Save the scenario first",
    "scenario.host.importExport": "Import / export",
    "scenario.host.copyRequest": "Copy request parameters",
    "scenario.host.pasteAndUpdate": "Paste request parameters and update",
    "scenario.host.buildTransitMatrix": "Build transit matrix",
    "scenario.host.backToJobs": "Back to jobs",
    "scenario.host.stopSolving": "Stop solving",
    "scenario.host.deleteJob": "Delete job",
    "scenario.host.saveRequired": "Save the scenario before planning a solve.",
    "scenario.host.solveTimeInvalid": "The solve_time format is unsupported. Use PT30S, PT5M, or PT1H.",
    "scenario.host.copyFailed": "Copy failed. Check browser permissions.",
    "scenario.host.invalidJson": "The JSON format is invalid. Check it and try again.",
    "scenario.host.missingScenario": "The request JSON is missing its scenario field.",
    "scenario.host.invalidMatrixMode": "matrix_mode supports ROUTING or MANHATTAN only.",
    "scenario.host.scenarioNotReady": "The scenario component is not ready.",
    "scenario.host.ticketNotFound": "The ticket was not found in the current scenario: {ticketId}",
    "scenario.host.scenarioSaved": "Scenario saved.",
    "scenario.host.scenarioSavedAndBuilt": "Scenario saved and address resolution/matrix generation started.",
    "scenario.host.scenarioDeleted": "Current scenario deleted.",
    "scenario.host.requestCopied": "Request parameters copied.",
    "scenario.host.importApplied": "The scenario and solve parameters were filled in. A normal save or solve does not clear prior jobs with replacement semantics.",
    "scenario.host.deleteScenarioConfirm": "Delete the current scenario? This also removes current solver jobs.",
    "scenario.host.deleteJobConfirm": "Delete the current solver job?",
    "scenario.host.noStoppableJob": "There is no solver job to stop.",
    "scenario.host.noDeletableJob": "There is no solver job to delete.",
    "scenario.host.stopRequested": "Stop request sent.",
    "scenario.host.jobDeleted": "Solver job deleted.",
    "status.unknown": "Unknown",
    "status.starting": "Starting",
    "status.solving": "Solving",
    "status.completed": "Completed",
    "status.failed": "Failed",
    "status.notStarted": "Not started",
    "boolean.yes": "Yes",
    "boolean.no": "No",
    "connection.available": "Service available",
    "connection.unavailable": "Service unavailable",
    "connection.quotaAvailable": "Quota endpoint available",
    "connection.quotaUnavailable": "Quota endpoint unavailable",
    "connection.scenarioAvailable": "Scenario endpoint available",
    "connection.scenarioUnavailable": "Scenario endpoint unavailable",
    "connection.jobAvailable": "Solver-job endpoint available",
    "connection.jobUnavailable": "Solver-job endpoint unavailable",
    "connection.noJob": "No solver job is available",
    "connection.mapReady": "Map page connected",
    "connection.mapFailed": "Map page failed to load",
    "connection.mcpAvailable": "MCP information endpoint available",
    "connection.mcpDisabled": "MCP is disabled",
    "connection.mcpUnavailable": "Information endpoint unavailable",
    "jobs.filter.status": "Job status",
    "jobs.filter.createdFrom": "Created from",
    "jobs.filter.createdTo": "Created to",
    "jobs.filter.buildMatrix": "Build matrix",
    "jobs.filter.matrixMode": "Matrix mode",
    "jobs.filter.drawRoutes": "Draw routes",
    "jobs.refresh": "Refresh solver jobs",
    "jobs.loading": "Loading solver jobs",
    "jobs.empty": "No matching jobs",
    "jobs.emptyHint": "Adjust the filters or return to the scenario to create a solver job.",
    "jobs.column.job": "Job",
    "jobs.column.status": "Status",
    "jobs.column.solveDuration": "Solve duration",
    "jobs.column.matrixMode": "Matrix mode",
    "jobs.column.buildMatrix": "Build matrix",
    "jobs.column.drawRoutes": "Draw routes",
    "jobs.column.score": "Solve score",
    "jobs.column.createdAt": "Created at",
    "jobs.column.solveFinishedAt": "Solve finished at",
    "jobs.column.actions": "Actions",
    "jobs.openDetails": "View details",
    "jobs.openMap": "Open map view",
    "jobs.copyIdSuccess": "Job ID copied.",
    "jobs.copyIdFailure": "Copy failed. Check browser permissions.",
    "quota.geocodingProvider": "Geocoding provider",
    "quota.fallbackTitle": "Fall back to AMap on failure",
    "quota.fallbackHint": "Off by default; applies only when natural-language geocoding fails.",
    "quota.fallbackTitleHint": "Whether to fall back to AMap geocoding if the address resolver fails. Off by default.",
    "quota.addressResolverUrl": "Address resolver URL",
    "quota.addressResolverHint": "Affects only natural-language geocoding, not reverse geocoding, POI search, or routing.",
    "quota.section.address": "Address resolution",
    "quota.section.authentication": "Authentication",
    "quota.section.limits": "Quotas and timeouts",
    "quota.apiKey": "AMap API key",
    "quota.apiKeyPlaceholder": "Enter an AMap Web Service / JS key",
    "quota.showApiKey": "Show API key",
    "quota.hideApiKey": "Hide API key",
    "quota.qps": "Requests per second (QPS)",
    "quota.total": "Total quota",
    "quota.interval": "Quota interval (seconds)",
    "quota.timeout": "Request timeout (seconds)",
    "quota.save": "Save configuration",
    "quota.saveSuccess": "Configuration saved",
    "quota.preview": "Current configuration preview",
    "quota.notes": "Configuration notes",
    "quota.note.persist": "Saving updates this running instance and persists the server configuration across restarts.",
    "quota.note.amap": "The map page, reverse geocoding, and routing continue to use the AMap key configured here.",
    "quota.note.provider": "The geocoding provider affects only natural-language addresses; scenario address lookup follows this setting too.",
    "scenario.fallback.title": "Empty scenario workspace",
    "scenario.fallback.description": "There is no scenario data yet. The page is ready; enter the scenario basics and save it.",
    "i18n.missing": "Text unavailable"
  })
});


const ERROR_TEXT = {
  "zh-CN": {
    scenario_not_found: "当前没有场景。",
    solver_job_not_found: "当前没有求解任务。",
    invalid_argument: "请求参数不合法。",
    invalid_filter: "筛选条件“{field}”不合法。",
    invalid_json: "JSON 格式不正确。",
    invalid_json_content: "JSON 内容不正确。",
    invalid_format: "请求字段格式不正确。",
    scenario_plan_missing: "场景缺少规划数据。",
    scenario_schedule_missing: "场景缺少开始或结束时间。",
    scenario_required: "场景不能为空。",
    scenario_mutation_blocked: "求解任务运行中，不能修改场景。",
    scenario_map_provider_mismatch: "场景地图提供方必须与当前实例一致（{expected_provider}）。",
    scenario_poi_not_built: "场景 POI 尚未构建，请先保存并构建。",
    scenario_transit_matrix_not_built: "场景在途矩阵尚未构建，请先保存并构建。",
    scenario_apply_incompatible: "求解结果不能应用到当前场景。",
    solver_job_already_running: "已有求解任务在运行，暂不支持排队。",
    solver_not_running: "当前求解任务未在运行。",
    solver_job_must_terminate: "请先停止求解任务，再删除。",
    solver_job_failed: "求解任务执行失败。",
    map_keywords_required: "请输入地址关键词。",
    map_location_required: "请输入有效坐标。",
    map_page_invalid: "查询页码必须大于等于 1。",
    map_provider_unavailable: "当前地图服务不可用。",
    map_provider_request_failed: "地图服务请求失败，请稍后重试。",
    matrix_cache_provider_unsupported: "矩阵缓存仅在 AMap 提供方下可用。",
    failed_precondition: "当前操作缺少必要前置条件。",
    conflict: "当前操作与已有状态冲突。",
    permission_denied: "没有执行该操作的权限。",
    internal_error: "服务暂时不可用，请稍后重试。",
    network_error: "网络连接失败，请检查网络后重试。"
  },
  "en-US": {
    scenario_not_found: "No scenario is available.",
    solver_job_not_found: "No solver job is available.",
    invalid_argument: "The request contains invalid parameters.",
    invalid_filter: "The filter “{field}” is invalid.",
    invalid_json: "The JSON format is invalid.",
    invalid_json_content: "The JSON content is invalid.",
    invalid_format: "A request field has an invalid format.",
    scenario_plan_missing: "The scenario has no planning data.",
    scenario_schedule_missing: "The scenario is missing a start or end time.",
    scenario_required: "A scenario is required.",
    scenario_mutation_blocked: "The scenario cannot be changed while a solver job is running.",
    scenario_map_provider_mismatch: "The scenario map provider must match this instance ({expected_provider}).",
    scenario_poi_not_built: "Scenario POIs have not been built. Save and build the scenario first.",
    scenario_transit_matrix_not_built: "The transit matrix has not been built. Save and build the scenario first.",
    scenario_apply_incompatible: "The solver result cannot be applied to the current scenario.",
    solver_job_already_running: "A solver job is already running; queueing is not supported.",
    solver_not_running: "The current solver job is not running.",
    solver_job_must_terminate: "Stop the solver job before deleting it.",
    solver_job_failed: "The solver job failed.",
    map_keywords_required: "Enter an address keyword.",
    map_location_required: "Enter a valid coordinate.",
    map_page_invalid: "The query page must be at least 1.",
    map_provider_unavailable: "The current map provider is unavailable.",
    map_provider_request_failed: "The map provider request failed. Try again later.",
    matrix_cache_provider_unsupported: "The matrix cache is available only with the AMap provider.",
    failed_precondition: "The operation is missing a required precondition.",
    conflict: "The operation conflicts with the current state.",
    permission_denied: "You do not have permission to perform this operation.",
    internal_error: "The service is temporarily unavailable. Try again later.",
    network_error: "The network request failed. Check your connection and try again."
  }
};

function browserWindow() {
  return typeof window === "undefined" ? null : window;
}

function browserDocument() {
  return typeof document === "undefined" ? null : document;
}

export function normalizeLocale(value) {
  return SUPPORTED_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

function substitute(value, params = {}) {
  return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(params?.[key] ?? ""));
}

let locale = DEFAULT_LOCALE;

export function getEngineLocale() {
  return locale;
}

export function initEngineLocale() {
  const runtime = browserWindow();
  try {
    locale = normalizeLocale(runtime?.localStorage?.getItem(ENGINE_LOCALE_STORAGE_KEY));
  } catch (_error) {
    locale = DEFAULT_LOCALE;
  }
  browserDocument()?.documentElement?.setAttribute("lang", locale);
  return locale;
}

export function setEngineLocale(value) {
  const next = normalizeLocale(value);
  if (next === locale) return locale;
  locale = next;
  try {
    browserWindow()?.localStorage?.setItem(ENGINE_LOCALE_STORAGE_KEY, locale);
  } catch (_error) {
    // Storage can be disabled by browser policy; the in-memory locale still works.
  }
  browserDocument()?.documentElement?.setAttribute("lang", locale);
  browserWindow()?.dispatchEvent?.(new CustomEvent("vrp:locale-changed", { detail: { locale } }));
  return locale;
}

export function engineMessageKeys() {
  return Object.keys(ENGINE_MESSAGES[DEFAULT_LOCALE]);
}

/** Render an Engine-owned semantic message key. */
export function t(key, params = {}, activeLocale = locale) {
  const normalizedLocale = normalizeLocale(activeLocale);
  const message = ENGINE_MESSAGES[normalizedLocale]?.[key];
  if (message != null) {
    return substitute(message, params);
  }
  // A missing translation is a developer error and is asserted by tests.  Do
  // not surface the key, a Chinese source string, or server-provided content.
  return substitute(ENGINE_MESSAGES[normalizedLocale]["i18n.missing"], { key });
}

export function localizeApiError(error, activeLocale = locale) {
  const code = error?.errorCode || error?.code || error?.payload?.error_code || error?.payload?.errorCode
    || (error?.status ? "internal_error" : "network_error");
  const params = error?.errorParams || error?.params || error?.payload?.error_params || error?.payload?.errorParams || {};
  const dictionary = ERROR_TEXT[normalizeLocale(activeLocale)] || ERROR_TEXT[DEFAULT_LOCALE];
  return substitute(dictionary[code] || dictionary.internal_error, params);
}

export function formatLocalizedDateTime(value, activeLocale = locale) {
  if (!value) return "--";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(normalizeLocale(activeLocale), {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(date);
}

if (browserWindow()) {
  browserWindow().VrpEngineI18n = {
    getLocale: getEngineLocale,
    localizeApiError,
    t
  };
}
