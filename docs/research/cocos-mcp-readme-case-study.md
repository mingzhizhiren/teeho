# `cocos-mcp-server` 仓库首页案例研究

调研对象：[DaxianLee/cocos-mcp-server](https://github.com/DaxianLee/cocos-mcp-server)。本文仅分析其 GitHub README 的信息设计，不评价产品实现，也不直接修改题火 README。

## 结论先行

这个案例的优势不在精致的品牌视觉，而在于它把产品介绍、演示入口、功能说明、快速使用、安装、开发和故障排查放进了同一条完整路径。访问者可以从“它是什么”一路走到“如何运行”和“遇到问题怎么办”。

题火应借鉴这种完整性，但需要显著收紧篇幅和层级：首屏先表达设计理念和一句话使用方式，再用真实演示建立信任，之后才进入能力、安装、教程与技术细节。参考仓库把 Pro 产品推广和更新日志放得过早、内容重复且页面过长，这些不适合照搬。

## 观察到的版式

### 1. 首屏

参考 README 的首屏依次是：H1 项目名、多语言切换、一段定位描述、一句加粗的量化卖点，然后立即进入 Pro 版本和相关链接。它没有居中的品牌 Logo，也没有常见的 shields.io 状态徽章。[主 README](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md)

优点是信息出现得快；不足是缺少明确视觉锚点，且商业版信息抢在开源版本的核心使用路径之前。题火可以保留“项目名 → 语言 → 一句话定位”的紧凑性，但应在最上方加入居中的题火 Logo，并让“为什么做题火”成为首屏主叙事。

### 2. 图标和导航

参考项目主要用 Unicode Emoji（如 `🌐`、`🚀`、`🎯`、`🔧`、`📦`、`⚠️`）标记语言、章节和功能类别；未发现名为 “U8” 的独立图标体系或图标资源引用。仓库内虽有 [`static/icon.png`](https://github.com/DaxianLee/cocos-mcp-server/blob/main/static/icon.png)，但 README 没有把它作为 Hero Logo 使用。[主 README](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md)

如果“u8 图标”指的是 UTF-8/Unicode Emoji，题火可以采用，但应克制：只用于一级信息入口或固定栏目，不要每个标题随机换图标。若“U8”指某个特定图标库，则在改 README 前需要先确认具体来源和授权。

参考项目没有独立目录导航；长 README 主要依赖 GitHub 自动生成的标题锚点。这在页面变长后查找成本较高。题火应在 Hero 后放一行简洁导航，例如“设计理念｜能力｜演示｜快速开始｜教程｜隐私｜许可证”。

### 3. 演示和示例

参考项目用一张可点击的 GitHub user-attachments 图片跳转到 Bilibili 视频，能够在不嵌入播放器的情况下提供视觉预览；快速使用部分针对 Claude CLI、Claude 客户端和 Cursor/VS 类客户端分别给出配置代码。[演示章节](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md#当前开源本视频演示) · [快速使用](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md#快速使用)

题火更适合展示一张真实、脱敏的“提问 → 诊断 → 报告”横向流程图或短 GIF，并紧接三条自然语言示例。首屏 Logo 负责品牌识别，演示图负责证明产品价值，两者不应混成一张信息拥挤的海报。

### 4. 安装、使用与教程扩展

参考项目把“快速使用”“安装说明”“使用方法”“开发”“故障排除”拆成独立章节，安装步骤使用编号小节，配置使用代码块，后续贡献者也能看到源码结构和扩展方式。[安装说明](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md#安装说明) · [开发](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md#开发) · [故障排除](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md#故障排除)

这种分层值得保留，但题火不应把持续增长的教程全文堆进首页。README 只保留最短成功路径，详细教程放进稳定的 `docs/` 结构，并预留教程索引：

```text
docs/
├── getting-started.md
├── tutorials/
│   ├── diagnose-text-note.md
│   ├── diagnose-media-folder.md
│   └── read-history.md
├── privacy.md
└── troubleshooting.md
```

README 的“使用教程”用卡片式表格或短列表链接到这些文档；以后增加教程时只补一条入口，不改变首页主体结构。

### 5. 多语言

参考项目在第一屏提供 11 种语言入口，每种语言使用独立 README 文件，例如 [`README.EN.md`](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.EN.md) 和 [`README.zh-TW.md`](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.zh-TW.md)。默认 README 为简体中文。[多语言入口](https://github.com/DaxianLee/cocos-mcp-server/blob/main/README.md#cocos-creator-mcp-服务器插件)

题火当前只需“简体中文（默认）｜English”。语言切换放在 Logo/项目名下方，并保证两份 README 的栏目结构一致。文件名应继续采用仓库已有的 `README.md` 与 `README.en.md`，不必照搬参考项目的大写命名。

## 建议的题火 README 信息架构

1. **Hero / 品牌区**：居中 Logo、`题火 Teeho`、一句设计理念、一句产品说明、语言切换、官网与安装入口。
2. **设计理念**：用 3 个短点回答“为什么是诊断而不是代写”“为什么由 Agent 驱动”“为什么结果必须有依据”。这是让人一眼理解题火的核心。
3. **一分钟看懂题火**：一张真实脱敏演示图或 GIF，加一条“用户一句话 → Agent 确认素材 → 题火分析 → 返回完整报告”的说明。
4. **核心能力**：按用户收益分组，而不是按内部命令分组；控制在 4–6 项。
5. **快速开始**：安装一句话、首次诊断一句话、查看结果一句话；让访问者在一个屏幕内完成最短路径。
6. **使用教程**：教程索引，初期放“文字笔记”“图片/视频笔记”“素材文件夹”“历史报告”；以后可横向扩展。
7. **工作方式与边界**：简图说明 Agent Skill、题火服务与本机历史；明确“诊断已有内容，不代写”。
8. **数据与隐私**：只保留关键摘要，并链接详细文档。
9. **兼容性 / 系统要求**：Agent Skill 支持范围、Python 要求、当前已验证环境。
10. **项目路线与仓库结构**：说明当前先开放 Skill，前后端后续逐步公开；避免承诺具体日期。
11. **贡献、问题与支持**：Issue、讨论、故障排查和商业授权入口。
12. **许可证**：非商业许可摘要和完整许可证链接。

建议 Hero 之后设置紧凑的页内导航，使未来加入教程、贡献指南和前后端文档时仍能保持稳定结构。

## 应借鉴与不应照搬

| 应借鉴 | 不应照搬 |
| --- | --- |
| 默认中文、顶部语言切换 | 首屏连续堆放大量商业版链接 |
| 演示图片可点击跳转视频 | 用更新日志占据 README 主体 |
| 快速使用给出可复制示例 | 同一能力在多个章节反复描述 |
| 安装、使用、开发、排错分层 | 过多二三级标题导致阅读节奏破碎 |
| Emoji 帮助快速扫读 | 无统一语义地大量使用 Emoji |
| README 能覆盖从认识到排错的路径 | 把所有教程全文长期塞在首页 |

## Logo 和图标落位建议

Logo 建议单独存放在 `docs/assets/teeho-logo.png`（或未来统一的公开资产目录），采用透明背景，并提供适合 GitHub 明暗主题的足够对比度。README 顶部可用 HTML 居中，Logo 下方放名称、理念和入口；不要把关键文案烘焙进图片，以免影响搜索、复制、翻译和无障碍阅读。

图标应建立固定映射，例如：`✨ 设计理念`、`🎯 核心能力`、`🚀 快速开始`、`📚 使用教程`、`🔒 数据与隐私`。图标只是导航辅助，标题文字仍承担语义与 SEO。

## 设计判断

题火 README 的首要任务不是证明功能很多，而是让访问者在十秒内理解：**题火相信好内容需要可解释的诊断，而不是替创作者写作；用户只需对 Agent 说一句话，就能获得针对已有小红书笔记的系统分析。** 后续能力、演示和安装都应围绕这句话展开。
