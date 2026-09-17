# GitHub 仓库可发现性研究

研究日期：2026-09-17

## 结论

若目标是在 GitHub 仓库搜索中覆盖“小红书”“xiaohongshu”“小红书分析”“小红书内容诊断”，应把中英文核心词直接写入仓库简介，并在根 README 的首段自然重复；Topics 使用对应的英文、拼音或连字符形式。原因是 GitHub 的普通仓库搜索默认只搜索仓库名称、简介和 Topics，README 只有用户显式使用 `in:readme` 时才加入搜索范围。[GitHub：搜索仓库](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)

推荐简介：

> 题火（Teeho）— 小红书内容诊断与笔记分析工具｜Xiaohongshu (RED) content audit, note analysis and optimization

这句同时包含品牌、中文平台名、拼音平台名以及两个目标能力词，长度也适合在仓库列表中快速理解。`RED` 是补充别名，不应取代 `小红书` 和 `xiaohongshu`。

## 可执行配置

| 位置 | 建议 | 依据 |
| --- | --- | --- |
| 仓库名 | 保留 `teeho`；若现阶段获客优先级远高于品牌稳定性，可考虑 `teeho-xiaohongshu` | GitHub 支持按 `in:name` 搜索，但仓库名称只允许 ASCII 字母、数字、`.`、`-`、`_`，因此不能把“小红书”写进名称。[GitHub：创建仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) |
| 简介 | 使用上面的中英双语一句话，准确出现 `小红书`、`xiaohongshu`、`内容诊断`、`笔记分析` | 无限定符的仓库搜索会检索名称、简介和 Topics；简介是中文关键词进入默认搜索范围最直接的位置。[GitHub：搜索仓库](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories) |
| Topics | `xiaohongshu`、`rednote`、`content-analysis`、`content-audit`、`social-media-analytics`、`ai-agent`、`agent-skill` | Topics 用于分类、浏览和仓库搜索；官方要求小写字母、数字和连字符，最多 20 个，每个不超过 50 字符。[GitHub：使用 Topics 分类仓库](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) |
| 根 README | 标题下第一段同时写“题火 / Teeho / 小红书 / Xiaohongshu / 小红书内容诊断 / 小红书笔记分析”，随后说明用途、价值、安装方式和维护者 | README 可通过 `in:readme` 被仓库搜索；根 README 会自动展示给访问者，官方建议说明项目做什么、为何有用、如何开始和由谁维护。[GitHub：README](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) |
| 发布后验证 | 分别测试 `小红书`、`xiaohongshu`、`"小红书分析"`、`"小红书内容诊断"`，以及各词加 `in:description`、`in:topics`、`in:readme` | GitHub 支持对多词查询加引号，并支持按字段限定搜索。[GitHub：搜索语法](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax) |

README 首段建议：

> 题火（Teeho）是一款面向小红书（Xiaohongshu / RED）的内容诊断与笔记分析工具，帮助创作者分析内容问题并获得优化建议。当前仓库开放可安装的 AI Agent Skill。

## 为什么中英文词都要出现

GitHub 官方文档只承诺按查询词匹配名称、简介、Topics 或 README，并未承诺在“小红书”和 `xiaohongshu` 之间自动音译、翻译或同义词扩展。因此，把中文和拉丁字母写法都明确放入可搜索字段，是基于公开规则的稳妥做法，而不是依赖未公开的分词或同义词行为。搜索不区分大小写，但这不等于支持跨语言等价匹配。[GitHub：搜索仓库](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)

对“小红书分析”“小红书内容诊断”这类组合查询，应让这些短语在简介或 README 中以自然语言完整出现。GitHub 对包含空格的精确多词查询建议使用引号；中文分词细节未在官方文档中公开，所以不能保证拆词后的排序效果。[GitHub：搜索语法](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax)

## 限制与预期

- GitHub 没有公开仓库搜索的相关性评分公式。它支持按相关性、stars、forks 或更新时间排序，但不能据此承诺某个简介一定排在前列。[GitHub：排序搜索结果](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/sorting-search-results)
- Topics 能增强分类和精确检索，但不要堆满 20 个无关词。官方建议 Topic 反映项目用途、主题、社区或语言。[GitHub：使用 Topics 分类仓库](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- README 不是无条件进入普通仓库搜索：默认搜索只覆盖名称、简介和 Topics；README 需要 `in:readme`。因此不能只在 README 放关键词。[GitHub：搜索仓库](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)
- 以上措施针对 GitHub 站内发现。Google、Bing、百度等外部搜索引擎的抓取、索引和排名不由 GitHub 文档保证；公开仓库、实际内容、外部引用与时间都会影响结果，不能承诺发布后立即出现。
- 关键词必须准确描述功能，避免同义词罗列式堆砌。对访问者而言，README 首屏的清晰定位和可安装说明比机械重复关键词更重要。

## 发布验收清单

1. 仓库简介采用中英双语推荐文案。
2. 添加上述 7 个 Topics，发布后再根据 GitHub 的 Suggested topics 调整；GitHub 会分析公开仓库内容并给出建议 Topic。[GitHub：使用 Topics 分类仓库](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
3. 根 README 首屏出现推荐定位句，且正文真实解释诊断、分析、安装和隐私边界。
4. 仓库有默认分支和公开内容后，再执行站内搜索验收并记录排名；空仓库阶段无法验证 README 或代码内容的索引。
5. 后续至少用 GitHub 的相关性排序和最近更新排序复查。活跃更新是可见的排序维度，但不是关键词相关性的替代品。[GitHub：排序搜索结果](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/sorting-search-results)
