# 贡献指南

感谢你关注 `vrp-0`。

## 提交前建议

- 先阅读 [README.md](README.md)
- 优先通过 Issue 说明问题背景、影响范围和预期结果
- 如涉及公开版边界，请避免提交客户数据、真实地址、内部域名、真实 token 或 app key

## 开发流程

1. 基于最新主分支创建工作分支
2. 只修改与当前问题直接相关的文件
3. 在本地完成最小验证
4. 提交 Pull Request，并在描述中写清：
   - 改动目的
   - 主要变更点
   - 验证方式
   - 是否影响公开版 demo、AMap、MCP 或 native build

## 本地验证

推荐至少执行以下命令：

```bash
./gradlew compileTestJava
./gradlew test --tests 'one.rewind.xforce.vehicle_routing.rest.test.NodeResourceTest'
./gradlew test --tests 'one.rewind.xforce.vehicle_routing.rest.test.PoiResourceDisabledTest'
./gradlew test --tests 'one.rewind.xforce.vehicle_routing.rest.test.ScenarioResourceAuxTest'
./gradlew test --tests 'one.rewind.xforce.vehicle_routing.mcp.test.McpServerTest'
./gradlew quarkusBuild -x test
./gradlew quarkusBuild -Dquarkus.package.type=native -x test
```

说明：

- 全量 `./gradlew test` 仍可作为补充验证
- 当前仓库存在部分历史测试与场景稳定性问题，CI 先以公开版主路径验证为主

## 文档与配置约束

- 公开版文档以代码和配置为准
- 不要在仓库中提交真实密钥、内部发布配置或私有仓库地址
- 涉及 `README`、`SECURITY`、第三方说明时，应提供可核验的事实和上游来源；未确认的许可或公开边界不得进入发布分支
