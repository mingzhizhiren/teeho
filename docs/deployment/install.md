# 题火自部署指南

本文介绍如何从源码部署题火的网站、API 和视频处理进程。默认方案为 **Linux + Bun + Nginx + 独立 Supabase 云项目**。

下文所有相对路径和命令均以发布仓库根目录为起点，即包含 `frontend/`、`server/`、`plugins/` 和 `supabase/` 的目录。在包含 `_github/` 的开发仓库中，请先 `cd _github`；不要混用外层目录的配置、构建命令或数据库迁移。

本文命令使用 Bash；Windows 用户可在 WSL 中按 Linux 步骤操作。`<release-tag>`、`<project-ref>` 和 `notes.example.com` 均需替换。源码与命令核对日期：2026-10-18；这是静态核对，不代表已在你的服务器或云项目完成部署验收。

按目标选择路线：

| 目标 | 阅读顺序 | 完成标准 |
| --- | --- | --- |
| 首次跑通图文诊断 | 第 1、2、3 节 → 第 4 节本地配置 → 第 5 节 | 注册、上传、提交和报告展示成功；可先用 `mock` |
| 使用自己的数据与算法 | 完成首次诊断 → [定制实操](customization.md) | 新任务使用自己的配置，缺少数据时行为符合预期 |
| 对外提供服务 | 真实 Provider 验证 → 第 6、7、8 节 | HTTPS、进程托管、本站 Skill 和清理链路均验收 |
| 更新或恢复已有部署 | 第 9 节 → [运维与恢复](operations.md) | 保留旧制品和备份，按数据库兼容性选择恢复方式 |

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

### 1.1 准备 Linux 环境

下面以 Ubuntu 24.04 LTS 为例。先在开发机完成本地路线；部署到服务器时，在服务器重复环境和依赖准备。

```bash
sudo apt-get update
sudo apt-get install -y git curl unzip ca-certificates python3

# 正式服务器需要；仅本机验证时可跳过
sudo apt-get install -y nginx

# 开启视频时需要
sudo apt-get install -y ffmpeg
```

按 [Bun 官方安装说明](https://bun.sh/docs/installation)安装与所选版本 `package.json` 中 `packageManager` 一致的 Bun。不要用“系统已有最新版”替代版本核对。重新打开终端后检查：

```bash
git --version
bun --version
python3 --version

# 仅视频部署
ffmpeg -version
ffprobe -version
```

Python 应为 3.9 或以上；若构建脚本找不到它，可在构建终端设置 `export TEEHO_PYTHON="$(command -v python3)"`。服务器需能访问 Supabase、依赖下载源和所选 Agent 服务。先仅启用图文，视频资源需求用自己的素材压测；本文不提供未经测量的最低 CPU/内存承诺。

## 2. 获取源码与安装依赖

```bash
git clone https://github.com/mingzhizhiren/teeho.git
cd teeho

# 正式部署先切换到选定的发布标签，再安装依赖。
git checkout <release-tag>
bun install --frozen-lockfile

cp server/.env.example server/.env
cp frontend/.env.example frontend/.env
chmod 600 server/.env
```

`<release-tag>` 是需要替换的占位符。开发验证可以使用当前分支；正式部署记录实际使用的 Tag 或 Commit。

当前仓库中的字段说明以 [后端模板](../../server/.env.example)和[前端模板](../../frontend/.env.example)为准。不要将填有密钥的 `.env` 提交到 Git。后续命令仍在本节的仓库根目录执行。

## 3. 初始化 Supabase

### 3.1 数据库迁移

以下命令使用本仓库依赖中的 Supabase CLI。登录后链接**本次部署的项目**，先核对预览结果，再执行迁移：

```bash
bunx supabase login
bunx supabase link --project-ref <project-ref>
bunx supabase migration list
bunx supabase db push --dry-run
bunx supabase db push
bunx supabase migration list
```

只使用当前目录下的 `supabase/migrations/`。这些迁移包含诊断表、视频表、约束、私有素材桶及清理任务；不需要另外手工创建业务表或将素材桶设为公开。对已有部署升级时，同样先检查待执行的迁移，不重新初始化或执行 `db reset`。

命令细节见 [Supabase CLI 参考](https://supabase.com/docs/reference/cli/supabase-db-push)。

最后一次 `migration list` 应显示本地与远端版本对应；存在不明远端历史时先停止，不使用 `repair` 或 `reset` 跳过核对。`supabase/config.toml` 不是托管项目控制台设置的完整同步工具：下面的 Auth、Storage 限额和函数秘密仍需在目标项目检查。

### 3.2 登录配置

在 Supabase Auth 的 URL Configuration 中设置：

- Site URL：正式网站地址，例如 `https://notes.example.com`。
- Redirect URLs：加入实际使用的网站地址；开启 Google 登录时，加入 `https://notes.example.com/api/auth/google/callback`。
- 本地调试时再加入相应的 `http://127.0.0.1:8080` 和后端回调地址，保持主机名一致。

首次本地运行时，将测试项目 Site URL 设为 `http://127.0.0.1:8080`。如使用 Google 登录，再将 `http://127.0.0.1:9634/api/auth/google/callback` 加入 Redirect URLs；首次跑通可只使用邮箱登录。

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
   bunx supabase functions deploy cleanup-analysis-media --project-ref <project-ref> --use-api
   ```

仓库的 `supabase/config.toml` 已为此函数设置 `verify_jwt = false`；函数自行验证 `x-teeho-cron-secret`，这并不代表允许匿名清理。托管环境提供函数使用的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，不要把这些服务端凭据放入前端。

`--use-api` 使用服务端打包，不要求本地启动 Docker。执行前可用 `bunx supabase functions deploy --help` 核对当前锁定 CLI 支持的参数，见 [CLI 说明](https://supabase.com/docs/reference/cli/supabase-functions-deploy)。

部署后，在 SQL Editor 中检查任务与调用结果：

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'teeho-%';

SELECT public.invoke_analysis_media_cleanup();
```

最后一个调用只返回异步 HTTP 请求编号，应继续查看 Edge Function 日志和 `net._http_response`，确认函数返回成功。定时任务使用数据库的调度时区；不要把调度表达式直接当作服务器本地时间。

该函数负责 `analysis-media` 图片对象。`analysis-video` 原片及派生证据由独立视频 Worker 按状态、到期时间和租约清理；关闭 `VIDEO_ENABLED` 只停止新上传资格，已有任务和清理仍需 Worker。检查方法与失败恢复见[运维与恢复](operations.md)。删除存储对象应使用 Storage API，不直接删除 `storage.objects` 记录。云端任务与结果有短期保留规则，浏览器和 Skill 的本地历史不等于云端永久备份。

### 3.4 检查 Storage

在目标项目 Storage 中确认 `analysis-media`、`analysis-video` 桶已由迁移创建且为私有。不要为了排除上传错误改成公开桶。检查项目级上传大小限制与桶限制：本地 `config.toml` 的 `400MiB` 不证明托管项目具有同样限额；项目级限额过低时，应用允许的文件仍可能上传失败。先用一张小尺寸 JPEG/PNG 验证，再测试计划支持的视频大小。

## 4. 配置后端

编辑 `server/.env`，保留模板中的其他配置。首次运行先填自己的 `TEEHO_PWD`、Supabase URL、两种 key 和数据库连接串，再使用以下本地设置；这仍然连接你的测试 Supabase 云项目：

```dotenv
NODE_ENV=development
DEBUG=false
PORT=9634
CORS_ORIGIN=http://127.0.0.1:8080
PUBLIC_API_URL=http://127.0.0.1:9634
TEEHO_DEPLOYMENT_MODE=local
TEEHO_PLUGIN_CONFIG=../plugins/example/config.ts
TEEHO_INSIGHT_ENABLED=false
VIDEO_ENABLED=false
TEEHO_AGENT_PROVIDER=mock
TEEHO_AGENT_MODEL=
```

`mock` 可以验证流程，仍需要真实可用的 Auth、数据库和 Storage。它不会验证真实模型能力。下面是准备正式部署时改用的关键项；第一次本地运行无需先切到生产配置：

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

### 5.1 启动前后端

编辑 `frontend/.env`：

```dotenv
API_PROXY_TARGET=http://127.0.0.1:9634
VITE_API_BASE_URL=/api
VITE_FRONTEND_PORT=8080
VITE_TEEHO_PWD=replace-with-a-stable-project-specific-public-seed
```

`VITE_TEEHO_PWD` 会进入浏览器产物，不是秘密，也不能与服务端密钥共用；产生本地历史后保持稳定。`API_PROXY_TARGET` 只用于 Vite 开发代理，正式部署由 Nginx 转发 `/api/`。

确认后端使用第 4 节的本地设置。分别在终端执行，每条长期运行的命令占一个终端：

```bash
bun run dev:server
bun run dev:frontend

# 启用视频时另开一个终端执行
bun run dev:video-worker
```

访问 `http://127.0.0.1:8080`。本地与正式环境使用不同的 Supabase 项目，不要使用生产数据做调试。

### 5.2 完成第一次图文诊断

先检查 API，成功应为 HTTP 200 且 JSON 中 `code` 为 `0`：

```bash
curl --fail http://127.0.0.1:9634/api/health
```

1. 打开网页，用测试邮箱注册、完成邮件确认并登录。
2. 准备一张自己有权使用的 JPEG/PNG 咖啡照片，作为封面及图文素材，按页面提示完成必填项。不要只填写图片路径。
3. 输入下面的测试文字，完成上传后提交一次分析。

   ```text
   标题：周末在家做一杯拿铁
   正文：今天记录在家做拿铁的过程。先准备咖啡和牛奶，再完成萃取与奶泡。

   我把杯子放在窗边拍照，记录这次练习。你平时更喜欢热拿铁还是冰拿铁？
   话题：居家咖啡、拿铁练习
   ```

4. 等待任务完成，确认能看到评分和报告；刷新后在当前浏览器重新查看历史。
5. 按第 4 节配置真实 Provider，重启 API，再创建一份新诊断验证图片理解和内容评价。历史报告不会因为换了 Provider 自动重算。

示例插件的评分是教学规则，不要求出现固定分数。合成样本不匹配或已过期时，`referenceRequirement: 'optional'` 允许完成分析；没有同类参考、收藏增长不可用是允许的结果，不应伪造样本日期来消除它。通过 `mock` 的测试只能标记“流程通过”，通过真实 Provider 后仍不意味着获得官方洞察模型。

若任务失败，先记录任务 ID，再查 API 终端中的错误阶段；图片上传失败查 Storage 配置，素材理解失败查 Provider，任务长期排队查数据库连接和 Worker 日志。不要连续重新提交掩盖原任务。更换自己的数据或评分规则见[定制实操](customization.md)。

### 5.3 验证本站 Skill

从运行中的实例下载，不直接用仓库内或静态目录中的 ZIP 代替本站下载接口：

```bash
curl --fail --location http://127.0.0.1:9634/api/skill/download -o teeho-local-skill.zip
unzip -p teeho-local-skill.zip teeho/endpoint.json
```

`apiUrl` 应为 `http://127.0.0.1:9634/api`。正式部署时将下载地址换成 `https://notes.example.com/api/skill/download`，包内应为 `https://notes.example.com/api`。接口会按服务端 `PUBLIC_API_URL` 重写配置；只支持 HTTPS 或本机回环 HTTP。远程服务器的 `127.0.0.1` 不能供其他人的 Agent 使用。

按[安装说明](../skill-install.md)将包中完整 `teeho/` 目录安装到 Agent 的 Skill 目录；已有安装先备份，不混合覆盖。随后在最终安装位置执行：

```bash
python3 -B -S -X utf8 "<AGENT_SKILLS_DIR>/teeho/tools/teeho.py" installation
python3 -B -S -X utf8 "<AGENT_SKILLS_DIR>/teeho/tools/teeho.py" help
```

前者应返回 `state: ready`，后者应包含非空帮助文本。再让 Agent 诊断上述素材，确认请求落在自己的服务日志中。若仍连接其他站点，检查安装副本的 `endpoint.json` 以及宿主进程是否设置了覆盖地址的 `TEEHO_API_URL`；本地安装检查本身不证明远程服务可用。

## 6. 构建与进程托管

构建前在正式服务器的独立目录配置正式环境，尤其是插件路径、公开地址、真实 Provider 和 `DEBUG=false`；保留开发机的测试配置。前端继续使用 `/api`，正式 Supabase 项目按第 3 节单独初始化。

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

正式环境可使用 systemd 托管。先停止手动运行的 API/Worker，避免端口冲突。下面使用固定路径 `/srv/teeho`；已有部署更新请使用[版本目录方案](operations.md)。首次部署可先准备服务账号与目录：

```bash
# 仅首次创建；账号或目录已存在时先检查现有用途
sudo useradd --system --user-group --create-home --home-dir /var/lib/teeho --shell /usr/sbin/nologin teeho
sudo install -d -o teeho -g teeho -m 0755 /srv/teeho
sudo install -m 0755 "$(command -v bun)" /usr/local/bin/bun
```

将第 2 节源码和第 6 节完整构建目录放到 `/srv/teeho`，也可用 `sudo -u teeho -H` 在该目录获取选定版本并构建；不要只复制 `dist/app.js`。确保服务账号能读取源码、运行依赖、插件和 `.env`，Nginx 账号能读取 `frontend/dist`，父目录具有遍历权限。单独保护后端配置：

```bash
sudo chown teeho:teeho /srv/teeho/server/.env
sudo chmod 600 /srv/teeho/server/.env
sudo -u teeho /usr/local/bin/bun --version
# 仅启用视频时
sudo -u teeho /usr/bin/ffmpeg -version
sudo -u teeho /usr/bin/ffprobe -version
```

`LOG_FILE_DIR` 留空时日志进入 journal；设置目录时给 `teeho` 写权限。媒体临时目录也需可写并有足够空间。Bun 安装位置不同则调整下面的绝对路径；不依赖交互式 shell 的 PATH。

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
Environment=PATH=/usr/local/bin:/usr/bin:/bin

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

先将域名的 A/AAAA 记录指向本机；仅发布实际可达的地址。在主机防火墙和云安全组中开放 80/443，保留管理用 SSH 入口，阻止外网直连 9634/8080。应用监听端口不能仅凭“前面有 Nginx”就视为已隔离。

先准备证书，再启用下面的 TLS 配置。可使用已有证书，或按 [Certbot 的 Nginx 安装向导](https://certbot.eff.org/instructions)为实际操作系统申请证书并配置自动续期；首次签发需先有能响应域名的 HTTP 站点，不能引用尚不存在的证书启动 TLS 站点。用 `sudo certbot renew --dry-run` 验证续期（使用 Certbot 时）。

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

Ubuntu 默认布局可将配置保存到 `/etc/nginx/sites-available/teeho`，再启用。已有同名配置或链接时编辑现有文件，不重复创建：

```bash
sudo ln -s /etc/nginx/sites-available/teeho /etc/nginx/sites-enabled/teeho
```

确认没有其他站点重复声明同一 `server_name`。此模板用于社区版基本 SPA 部署，不包含官方站点的 SEO 和商业运维配置。

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

更新时使用新版本目录，先构建和验证，再安排切换；不要在正在服务的目录执行覆盖式构建。备份范围、停止进程、迁移、切换、回滚和清理监控的完整步骤见[运维与恢复](operations.md)。保留稳定密钥、前端混淆种子和完整插件配置。数据库回退不能简单等同于切回旧源码。

Skill 安装包与后端同时更新；部署配置变更后重启进程，再从本站接口重新下载并核对 `endpoint.json`。当前下载实现合并正在进行的并发打包请求，完成后会释放该缓存；不能把旧安装副本的问题都归因于服务端永久缓存。提高技能最低兼容版本前，先确认新包已可下载。

| 现象 | 优先检查 |
| --- | --- |
| Nginx 返回 502 | API 进程、监听端口、服务日志及插件配置路径 |
| 登录反复失效 | HTTPS、公开地址、CORS、Cookie，以及 Auth URL 配置是否一致 |
| 登录后页面不实时更新 | 是否错误使用 Transaction pooler、事件流是否被代理缓冲 |
| Skill 连接到了其他站点 | `PUBLIC_API_URL`、本站下载入口、安装副本的 `endpoint.json`、宿主的 `TEEHO_API_URL` |
| 能健康检查但不能分析 | Provider 配置及权限、实际数据源、任务日志；`mock` 不是实际模型 |
| 视频一直处理中 | 独立 Worker 是否启动、FFmpeg/ffprobe 是否可执行 |
| 素材没有按期清理 | Vault 名称与函数秘密是否一致、函数响应及 cron 执行日志 |
| 历史报告在另一设备不可见 | 历史保存在当前浏览器或 Skill 本机，不提供跨设备同步 |
| `bun install --frozen-lockfile` 失败 | Bun 版本是否与所选版本的 `packageManager` 一致、网络是否可达；不要删锁文件绕过 |
| 构建提示找不到 Python | `python3 --version`，以及 `TEEHO_PYTHON` 是否为有效可执行文件 |
| 上传小图成功、大视频失败 | 项目与桶的上传限制、网络、素材格式和视频 Worker 状态 |
| 修改自定义插件后发布仍使用旧规则 | 默认构建只打包 example；检查自定义 JS、数据文件、配置路径和重启，见定制实操 |
