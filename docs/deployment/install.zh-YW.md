# 題火自部署指南

本文介紹如何從原始碼部署題火的網站、API 和影片處理程序。預設方案為 **Linux + Bun + Nginx + 獨立 Supabase 雲專案**。

下文所有相對路徑和命令均以發佈倉庫根目錄為起點，即包含 `frontend/`、`server/`、`plugins/` 和 `supabase/` 的目錄。在包含 `_github/` 的開發倉庫中，請先 `cd _github`；不要混用外層目錄的配置、建置命令或資料庫遷移。

## 1. 部署內容與依賴

原始碼提供筆記錄入、圖片與影片處理、Agent 分析、報告展示、使用者登入及題火 Skill 接入。預設使用範例外掛中的合成資料和範例演算法，不附帶線上服務的爬取資料、私有洞察模型、積分、訂閱或支付系統。

預設主分來自六維平均分。僅打開模型開關或導入向量表，不會自動獲得線上服務的洞察預測與語義召回裝配。需要使用實際資料時，按[外掛說明](../../plugins/example/README.md)接入自己的資料來源和演算法。

準備以下依賴：

| 依賴 | 用途 |
| --- | --- |
| Git、Bun | 獲取原始碼、安裝依賴、建置與執行；Bun 版本以根 `package.json` 的 `packageManager` 為準 |
| Python 3.9+ | 建置 Skill 安裝包，只需標準庫；使用已建置產物的 API 服務不需要 Python |
| FFmpeg、ffprobe | 開啟影片功能時必須安裝，並確保影片程序的 `PATH` 能找到兩個命令 |
| Nginx、域名和 HTTPS 證書 | 托管前端靜態檔案，將 `/api/` 轉發給後端 |
| Supabase 專案 | 提供 PostgreSQL、Auth、Storage、定時任務和清理函數 |
| Agent 服務 | 預設 `mock` 僅用于驗證流程；實際分析需配置真實 Provider |

不要直接將遷移應用到已有其他業務的資料庫。先準備獨立專案，並分別維護測試和正式環境。

## 2. 獲取原始碼與安裝依賴

```bash
git clone https://github.com/mingzhizhiren/teeho.git
cd teeho

# 正式部署先切換到選定的發佈標簽，再安裝依賴。
git checkout <release-tag>
bun install --frozen-lockfile

cp server/.env.example server/.env
cp frontend/.env.example frontend/.env
```

`<release-tag>` 是需要替換的占位符。開發驗證可以使用當前分支；正式部署記錄實際使用的 Tag 或 Commit。

## 3. 初始化 Supabase

### 3.1 資料庫遷移

以下命令使用本倉庫依賴中的 Supabase CLI。登入後鏈接**本次部署的專案**，先核對預覽結果，再執行遷移：

```bash
bunx supabase login
bunx supabase link --project-ref <project-ref>
bunx supabase migration list
bunx supabase db push --dry-run
bunx supabase db push
```

只使用當前目錄下的 `supabase/migrations/`。這些遷移包含診斷表、影片表、約束、私有素材桶及清理任務；不需要另外手工創建業務表或將素材桶設為公開。對已有部署升級時，同樣先檢查待執行的遷移，不重新初始化或執行 `db reset`。

命令細節見 [Supabase CLI 參考](https://supabase.com/docs/reference/cli/supabase-db-push)。

### 3.2 登入配置

在 Supabase Auth 的 URL Configuration 中設置：

- Site URL：正式網站地址，例如 `https://notes.example.com`。
- Redirect URLs：加入實際使用的網站地址；開啟 Google 登入時，加入 `https://notes.example.com/api/auth/google/callback`。
- 本地調試時再加入相應的 `http://127.0.0.1:8080` 和後端回調地址，保持主機名一致。

使用郵箱確認時，配置並驗證 SMTP 發信；新帳號完成郵箱確認後才能正常登入。Google 登入是可選功能，需要在 Supabase 中啟用對應 Provider，並按其要求配置 OAuth 應用。無需為 Skill 的匿名身份創建流程開啟 Supabase Anonymous Sign-ins。

### 3.3 圖片素材清理

遷移會注冊清理定時任務，但還需要部署 `cleanup-analysis-media` 函數，並提供調用憑證。

1. 生成一個至少 32 字符的隨機秘密，在 Supabase Edge Function Secrets 中設置 `TEEHO_MEDIA_CLEANUP_SECRET`。
2. 在 Supabase Vault 中創建兩個指定名稱的條目：

   | 名稱 | 值 |
   | --- | --- |
   | `teeho_project_url` | 本專案的 Supabase URL，例如 `https://<project-ref>.supabase.co` |
   | `teeho_media_cleanup_secret` | 與函數中的 `TEEHO_MEDIA_CLEANUP_SECRET` 完全相同的秘密 |

3. 部署函數：

   ```bash
   bunx supabase functions deploy cleanup-analysis-media --project-ref <project-ref>
   ```

倉庫的 `supabase/config.toml` 已為此函數設置 `verify_jwt = false`；函數自行驗證 `x-teeho-cron-secret`，這並不代表允許匿名清理。托管環境提供函數使用的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，不要把這些服務端憑證放入前端。

部署後，在 SQL Editor 中檢查任務與調用結果：

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'teeho-%';

SELECT public.invoke_analysis_media_cleanup();
```

最後一個調用只返回異步 HTTP 請求編號，應繼續查看 Edge Function 日誌和 `net._http_response`，確認函數返回成功。定時任務使用資料庫的調度時區；不要把調度表達式直接當作伺服器本地時間。

該函數當前負責 `analysis-media` 圖片對象；`analysis-video` 的對象保留與清理需另行核對部署策略。刪除存儲對象應使用 Storage API，不直接刪除 `storage.objects` 記錄。雲端任務與結果有短期保留規則，瀏覽器和 Skill 的本地歷史不等于雲端永久備份。

## 4. 配置後端

編輯 `server/.env`，以檔案中的字段說明為完整配置參考。以下是同域名部署的關鍵項：

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

- `DATABASE_DIRECT_URL` 從 Supabase Connect 頁面獲取。支持 IPv6 時可用直連；僅有 IPv4 時使用 **Session pooler，端口 5432**。工作臺事件依賴持久 `LISTEN` 連接，不使用端口 6543 的 Transaction pooler。
- `TEEHO_PWD` 必須替換為自己的穩定秘密，已有加密資料後不要隨意更換。資料庫密碼包含特殊字符時，按連接串規則進行 URL 編碼。
- `TEEHO_PLUGIN_CONFIG` 上面的值用于建置產物。執行開發原始碼時使用 `../plugins/example/config.ts`，兩者都相對于 `server/` 工作目錄。
- `VIDEO_ENABLED=false` 可以關閉新的影片上傳；關閉開關不會中斷已經受理的影片。開啟時需同時執行影片 Worker。
- 由 Nginx 終止 TLS 時，後端證書字段留空。`PUBLIC_API_URL` 必須是客戶端可訪問的公開地址，不能填寫容器內部主機名；Skill 下載包也會使用它生成 API 地址。
- API 和影片 Worker 各自建立資料庫連接池，按程序數量統籌 `DATABASE_POOL_MAX` 與資料庫連接額度。

### 配置真實 Agent

| `TEEHO_AGENT_PROVIDER` | 必需配置 |
| --- | --- |
| `mock` | `TEEHO_AGENT_MODEL` 留空，僅驗證部署流程 |
| `openai` | `TEEHO_AGENT_MODEL`、`OPENAI_API_KEY` |
| `gemini` | `TEEHO_AGENT_MODEL`、`GEMINI_API_KEY` |
| `codex-cli` | `TEEHO_AGENT_MODEL`；本機模式設置 `TEEHO_CODEX_CLI_PATH`，遠程模式設置 `TEEHO_CODEX_MODE=remote`、遠程地址與權杖 |

模型名稱按實際可用服務填寫，需滿足倉庫 Provider 的圖片理解與結構化輸出要求。使用本機 Codex 時，應在**執行服務的系統帳號**下完成安裝和授權；開發者帳號能執行不代表後臺服務帳號也能執行。所有 Provider 秘密僅保存在服務端。

正式開放使用前，把 `mock` 改為真實 Provider，並完成一次真實圖文診斷。只看到健康檢查成功不能證明模型或資料來源可用。

## 5. 配置前端與本地驗證

編輯 `frontend/.env`：

```dotenv
API_PROXY_TARGET=http://127.0.0.1:9634
VITE_API_BASE_URL=/api
VITE_FRONTEND_PORT=8080
VITE_TEEHO_PWD=replace-with-a-stable-project-specific-public-seed
```

`VITE_TEEHO_PWD` 會進入瀏覽器產物，不是秘密，也不能與服務端密鑰共用；產生本地歷史後保持穩定。`API_PROXY_TARGET` 只用于 Vite 開發代理，正式部署由 Nginx 轉發 `/api/`。

本地驗證時，將後端改為 `NODE_ENV=development`，公開地址和 CORS 使用本地地址，外掛路徑改為原始碼路徑。分別在終端執行：

```bash
bun run dev:server
bun run dev:frontend

# 啟用影片時另開一個終端執行
bun run dev:video-worker
```

訪問 `http://127.0.0.1:8080`。本地與正式環境使用不同的 Supabase 專案，不要使用生產資料做調試。

## 6. 建置與程序托管

建置前恢復第 4 節的正式環境配置，尤其是外掛路徑、公開地址、Provider 和 `DEBUG=false`。

```bash
bun run build
```

關鍵產物為：

| 路徑 | 用途 |
| --- | --- |
| `frontend/dist/` | Nginx 靜態網站根目錄 |
| `server/dist/app.js` | API 入口，包含分析任務和圖片處理 Worker 的裝配 |
| `server/dist/video/video.worker-entry.js` | 獨立影片 Worker |
| `server/dist/plugins/example/` | 已建置的範例外掛及資料 |
| `frontend/dist/downloads/teeho-skill.zip` | Skill 分發所需安裝包 |

保留執行依賴、根 workspace 配置、`server/.env` 及完整產物布局；不要只複製 `app.js`。先用以下命令驗證啟動：

```bash
bun run --cwd server start:release

# 啟用影片時，在另一終端執行
bun run --cwd server start:video-worker:release
```

正式環境可使用 systemd 托管。下面假設原始碼和產物位于 `/srv/teeho`，已創建具備所需目錄權限的 `teeho` 系統帳號，Bun 已安裝到 `/usr/local/bin/bun`；請按實際路徑調整。

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

影片 Worker 使用獨立的 `teeho-video-worker.service`，復用上述配置，將 `Description` 改為 `Teeho Video Worker`，`ExecStart` 改為 `/usr/local/bin/bun run start:video-worker:release`。確保該帳號可讀取配置、外掛和素材臨時目錄，並能執行 FFmpeg 和配置的 Agent 程序。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teeho-api
sudo systemctl enable --now teeho-video-worker  # 僅啟用影片時
sudo journalctl -u teeho-api -n 100 --no-pager
```

## 7. 配置 Nginx 與 HTTPS

以下配置假設證書已經簽發，網站和 API 使用同一域名。替換域名、證書位置和部署目錄後再加載：

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

`proxy_pass` 不附加末尾斜杠，以保留 `/api/` 路徑。關閉代理緩沖用于工作臺事件流。對外只開放網站所需端口，API 端口留給本機代理訪問。

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://notes.example.com/api/health
```

## 8. 上線檢查

- 健康接口返回 `code: 0`；直接打開並刷新 `/login`、`/workspace` 等路由正常。
- 郵箱注冊、確認和登入正常；選用 Google 登入時驗證完整跳轉。
- 圖片可以上傳，一次真實診斷能完成並生成報告；刷新後能從本地歷史重新查看。
- 啟用影片時，確認影片 Worker 日誌、FFmpeg 調用與完整影片診斷均正常。
- 從本站 `/api/skill/download` 下載技能；安裝後確認訪問的是本站，再完成一次診斷。安裝方法見[技能安裝說明](../skill-install.md)。
- 檢查清理函數和定時任務的實際執行結果；不能只確認任務已注冊。
- 範例外掛輸出不代表真實市場資料。替換資料來源後重新驗證參考內容、評分和不可用資料的處理。

## 9. 更新與常見問題

更新前備份資料庫和環境配置、記錄當前發佈版本。拉取選定版本後安裝鎖定依賴，預覽並應用新增遷移，再建置、切換產物並重啟服務；保留穩定密鑰、前端混淆種子和完整外掛配置。資料庫回退不能簡單等同于切回舊原始碼。

Skill 安裝包與後端同時更新；下載服務會快取安裝包，發佈後需要重啟。提高技能最低兼容版本前，先確認新包已可下載。

| 現象 | 優先檢查 |
| --- | --- |
| Nginx 返回 502 | API 程序、監聽端口、服務日誌及外掛配置路徑 |
| 登入反復失效 | HTTPS、公開地址、CORS、Cookie，以及 Auth URL 配置是否一致 |
| 登入後頁面不實時更新 | 是否錯誤使用 Transaction pooler、事件流是否被代理緩沖 |
| Skill 連接到了其他站點 | `PUBLIC_API_URL`、本站下載入口、下載服務是否已重啟 |
| 能健康檢查但不能分析 | Provider 配置及權限、實際資料來源、任務日誌；`mock` 不是實際模型 |
| 影片一直處理中 | 獨立 Worker 是否啟動、FFmpeg/ffprobe 是否可執行 |
| 素材沒有按期清理 | Vault 名稱與函數秘密是否一致、函數響應及 cron 執行日誌 |
| 歷史報告在另一設備不可見 | 歷史保存在當前瀏覽器或 Skill 本機，不提供跨設備同步 |
