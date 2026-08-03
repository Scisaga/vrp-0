# 第三方组件与保留源码说明

项目自身代码使用根目录 `LICENSE` 中的 Apache License 2.0。依赖项和随仓库分发的第三方资源仍适用各自许可证；本文件记录公开快照中需要特别保留的来源与说明。

## 字体与图标

| 组件 | 仓库内文件 | 许可证 | 上游来源 |
| --- | --- | --- | --- |
| Source Han Sans SC | `src/main/resources/META-INF/SourceHanSansSC-Normal-Min.ttf` | SIL Open Font License 1.1 | <https://github.com/adobe-fonts/source-han-sans> |
| Material Symbols | `src/main/resources/META-INF/resources/static/assets/fonts/material-symbols-*.ttf`、`assets/scenario-runtime/dependencies/material_symbols_rounded/` | Apache License 2.0 | <https://github.com/google/material-design-icons> |

Source Han Sans 的 Reserved Font Name、版权声明和完整许可条件见 [`licenses/Source-Han-Sans-OFL-1.1.txt`](licenses/Source-Han-Sans-OFL-1.1.txt)。Material Symbols 的完整 Apache 2.0 条款与本项目根目录 `LICENSE` 相同。

## 前端依赖与本地副本

前端直接依赖及锁定版本以 `src/main/resources/META-INF/resources/static/package.json` 和 `package-lock.json` 为准。公开快照包含或构建时使用的主要组件包括：

| 组件 | 许可证 | 说明 |
| --- | --- | --- |
| Alpine.js 3.15.3 | MIT | 本地运行时副本位于 `assets/vendor/alpinejs/` |
| Alpine.js Web Components 0.1.3 | MIT | 本地运行时副本位于 `assets/vendor/alpinejs-web-components/` |
| CodeMirror 6 及 Lezer 依赖 | MIT | 本地模块副本位于 `assets/vendor/codemirror/` |
| Plotly.js 3.3.1 | MIT | `plotly-basic.min.js` 保留上游版权与 MIT 许可头 |
| Lightweight Charts 5.1.0 | Apache License 2.0 | 构建依赖；使用时应保留上游 NOTICE 与可见归属要求 |
| Tailwind CSS、PostCSS、Autoprefixer | MIT | 仅用于构建静态 CSS |

随仓库分发的 MIT 组件许可和版权声明位于 `licenses/`。完整直接和传递依赖、版本及其声明许可证可从 lockfile 和 Gradle 依赖图核验；更新依赖时必须同步检查本文件。


## 保留的上游兼容源码

`src/main/java/org/optaplanner/quarkus/deployment/` 下保留 8 个同包名兼容源码文件。它们不是本项目原创源码，文件头声明由 Apache Software Foundation 按 Apache License 2.0 授权，发布时必须保留原文件头。当前仓库不存在 `src/main/java/io/quarkus/` 下的同包名覆盖源码。

## 品牌标识

静态页面中的 Harness、Visual Studio Code、Codex 及项目品牌图像仅用于标识对应产品或集成。相关名称和标识归各自权利人所有；项目的 Apache License 2.0 不授予第三方商标权，也不表示相关权利人对本项目的认可。
