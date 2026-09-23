# Teeho self-hosting guide

This guide explains how to deploy the Teeho website, API, and video processing service from source. The default setup is **Linux + Bun + Nginx + a dedicated Supabase cloud project**.

All relative paths and commands below start at the root of the published repository: the directory containing `frontend/`, `server/`, `plugins/`, and `supabase/`. In a development repository that contains `_github/`, run `cd _github` first. Do not mix in configuration, build commands, or database migrations from the parent directory.

## 1. Components and prerequisites

The source includes note input, image and video processing, Agent analysis, report presentation, user authentication, and Teeho Skill integration. By default, it uses synthetic data and sample algorithms from the example plugin. It does not include the hosted service's collected data, private Insight Model, credits, subscriptions, or payment system.

The default overall score is the average of the six dimensions. Simply enabling the model switch or importing vector tables does not provide the hosted service's insight prediction or semantic retrieval integration. To use real data, connect your own data sources and algorithms using the [plugin guide](../../plugins/example/README.md).

Prepare the following dependencies:

| Dependency | Purpose |
| --- | --- |
| Git and Bun | Fetch the source, install dependencies, build, and run; use the Bun version specified by `packageManager` in the root `package.json` |
| Python 3.9+ | Build the Skill package using only the standard library; the API does not need Python when running prebuilt artifacts |
| FFmpeg and ffprobe | Required when video is enabled; both commands must be available on the video process's `PATH` |
| Nginx, a domain, and an HTTPS certificate | Serve the frontend's static files and proxy `/api/` to the backend |
| A Supabase project | Provide PostgreSQL, Auth, Storage, scheduled jobs, and the cleanup function |
| An Agent service | The default `mock` provider only verifies the workflow; real analysis requires a real provider |

Do not apply these migrations directly to a database that already hosts other applications. Prepare a dedicated project and maintain separate testing and production environments.

## 2. Get the source and install dependencies

```bash
git clone https://github.com/mingzhizhiren/teeho.git
cd teeho

# For production, check out your chosen release tag before installing dependencies.
git checkout <release-tag>
bun install --frozen-lockfile

cp server/.env.example server/.env
cp frontend/.env.example frontend/.env
```

`<release-tag>` is a placeholder you must replace. You can use the current branch for development testing; record the actual tag or commit used for production.

## 3. Initialize Supabase

### 3.1 Database migrations

The following commands use the Supabase CLI included in this repository's dependencies. Sign in and link **the project for this deployment**, review the preview, and only then apply the migrations:

```bash
bunx supabase login
bunx supabase link --project-ref <project-ref>
bunx supabase migration list
bunx supabase db push --dry-run
bunx supabase db push
```

Use only `supabase/migrations/` in the current directory. These migrations include diagnosis and video tables, constraints, private media buckets, and cleanup jobs. You do not need to create business tables manually or make media buckets public. When upgrading an existing deployment, review pending migrations first; do not reinitialize the database or run `db reset`.

For command details, see the [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push).

### 3.2 Authentication settings

In Supabase Auth's URL Configuration, set:

- Site URL: your production website address, such as `https://notes.example.com`.
- Redirect URLs: add the website addresses you actually use. If Google sign-in is enabled, add `https://notes.example.com/api/auth/google/callback`.
- For local debugging, also add the corresponding `http://127.0.0.1:8080` and backend callback address. Keep hostnames consistent.

If email confirmation is enabled, configure and verify SMTP delivery; new users must confirm their email before signing in. Google sign-in is optional. Enable the provider in Supabase and configure the OAuth application as required. Supabase Anonymous Sign-ins does not need to be enabled for the Skill's anonymous identity creation flow.

### 3.3 Image cleanup

The migrations register scheduled cleanup jobs, but you must also deploy the `cleanup-analysis-media` function and supply its credentials.

1. Generate a random secret of at least 32 characters and set `TEEHO_MEDIA_CLEANUP_SECRET` in Supabase Edge Function Secrets.
2. Create these two entries in Supabase Vault:

   | Name | Value |
   | --- | --- |
   | `teeho_project_url` | This project's Supabase URL, such as `https://<project-ref>.supabase.co` |
   | `teeho_media_cleanup_secret` | Exactly the same secret as the function's `TEEHO_MEDIA_CLEANUP_SECRET` |

3. Deploy the function:

   ```bash
   bunx supabase functions deploy cleanup-analysis-media --project-ref <project-ref>
   ```

The repository's `supabase/config.toml` sets `verify_jwt = false` for this function. The function validates `x-teeho-cron-secret` itself; this does not allow anonymous cleanup. The hosted environment supplies the function's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put these server-side credentials in the frontend.

After deployment, check the jobs and invocation results in the SQL Editor:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'teeho-%';

SELECT public.invoke_analysis_media_cleanup();
```

The last call only returns an asynchronous HTTP request ID. Check the Edge Function logs and `net._http_response` to confirm a successful response. Scheduled jobs use the database's scheduling time zone; do not interpret schedule expressions as the server's local time.

This function currently handles images in `analysis-media`. Review your deployment's retention and cleanup policy for objects in `analysis-video` separately. Delete storage objects through the Storage API, not by directly deleting `storage.objects` rows. Cloud tasks and results have short-term retention rules; browser and Skill history are not permanent cloud backups.

## 4. Configure the backend

Edit `server/.env`. The field descriptions in that file are the complete configuration reference. For a same-domain deployment, the key settings are:

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

- Get `DATABASE_DIRECT_URL` from Supabase's Connect page. Use a direct connection when IPv6 is available; for IPv4-only environments, use the **Session pooler on port 5432**. Workspace events require a persistent `LISTEN` connection; do not use the Transaction pooler on port 6543.
- Replace `TEEHO_PWD` with your own stable secret. Do not change it casually after encrypted data exists. URL-encode special characters in database passwords according to connection-string rules.
- The `TEEHO_PLUGIN_CONFIG` value above is for built artifacts. When running development source, use `../plugins/example/config.ts`. Both paths are relative to the `server/` working directory.
- `VIDEO_ENABLED=false` disables new video uploads without interrupting videos already accepted. Run the video Worker whenever video is enabled.
- Leave the backend certificate fields empty when Nginx terminates TLS. `PUBLIC_API_URL` must be reachable by clients, not an internal container hostname; Skill downloads also use it to generate their API address.
- The API and video Worker each create their own database connection pool. Plan `DATABASE_POOL_MAX` and your database connection allowance across all processes.

### Configure a real Agent

| `TEEHO_AGENT_PROVIDER` | Required configuration |
| --- | --- |
| `mock` | Leave `TEEHO_AGENT_MODEL` empty; use only to verify deployment |
| `openai` | `TEEHO_AGENT_MODEL`, `OPENAI_API_KEY` |
| `gemini` | `TEEHO_AGENT_MODEL`, `GEMINI_API_KEY` |
| `codex-cli` | `TEEHO_AGENT_MODEL`; set `TEEHO_CODEX_CLI_PATH` for local mode, or `TEEHO_CODEX_MODE=remote`, the remote address, and token for remote mode |

Choose a model actually available through your service that meets the repository provider's image-understanding and structured-output requirements. For local Codex, install and authorize it under **the system account running the service**. A command working under your developer account does not mean it will work under the service account. Keep all provider secrets on the server.

Before opening the service to users, replace `mock` with a real provider and complete a real image-note diagnosis. A successful health check alone does not prove that the model or data source works.

## 5. Configure the frontend and test locally

Edit `frontend/.env`:

```dotenv
API_PROXY_TARGET=http://127.0.0.1:9634
VITE_API_BASE_URL=/api
VITE_FRONTEND_PORT=8080
VITE_TEEHO_PWD=replace-with-a-stable-project-specific-public-seed
```

`VITE_TEEHO_PWD` is included in browser assets. It is not secret and must not reuse the server secret; keep it stable once local history exists. `API_PROXY_TARGET` is only used by Vite's development proxy. In production, Nginx forwards `/api/`.

For local testing, set the backend to `NODE_ENV=development`, use local public and CORS addresses, and switch the plugin path to the source module. Run these commands in separate terminals:

```bash
bun run dev:server
bun run dev:frontend

# Run in another terminal when video is enabled
bun run dev:video-worker
```

Visit `http://127.0.0.1:8080`. Use different Supabase projects for local and production environments; do not debug with production data.

## 6. Build and manage processes

Before building, restore the production configuration from section 4, especially the plugin path, public address, provider, and `DEBUG=false`.

```bash
bun run build
```

The key artifacts are:

| Path | Purpose |
| --- | --- |
| `frontend/dist/` | Nginx static website root |
| `server/dist/app.js` | API entry point, including analysis-task and image-processing Worker setup |
| `server/dist/video/video.worker-entry.js` | Standalone video Worker |
| `server/dist/plugins/example/` | Built example plugin and data |
| `frontend/dist/downloads/teeho-skill.zip` | Installation archive for Skill distribution |

Keep runtime dependencies, the root workspace configuration, `server/.env`, and the complete artifact layout; do not copy only `app.js`. First verify startup with:

```bash
bun run --cwd server start:release

# Run in another terminal when video is enabled
bun run --cwd server start:video-worker:release
```

You can use systemd in production. The example below assumes the source and artifacts are in `/srv/teeho`, a `teeho` system account exists with the required directory permissions, and Bun is installed at `/usr/local/bin/bun`. Adjust paths for your environment.

`/etc/systemd/system/teeho-api.service`:

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

Use a separate `teeho-video-worker.service` for the video Worker. Reuse the configuration above, change `Description` to `Teeho Video Worker`, and change `ExecStart` to `/usr/local/bin/bun run start:video-worker:release`. Ensure the account can read the configuration, plugins, and temporary media directories, and execute FFmpeg and the configured Agent program.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teeho-api
sudo systemctl enable --now teeho-video-worker  # Only when video is enabled
sudo journalctl -u teeho-api -n 100 --no-pager
```

## 7. Configure Nginx and HTTPS

The following configuration assumes certificates have already been issued and the website and API share a domain. Replace the domain, certificate paths, and deployment directory before loading it:

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

Do not add a trailing slash to `proxy_pass`, so the `/api/` path is preserved. Disable proxy buffering for workspace event streams. Expose only the ports needed by the website; keep the API port accessible only to the local proxy.

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://notes.example.com/api/health
```

## 8. Launch checklist

- The health endpoint returns `code: 0`; opening and refreshing routes such as `/login` and `/workspace` works.
- Email registration, confirmation, and sign-in work. If Google sign-in is enabled, verify the complete redirect flow.
- Images upload successfully and a real diagnosis completes with a report. After refreshing, the report is accessible from local history.
- If video is enabled, verify the video Worker logs, FFmpeg execution, and a complete video diagnosis.
- Download the Skill from this site's `/api/skill/download`. After installation, confirm that it connects to this site and complete a diagnosis. See the [Skill installation guide](../skill-install.md).
- Check actual cleanup function and scheduled-job results; merely registering the jobs is not sufficient.
- Example plugin output does not represent real market data. After replacing the data source, recheck reference content, scores, and handling of unavailable data.

## 9. Updates and troubleshooting

Before updating, back up the database and environment configuration and record the current release. Fetch the chosen version, install locked dependencies, preview and apply new migrations, then build, switch artifacts, and restart services. Preserve stable secrets, the frontend obfuscation seed, and the complete plugin configuration. Rolling back the database is not the same as checking out older source code.

Update the Skill package together with the backend. The download service caches the archive and must be restarted after deployment. Before raising the minimum compatible Skill version, confirm that the new package is downloadable.

| Symptom | Check first |
| --- | --- |
| Nginx returns 502 | API process, listening port, service logs, and plugin configuration path |
| Sign-in repeatedly expires | Consistency of HTTPS, public address, CORS, cookies, and Auth URL settings |
| The page does not update live after sign-in | Accidental use of the Transaction pooler, or proxy buffering of the event stream |
| The Skill connects to another site | `PUBLIC_API_URL`, this site's download endpoint, and whether the download service was restarted |
| Health checks pass but analysis fails | Provider configuration and permissions, the actual data source, and task logs; `mock` is not a real model |
| Video stays in processing | Whether the standalone Worker is running and FFmpeg/ffprobe are executable |
| Media is not cleaned up on schedule | Matching Vault names and function secrets, function responses, and cron execution logs |
| History is unavailable on another device | History is stored in the current browser or on the Skill's local machine; there is no cross-device synchronization |
