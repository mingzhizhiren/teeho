# 题火社区版源码

社区版包含诊断工作区、登录与设备授权、任务和历史、图片与视频处理、Agent 接入、插件 SDK、JSON 示例数据源和已公开的风险词库。

社区版不包含订阅、积分、支付、退款、运营后台、推广归因、官网运营内容、算法训练、正式模型权重或爬取的数据。示例算法用于理解和扩展流程，不代表题火线上服务的效果。

## 源码位置

| 目录                        | 职责                                     |
| --------------------------- | ---------------------------------------- |
| `frontend/`                 | Vue 诊断客户端                           |
| `server/`                   | API、任务处理、素材和 Agent 接入         |
| `plugins/`                  | 中立 SDK 与 example 插件                 |
| `packages/content-metrics/` | 文本结构计数、观察时间规则与教学案例排序 |
| `supabase/`                 | 社区版数据库初始化及受保护的素材清理     |
| `skills/teeho/`             | 可独立安装的 Agent Skill                 |
| `tools/`                    | 发布范围检查与技能打包                   |

## 安装和启动

以下命令从公共仓库根目录执行。在私有开发工作区中，对应位置是 `_github/`。

```sh
bun install --frozen-lockfile
```

按照 [数据库配置](../deployment/database.md) 在专用 Supabase 项目初始化社区结构。将 `server/.env.example` 和 `frontend/.env.example` 分别复制为各目录的 `.env`，填入自己的服务配置。所有密钥只放服务端；不要把生产环境变量文件带入源码。

在两个终端分别启动：

```sh
bun run dev:server
```

```sh
bun run dev:frontend
```

视频处理还需按服务端配置安装 FFmpeg，并启动视频 Worker：

```sh
bun run dev:video-worker
```

社区版默认使用 `plugins/example/config.ts`。示例 JSON 是合成数据；其观察时间保持原样，不会自动伪造为当天。调整示例时，使用明确的合成笔记及有序观察时间；使用自有数据时，通过插件数据源接口接入。

## 验证

```sh
bun run test:boundaries
bun run test:database
bun run test
bun run build
bun run lint
bun run test:skill
```

安装 Playwright 的 Chromium 后，可运行使用合成 API 的工作区和注册流程测试：

```sh
bun run --cwd frontend test:e2e
```

单元测试使用合成数据和替身；真实登录、模型调用和视频处理需要部署者完成自己的配置。数据库测试不会迁移真实 Supabase 项目。

`test:boundaries` 检查公共目录的源码引用与私有模块，不替代发布前对新文件、示例资源和依赖的人工审查。独立克隆后应能完成安装与构建，不能依靠仓库外的源码、配置或文件系统链接。

## 扩展与维护

数据、指标和六维算法通过 [插件 SDK](../../plugins/example/README.md) 组合。插件由受信任的部署者指定，不接受 HTTP 请求选择任意模块。

公共源码在本仓库维护。任务租约、鉴权、所有权校验、超时和资源保护属于诊断核心；去掉商业计费不意味着取消这些保护。

技能仍可独立安装。修改技能源码后执行 `bun run package:skill` 生成网站下载包；该命令不会提交、推送或创建 GitHub Release。
