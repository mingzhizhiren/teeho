# 社区版数据库与 Storage

社区版使用部署者自己的 Supabase PostgreSQL 17、Auth 和 Storage。这里的迁移用于**全新、独立的社区部署**，不是题火线上库的升级补丁。不要将它应用到已有的题火私有数据库，也不要把私有项目的迁移历史、备份或业务数据复制过来。

## 包含的能力

`supabase/migrations/` 包含任务与队列、不可变报告、图片与视频元数据、对话短期恢复、设备授权、登录限流、分析完成通知，以及工作区失效通知。Provider 用量记录用于调试和资源限制，不是积分或收费系统。示例插件从本地合成数据文件读取证据，不需要官方数据表或数据账号。

数据库不包含积分、支付、订阅、退款、运营后台、推广埋点、训练数据或 `teeho_data` 的爬取数据。没有真实账号或媒体的 seed。

## 首次初始化

以下命令在公开仓库根目录执行；在私有开发目录中对应 `_github/`。先按应用部署说明安装依赖，并在 Supabase 创建一个空白项目。确认 project ref、数据库和用途都是这个新的社区项目。

```sh
bunx --no-install supabase link --project-ref YOUR_COMMUNITY_PROJECT_REF
bunx --no-install supabase db push --linked --dry-run
```

审阅预览，确认只有本目录的社区迁移，再执行：

```sh
bunx --no-install supabase db push --linked
```

数据库密码由 CLI 交互或安全环境提供，不放进命令参数、源码和提交记录。本仓库不会替你创建远端项目，也不会在启动应用时自动推送迁移。

`config.toml` 是 CLI 的本地配置，不能替代云端 Auth 设置。云项目需要在 Auth 中设置前端 Site URL、实际使用的回调 URL、邮件确认和 SMTP。Google 登录默认不启用；需要它时再配置自己的 OAuth 凭据与回调。服务端和前端的配置说明以各自的 `.env.example` 为准。

## 权限边界

业务写操作通过题火后端。浏览器角色不能创建或修改任务、报告、授权、上传记录和用量记录。所有 `public` 业务表开启 RLS；已登录用户通过 Data API 只能读取自己的任务和有限的结果元数据，内部执行追踪、凭据摘要和完整报告不通过该接口暴露。报告由完成所有权检查的业务 API 返回。

`analysis-media` 和 `analysis-video` 都是私有 bucket，大小和 MIME 限制随迁移创建；没有供匿名或已登录角色任意读写 `storage.objects` 的 policy。上传和读取使用后端签发的短期地址。不得把 Supabase secret / `service_role` key 写进 `VITE_*`。

图片认领和完成 RPC 使用 `SECURITY INVOKER`，仅 `service_role` 获得执行权限。Cron 调度辅助函数在未暴露的 `teeho_internal` schema 中；兼容后端主动调度的 `public.invoke_analysis_media_cleanup()` 只供部署数据库角色 `postgres` 调用，不授予 `service_role` 或浏览器角色执行和 Vault 读取权限。后端直连使用部署者自己的数据库连接；直连和 service role 不代表请求已获授权，业务层仍需校验账号与资源归属。

## 图片清理函数

迁移创建了 `pg_cron`、`pg_net` 和 Supabase Vault 集成。图片清理分为：SQL 认领记录 → Edge Function 调用 Storage API 删除对象 → SQL 回写结果。失败有有限重试和租约恢复，不用 SQL 删除 `storage.objects`。

1. 在该项目 Vault 中创建 `teeho_project_url`，值为该 Supabase 项目的 HTTPS URL。
2. 生成随机高熵共享密钥（至少 32 个字符），分别写入 Vault 的 `teeho_media_cleanup_secret` 和 Edge Function secret `TEEHO_MEDIA_CLEANUP_SECRET`，两端必须一致。
3. 将函数 secret 放入本机已忽略的 `.env.cleanup.local`，使用 CLI 上传；不要提交这个文件。

```sh
bunx --no-install supabase secrets set --project-ref YOUR_COMMUNITY_PROJECT_REF --env-file .env.cleanup.local
bunx --no-install supabase functions deploy cleanup-analysis-media --project-ref YOUR_COMMUNITY_PROJECT_REF --use-api
```

函数只接受带正确 `x-teeho-cron-secret` 的 POST 请求。配置中的 `verify_jwt = false` 是为了使用该独立服务密钥，不代表匿名开放。Supabase 为云端函数提供的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 只在函数运行环境使用。

Cron 使用 UTC：图片物理清理在 19:00，诊断记录清理在 19:30；终态任务和结果按 24 小时保留。仍有关联图片的任务不会先删掉，未完成的任务也不会被保留清理认领。对话短期结果、登出标记和登录限流另有定时清理。视频处理与视频对象清理由部署的 Video Worker 执行，因此启用视频时还必须启动该 Worker。

缺少 Vault 配置时图片清理不会发送请求，需完成上述配置后验证调度。更改保留策略应新增前向迁移，并同步检查前端、Skill 和 API 的过期提示。

## 验证

不连接云端的合成测试：

```sh
bun run test:database
```

测试在内存 PGlite 中执行全部业务 DDL，检查空库初始化、RLS、账号隔离、写权限、任务快照、图片/视频准入和清理租约。Supabase 扩展安装由轻量替身替代，因此该测试不证明 Auth 邮件、真实 Storage HTTP、Cron 执行或 Edge Function 部署成功。

在你自己的项目完成初始化后，再检查安全建议：

```sh
bunx --no-install supabase db advisors --linked --type security
```

然后用两个测试账号验证：账号 A 能提交和读取自己的诊断，账号 B 无法读取 A 的任务、素材和报告；确认上传、过期清理、设备授权和邮件登录可用。真实模型和视频处理也需要各自的运行配置。

官方参考：[Data API 权限](https://supabase.com/docs/guides/api/securing-your-api)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Storage 权限](https://supabase.com/docs/guides/storage/security/access-control)、[Vault](https://supabase.com/docs/guides/database/vault)。
