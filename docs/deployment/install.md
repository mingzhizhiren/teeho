# 题火自部署指南

本文介绍如何从源码部署题火的网站、API 和视频处理进程。默认方案为 **Linux + Bun + Nginx + 独立 Supabase 云项目**。

下文所有相对路径和命令均以发布仓库根目录为起点，即包含 `frontend/`、`server/`、`plugins/` 和 `supabase/` 的目录。在包含 `_github/` 的开发仓库中，请先 `cd _github`；不要混用外层目录的配置、构建命令或数据库迁移。

## 1. 部署内容与依赖

源码提供笔记录入、图片与视频处理、Agent 分析、报告展示、用户登录及题火 Skill 接入。默认使用示例插件中的合成数据和示例算法，不附带线上服务的爬取数据、私有洞察模型、积分、订阅或支付系统。

默认主分来自六维平均分。仅打开模型开关或导入向量表，不会自动获得线上服务的洞察预测与语义召回装配。需要使用实际数据时，按[插件说明](../../plugins/example/README.md)接入自己的数据源和算法。

准备以下依赖：

| 依赖 | 用途 |
| --- | --- |
| Git、Bun | 获取源码、安装依赖、构建与运行；Bun 版本以根 `package.json` 的 `packageManager` 为准 |
| Python 3.9+ | 构建 Skill 安装包，只需标准库；使用已构建制品的 API 服务不需要 Python |
| FFmpeg、ffprobe | 开启视频功能时必须安装，并确保视频进程的 `PATH` 能找到两个命令 |
| Nginx、域名和 HTTPS 证书 | 托管前端静态文件，将 `/api/` 转发给后端 |
| Supabase 项目 | 提供 PostgreSQL、Auth、Storage、定时任务和清理函数 |
| Agent 服务 | 默认 `mock` 仅用于验证流程；实际分析需配置真实 Provider |

不要直接将迁移应用到已有其他业务的数据库。先准备独立项目，并分别维护测试和正式环境。

## 2. 获取源码与安装依赖

```bash
git clone https://github.com/mingzhizhiren/teeho.git
cd teeho

# 正式部署先切换到选定的发布标签，再安装依赖。
git checkout <release-tag>
bun install --frozen-lockfile

cp server/.env.example server/.env
cp frontend/.env.example frontend/.env
```

`<release-tag>` 是需要替换的占位符。开发验证可以使用当前分支；正式部署记录实际使用的 Tag 或 Commit。

## 3. 初始化 Supabase

### 3.1 数据库迁移

以下命令使用本仓库依赖中的 Supabase CLI。登录后链接**本次部署的项目**，先核对预览结果，再执行迁移：

```bash
bunx supabase login
bunx supabase link --project-ref <project-ref>
bunx supabase migration list
bunx supabase db push --dry-run
bunx supabase db push
```

只使用当前目录下的 `supabase/migrations/`。这些迁移包含诊断表、视频表、约束、私有素材桶及清理任务；不需要另外手工创建业务表或将素材桶设为公开。对已有部署升级时，同样先检查待执行的迁移，不重新初始化或执行 `db reset`。

命令细节见 [Supabase CLI 参考](https://supabase.com/docs/reference/cli/supabase-db-push)。

### 3.2 登录配置

在 Supabase Auth 的 URL Configuration 中设置：

- Site URL：正式网站地址，例如 `https://notes.example.com`。
- Redirect URLs：加入实际使用的网站地址；开启 Google 登录时，加入 `https://notes.example.com/api/auth/google/callback`。
- 本地调试时再加入相应的 `http://127.0.0.1:8080` 和后端回调地址，保持主机名一致。

使用邮箱确认时，配置并验证 SMTP 发信；新账号完成邮箱确认后才能正常登录。Google 登录是可选功能，需要在 Supabase 中启用对应 Provider，并按其要求配置 OAuth 应用。无需为 Skill 的匿名身份创建流程开启 Supabase Anonymous Sign-ins。

### 3.3 图片素材清理

迁移会注册清理定时任务，但还需要部署 `cleanup-analysis-media` 函数，并提供调用凭据。

1. 生成一个至少 32 字符的随机秘密，在 Supabase Edge Function Secrets 中设置 `TEEHO_MEDIA_CLEANUP_SECRET`。
2. 在 Supabase Vault 中创建两个指定名称的条目：

   | 名称 | 值 |
   | --- | --- |
   | `teeho_project_url` | 本项目的 Supabase URL，例如 `https://<project-ref>.supabase.co` |
   | `teeho_media_cleanup_secret` | 与函数中的 `TEEHO_MEDIA_CLEANUP_SECRET` 完全相同的秘密 |

3. 部署函数：

   ```bash
   bunx supabase functions deploy cleanup-analysis-media --project-ref <project-ref>
   ```

仓库的 `supabase/config.toml` 已为此函数设置 `verify_jwt = false`；函数自行验证 `x-teeho-cron-secret`，这并不代表允许匿名清理。托管环境提供函数使用的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，不要把这些服务端凭据放入前端。

部署后，在 SQL Editor 中检查任务与调用结果：

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'teeho-%';

SELECT public.invoke_analysis_media_cleanup();
```

最后一个调用只返回异步 HTTP 请求编号，应继续查看 Edge Function 日志和 `net._http_response`，确认函数返回成功。定时任务使用数据库的调度时区；不要把调度表达式直接当作服务器本地时间。

该函数当前负责 `analysis-media` 图片对象；`analysis-video` 的对象保留与清理需另行核对部署策略。删除存储对象应使用 Storage API，不直接删除 `storage.objects` 记录。云端任务与结果有短期保留规则，浏览器和 Skill 的本地历史不等于云端永久备份。

## 4. 配置后端

编辑 `server/.env`，以文件中的字段说明为完整配置参考。以下是同域名部署的关键项：

```dotenv
NODE_ENV=production
DEBUG=false
PORT=9634
CORS_ORIGIN=https://notes.example.com
PUBLIC_API_URL=https://notes.example.com

TEEHO_PWD=replace_with_a_unique_stable_random_secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=replace_with_your_publishable_key
SUPABASE_SECRET_KEY=replace_with_your_server_secret_key
DATABASE_DIRECT_URL=postgresql://postgres:replace_with_password@your-database-host:5432/postgres

TEEHO_DEPLOYMENT_MODE=local
TEEHO_PLUGIN_CONFIG=./dist/plugins/example/config.js
TEEHO_INSIGHT_ENABLED=false
VIDEO_ENABLED=true

TEEHO_AGENT_PROVIDER=mock
TEEHO_AGENT_MODEL=
LOG_LEVEL=info
LOG_FILE_DIR=
HTTPS_CERT_PATH=
HTTPS_KEY_PATH=
```

- `DATABASE_DIRECT_URL` 从 Supabase Connect 页面获取。支持 IPv6 时可用直连；仅有 IPv4 时使用 **Session pooler，端口 5432**。工作台事件依赖持久 `LISTEN` 连接，不使用端口 6543 的 Transaction pooler。
- `TEEHO_PWD` 必须替换为自己的稳定秘密，已有加密数据后不要随意更换。数据库密码包含特殊字符时，按连接串规则进行 URL 编码。
- `TEEHO_PLUGIN_CONFIG` 上面的值用于构建产物。运行开发源码时使用 `../plugins/example/config.ts`，两者都相对于 `server/` 工作目录。
- `VIDEO_ENABLED=false` 可以关闭新的视频上传；关闭开关不会中断已经受理的视频。开启时需同时运行视频 Worker。
- 由 Nginx 终止 TLS 时，后端证书字段留空。`PUBLIC_API_URL` 必须是客户端可访问的公开地址，不能填写容器内部主机名；Skill 下载包也会使用它生成 API 地址。
- API 和视频 Worker 各自建立数据库连接池，按进程数量统筹 `DATABASE_POOL_MAX` 与数据库连接额度。

### 配置真实 Agent

| `TEEHO_AGENT_PROVIDER` | 必需配置 |
| --- | --- |
| `mock` | `TEEHO_AGENT_MODEL` 留空，仅验证部署流程 |
| `openai` | `TEEHO_AGENT_MODEL`、`OPENAI_API_KEY` |
| `gemini` | `TEEHO_AGENT_MODEL`、`GEMINI_API_KEY` |
| `codex-cli` | `TEEHO_AGENT_MODEL`；本机模式设置 `TEEHO_CODEX_CLI_PATH`，远程模式设置 `TEEHO_CODEX_MODE=remote`、远程地址与令牌 |

模型名称按实际可用服务填写，需满足仓库 Provider 的图片理解与结构化输出要求。使用本机 Codex 时，应在**运行服务的系统账号**下完成安装和授权；开发者账号能运行不代表后台服务账号也能运行。所有 Provider 秘密仅保存在服务端。

正式开放使用前，把 `mock` 改为真实 Provider，并完成一次真实图文诊断。只看到健康检查成功不能证明模型或数据源可用。

## 5. 配置前端与本地验证

编辑 `frontend/.env`：

```dotenv
API_PROXY_TARGET=http://127.0.0.1:9634
VITE_API_BASE_URL=/api
VITE_FRONTEND_PORT=8080
VITE_TEEHO_PWD=replace-with-a-stable-project-specific-public-seed
```

`VITE_TEEHO_PWD` 会进入浏览器产物，不是秘密，也不能与服务端密钥共用；产生本地历史后保持稳定。`API_PROXY_TARGET` 只用于 Vite 开发代理，正式部署由 Nginx 转发 `/api/`。

本地验证时，将后端改为 `NODE_ENV=development`，公开地址和 CORS 使用本地地址，插件路径改为源码路径。分别在终端执行：

```bash
bun run dev:server
bun run dev:frontend

# 启用视频时另开一个终端执行
bun run dev:video-worker
```

访问 `http://127.0.0.1:8080`。本地与正式环境使用不同的 Supabase 项目，不要使用生产数据做调试。

## 6. 构建与进程托管

构建前恢复第 4 节的正式环境配置，尤其是插件路径、公开地址、Provider 和 `DEBUG=false`。

```bash
bun run build
```

关键产物为：

| 路径 | 用途 |
| --- | --- |
| `frontend/dist/` | Nginx 静态网站根目录 |
| `server/dist/app.js` | API 入口，包含分析任务和图片处理 Worker 的装配 |
| `server/dist/video/video.worker-entry.js` | 独立视频 Worker |
| `server/dist/plugins/example/` | 已构建的示例插件及数据 |
| `frontend/dist/downloads/teeho-skill.zip` | Skill 分发所需安装包 |

保留运行依赖、根 workspace 配置、`server/.env` 及完整制品布局；不要只复制 `app.js`。先用以下命令验证启动：

```bash
bun run --cwd server start:release

# 启用视频时，在另一终端运行
bun run --cwd server start:video-worker:release
```

正式环境可使用 systemd 托管。下面假设源码和制品位于 `/srv/teeho`，已创建具备所需目录权限的 `teeho` 系统账号，Bun 已安装到 `/usr/local/bin/bun`；请按实际路径调整。

`/etc/systemd/system/teeho-api.service`：

```ini
[Unit]
Description=Teeho API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=teeho
WorkingDirectory=/srv/teeho/server
ExecStart=/usr/local/bin/bun run start:release
Restart=on-failure
RestartSec=5
TimeoutStopSec=120
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

视频 Worker 使用独立的 `teeho-video-worker.service`，复用上述配置，将 `Description` 改为 `Teeho Video Worker`，`ExecStart` 改为 `/usr/local/bin/bun run start:video-worker:release`。确保该账号可读取配置、插件和素材临时目录，并能执行 FFmpeg 和配置的 Agent 程序。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teeho-api
sudo systemctl enable --now teeho-video-worker  # 仅启用视频时
sudo journalctl -u teeho-api -n 100 --no-pager
```

## 7. 配置 Nginx 与 HTTPS

以下配置假设证书已经签发，网站和 API 使用同一域名。替换域名、证书位置和部署目录后再加载：

```nginx
server {
    listen 80;
    server_name notes.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name notes.example.com;
    ssl_certificate /etc/letsencrypt/live/notes.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notes.example.com/privkey.pem;

    root /srv/teeho/frontend/dist;
    index index.html;
    client_max_body_size 400m;

    location /api/ {
        proxy_pass http://127.0.0.1:9634;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering off;
        proxy_cache off;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`proxy_pass` 不附加末尾斜杠，以保留 `/api/` 路径。关闭代理缓冲用于工作台事件流。对外只开放网站所需端口，API 端口留给本机代理访问。

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://notes.example.com/api/health
```

## 8. 上线检查

- 健康接口返回 `code: 0`；直接打开并刷新 `/login`、`/workspace` 等路由正常。
- 邮箱注册、确认和登录正常；选用 Google 登录时验证完整跳转。
- 图片可以上传，一次真实诊断能完成并生成报告；刷新后能从本地历史重新查看。
- 启用视频时，确认视频 Worker 日志、FFmpeg 调用与完整视频诊断均正常。
- 从本站 `/api/skill/download` 下载技能；安装后确认访问的是本站，再完成一次诊断。安装方法见[技能安装说明](../skill-install.md)。
- 检查清理函数和定时任务的实际执行结果；不能只确认任务已注册。
- 示例插件输出不代表真实市场数据。替换数据源后重新验证参考内容、评分和不可用数据的处理。

## 9. 更新与常见问题

更新前备份数据库和环境配置、记录当前发布版本。拉取选定版本后安装锁定依赖，预览并应用新增迁移，再构建、切换制品并重启服务；保留稳定密钥、前端混淆种子和完整插件配置。数据库回退不能简单等同于切回旧源码。

Skill 安装包与后端同时更新；下载服务会缓存安装包，发布后需要重启。提高技能最低兼容版本前，先确认新包已可下载。

| 现象 | 优先检查 |
| --- | --- |
| Nginx 返回 502 | API 进程、监听端口、服务日志及插件配置路径 |
| 登录反复失效 | HTTPS、公开地址、CORS、Cookie，以及 Auth URL 配置是否一致 |
| 登录后页面不实时更新 | 是否错误使用 Transaction pooler、事件流是否被代理缓冲 |
| Skill 连接到了其他站点 | `PUBLIC_API_URL`、本站下载入口、下载服务是否已重启 |
| 能健康检查但不能分析 | Provider 配置及权限、实际数据源、任务日志；`mock` 不是实际模型 |
| 视频一直处理中 | 独立 Worker 是否启动、FFmpeg/ffprobe 是否可执行 |
| 素材没有按期清理 | Vault 名称与函数秘密是否一致、函数响应及 cron 执行日志 |
| 历史报告在另一设备不可见 | 历史保存在当前浏览器或 Skill 本机，不提供跨设备同步 |
