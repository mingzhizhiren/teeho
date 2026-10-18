# 接入自己的数据与算法

先按[自部署指南](install.md)完成一次图文诊断。以下路径均相对于公开仓库根目录；在完整开发仓库中先 `cd _github`。本页基于 2026-10-18 源码核对，示例用于理解扩展方式，不代表评分质量经过验证。

## 1. 复制一个独立插件

在目标目录尚不存在时执行：

```bash
cp -R plugins/example plugins/my-plugin
```

在副本的 `source.ts`、`metrics.ts`、`algorithms.ts`、`config.ts` 中，把所有能力 ID 里的 `example/` 改为 `my-plugin/`，包括模板字符串中的前缀。在 `index.ts` 中将插件 `id: 'example'` 改为 `id: 'my-plugin'`。导出的 `examplePlugin` 等本地变量名可以保留；能力 ID 和引用必须成套修改。

| 文件 | 本轮需要修改什么 |
| --- | --- |
| `source.ts` | 数据源 ID；读取方式可先保持 JSON 文件 |
| `data/notes.json` | 替换成自己的合法数据，或先用空数组验证 |
| `metrics.ts` | 指标 ID、依赖 ID、口径及版本 |
| `algorithms.ts` | 算法 ID、`requires`、`metric(...)` 中的指标 ID，以及计算规则 |
| `config.ts` | `dataSource`、六维算法选择、`displayMetrics` 的指标 ID 和展示名称 |
| `index.ts` | 插件 ID 和版本；注册副本中的能力 |

从 [SDK 入口](../../plugins/sdk.ts)导入契约；不要让插件导入外层私有仓库。完整契约说明见[示例 README](../../plugins/example/README.md)。

## 2. 先验证无参考数据仍可运行

将副本的 `data/notes.json` 内容设为：

```json
{"notes": [], "topics": []}
```

保留 `config.ts` 的 `referenceRequirement: 'optional'`，因为示例的六维算法只依赖用户提交内容。设置 `server/.env`：

```dotenv
TEEHO_PLUGIN_CONFIG=../plugins/my-plugin/config.ts
TEEHO_INSIGHT_ENABLED=false
```

重启 `bun run dev:server` 并提交一份新诊断。预期是报告可以完成、没有参考对比、收藏增长显示不可用；不能期待空数据产生真实市场统计。非法 JSON、依赖 ID 不一致或插件抛错仍会失败，`optional` 不会忽略这些错误。

## 3. 接入真实笔记数据

保持 JSON 读取时，用自己的数据替换 `data/notes.json`。下面只演示结构，身份、文字、日期和计数均为合成示意，不应当作真实样本：

```json
{
    "notes": [{
        "noteId": "demo-note-1",
        "authorId": "demo-author-1",
        "noteType": "normal",
        "title": "周末在家做拿铁",
        "body": "准备咖啡和牛奶，记录制作过程。",
        "topics": ["居家咖啡"],
        "publishedAt": "2026-10-01T00:00:00Z",
        "observations": [
            {"observedAt": "2026-10-02T00:00:00Z", "likes": 20, "collects": 8, "comments": 2},
            {"observedAt": "2026-10-03T00:00:00Z", "likes": 30, "collects": 12, "comments": 3}
        ]
    }],
    "topics": []
}
```

字段约束以[证据 schema](../../server/src/analysis/evidence/analysis.evidence.ts)和 [JSON 适配器](../../server/src/customization/json-source.ts)为准。观察时间必须真实，缺失互动用 `null`，真实零用 `0`。一次观察不足以计算增长。上面的单条示意不保证满足参考筛选所需的数量、时间、赛道和内容条件。

需要从数据库或内部 API 读取时，替换 `source.ts` 中 `createJsonSource({ read })` 的 `read`，返回同样的对象结构，而不是 JSON 字符串。连接配置放服务端环境变量并在数据源入口校验；查询参数化，外部请求传递取消信号并设超时。数据源只负责读取和转换事实，指标和算法不直接查询数据库。

`createJsonSource` 的 `read` 只接收 `AbortSignal`，不接收本次任务的赛道、窗口等参数；适配器在读取后筛选。数据量较大或需要按任务查询时，应实现 [DataSource 契约](../../server/src/customization/contract.ts)的 `load(input)`，使用任务与 `asOf`，不要把全库数据每次全部加载。

当算法依赖同类样本才能评分时，改用 `referenceRequirement: 'required'`，并验证参考不足会失败。不要通过填充合成数据或刷新观察日期冒充真实证据。真实数据文件应放在受控部署目录，不提交到公开仓库；改变读取位置时，同步生产包路径和服务账号权限。

## 4. 修改一维算法并观察新结果

先做一个容易验证的教学改动：在副本 `algorithms.ts` 的 `RULES` 中，把 `titleLength: 8` 改为 `titleLength: 12`，其余逻辑保持不变。现有公式按标题长度与该阈值之比计算 `titleExpression`，并封顶到 10。

用相同素材、标题 `周末在家做拿铁` 创建修改前后的两份新诊断。该标题含 7 个字符，教学公式的标题维度应从 `8.75` 变为 `5.83`。这只是验证自定义代码生效，不表示更长标题必然更优秀，也不应要求主分等于该维度分数。报告是否展示该项还取决于部署的报告权限。

继续开发时，可替换某一维的 `evaluate` 和它声明依赖的指标；维度名称、含义与 0～10 范围保持固定，无法评分返回 `null`。统计指标返回真实 `basis`，缺少证据返回 `unavailable`，不要用零代替缺失。新增公开展示项需在 `displayMetrics` 中显式选择。

## 5. 构建自己的插件

默认 [后端构建脚本](../../server/scripts/build.ts)只打包 `example`，且会清理 `server/dist/plugins/`。仅设置 `TEEHO_PLUGIN_CONFIG` 不会自动生成自定义 JS。下面的命令必须在每次 `bun run build` **之后**执行，顺序不可颠倒：

```bash
# 公开仓库根目录；先构建完整应用
bun run build

# 再打包副本配置；其源码相对导入会一并打包
bun build ./plugins/my-plugin/config.ts --target=bun --format=esm --external=pino --minify --define 'DEBUG=false' --outdir ./server/dist/plugins/my-plugin
mkdir -p server/dist/plugins/my-plugin/data
cp plugins/my-plugin/data/notes.json server/dist/plugins/my-plugin/data/notes.json
```

JSON 文件通过 `import.meta.url` 相对读取，必须与配置包保留上述布局。若改成外部数据文件或数据库，部署对应的运行时资源和环境变量，不再机械复制示例 JSON。长期维护时将这些步骤纳入自己的发布脚本；默认脚本不会发现新插件目录。

在正式环境 `server/.env` 设置：

```dotenv
TEEHO_PLUGIN_CONFIG=./dist/plugins/my-plugin/config.js
```

重启 API 和启用中的视频 Worker，提交新的验收任务。回滚时恢复旧配置包、数据版本及对应路径，而不是只切换前端。

## 6. 验证与能力边界

先运行已有公共边界与插件测试，再验证自己的插件。现有测试不会自动覆盖新写的业务规则：

```bash
bun run test:boundaries
bun run test:plugins
```

自己的验证至少覆盖正常数据、空数据、缺失观察、非法格式、参考不足及构建后的实际路径。分别保留源码运行和构建产物运行的结果。实际数据与真实 Provider 验收在自己的测试环境完成，避免拿生产素材调试。

这些扩展点提供数据源、指标、六维算法和展示项。官方私有训练程序、模型权重和语义召回装配不随源码提供；把 `TEEHO_INSIGHT_ENABLED` 改成 `true` 不会自动得到这些能力。插件是受信任部署者加载的服务端代码，不是用户上传代码的沙箱。
