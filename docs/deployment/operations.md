# 自部署运维、更新与恢复

本文接续[自部署指南](install.md)，只描述公开社区版。命令使用 Bash，示例服务名为 `teeho-api` 与 `teeho-video-worker`；未启用视频时省略对应进程操作，但已有视频任务和清理尚未完成时仍需运行 Worker。源码核对日期：2026-10-18；没有据此宣称云端部署或恢复演练已完成。

## 1. 日常检查与素材清理

```bash
curl --fail https://notes.example.com/api/health
sudo systemctl status teeho-api --no-pager
sudo journalctl -u teeho-api -n 100 --no-pager
sudo systemctl status teeho-video-worker --no-pager
sudo journalctl -u teeho-video-worker -n 100 --no-pager
```

健康检查不能代替一次实际诊断。检查磁盘空间、日志增长、数据库连接数、Provider 用量和失败任务；进程数增加时重新计算每个进程的连接池与模型并发预算。

| 对象 | 谁负责清理 | 如何判断 |
| --- | --- | --- |
| 图片原图和派生图 | PostgreSQL Cron 调用 `cleanup-analysis-media` Edge Function | 检查 Cron、HTTP 响应、函数日志和图片清理状态 |
| 云端任务和结果记录 | PostgreSQL 的保留清理任务 | 检查 `teeho-analysis-retention-cleanup` 执行记录 |
| 视频原片 | 独立视频 Worker | 终态且无活跃任务保护后认领；看 `original_cleanup_state` 和 Worker 日志 |
| 视频证据清单和帧 | 独立视频 Worker | 到期且无活跃任务或恢复会话保护后认领；看 `cleanup_state` 和日志 |
| 浏览器、Skill 本机历史及原素材 | 用户本机管理 | 云端清理不等于清理本机文件；历史也不包含原素材备份 |

当前视频证据保留期为生成后 24 小时；原片不采用同一保留期限，达到可清理终态后即可删除。原片失败重试间隔为 1 分钟，证据清理失败重试间隔为 15 分钟，两者最多认领 5 次。截止时间表示可进入清理，不保证在那个时刻立即删除；租约、任务保护、队列负载和进程停机都会影响执行。具体规则见[常量](../../server/src/config/constants.ts)、[认领条件](../../server/src/video/video.worker.repository.ts)和 [Worker](../../server/src/video/video.worker.ts)。

在目标项目 SQL Editor 中可执行以下只读检查，结果不含原片路径或用户正文：

```sql
SELECT jobname, schedule, active
FROM cron.job WHERE jobname LIKE 'teeho-%';

SELECT job.jobname, run.status, run.start_time, run.end_time
FROM cron.job_run_details AS run
JOIN cron.job AS job ON job.jobid = run.jobid
WHERE job.jobname LIKE 'teeho-%'
ORDER BY run.start_time DESC LIMIT 20;

SELECT original_cleanup_state, count(*)
FROM public.analysis_video_assets
GROUP BY original_cleanup_state;

SELECT cleanup_state, count(*)
FROM public.analysis_video_evidence_packages
WHERE expires_at <= now()
GROUP BY cleanup_state;
```

图片清理的定时 SQL 成功只说明请求已发出，还需检查异步 HTTP 是否成功。按安装指南手动触发得到请求编号后，在另一次查询中把 `123` 替换成该编号：

```sql
SELECT id, status_code, timed_out, created
FROM net._http_response WHERE id = 123;
```

无结果时稍后再查，并结合 Edge Function 日志；响应记录也有保留期限。视频侧关注 `video_original_cleanup_failed`、`video_evidence_cleanup_failed`，与成功事件 `video_original_cleanup_completed`、`video_evidence_cleanup_completed`。

恢复顺序：先修复网络、权限、函数秘密或 Worker 停机问题，再观察下一个重试窗口。达到重试上限的记录不会因重启自动清零；保留记录 ID、状态和安全错误码，按对应版本的租约与任务保护逻辑制定定向恢复方案。当前指南没有可直接套用的批量重试 SQL；不要重置所有计数、直接删除 Storage 元数据或绕过活跃任务保护。

## 2. 更新前保留什么

| 内容 | 保存方式与恢复注意事项 |
| --- | --- |
| 应用版本 | Tag/Commit、Bun 版本、锁文件、完整旧构建目录及运行依赖 |
| 配置与秘密 | 后端 `.env`、稳定的 `TEEHO_PWD`、前端构建环境、Provider 凭据；受限权限、离机保管 |
| 自定义插件 | 配置包、数据文件及其版本、额外依赖与构建步骤 |
| 数据库 | 更新前可用备份/恢复点、目标 project ref、迁移列表；提前在隔离环境演练恢复 |
| Storage | 需要保留的对象及对应元数据；应用会按保留策略自动清理 |
| 部署配置 | systemd unit、Nginx 配置、证书续期方式、Edge Function 配置与 Vault/Secrets 对应关系 |

**数据库备份不包含 Storage 文件内容**，恢复旧数据库不能找回已被删除的对象。按实际套餐与恢复目标选择 [Supabase 官方备份方案](https://supabase.com/docs/guides/platform/backups)，不要把单份数据库导出称作全站备份。云端备份也不能恢复用户浏览器或 Skill 的本机历史。

不要把备份放在 Nginx 静态目录、公开仓库或普通日志里。新旧版本保持服务端秘密和前端混淆种子稳定，否则旧数据可能无法读取。

## 3. 为后续发布使用版本目录

首次固定目录部署可继续工作；要可靠回滚，后续采用独立版本目录。例如：

```text
/srv/teeho/
  releases/
    release-a/          # 完整旧仓库、依赖、构建和该版配置
    release-b/          # 完整新仓库、依赖、构建和该版配置
  current -> releases/release-a
```

先将当前运行版本的完整副本放到 `release-a`，验证副本没有缺少依赖或配置。在停机窗口内，创建 `current` 链接，并把两个 systemd unit 的 `WorkingDirectory` 改为 `/srv/teeho/current/server`，把 Nginx 的 `root` 改为 `/srv/teeho/current/frontend/dist`。`ExecStart` 继续使用安装指南中的命令。初次改布局后执行 `systemctl daemon-reload`、`nginx -t` 和 reload，再启动服务验证；不要把仍在使用的原目录直接移动或删除。

下面的链接切换命令只适用于这个布局：`current` 必须是符号链接，不能是实际目录；切换前确认目标版本存在且 `current.next` 尚不存在。旧目录保留到新版本验收并经过既定观察期之后。

## 4. 发布顺序

1. 在新的 `release-b` 目录获取选定 Tag/Commit，放入受保护的该环境配置，执行 `bun install --frozen-lockfile`、相关验证与 `bun run build`。自定义插件按[定制实操](customization.md)在主构建后打包。验证完整制品；不在当前服务目录重新构建。
2. 在测试 Supabase 项目验证新版本；不要为检查能否启动而启动连接生产库的第二套 API/Worker，因为它们会处理真实队列。
3. 记录并核对正式项目、迁移差异和恢复点。安排停机窗口，通过入口代理暂时返回维护响应，阻止新请求；等待在途任务完成或按应用支持的操作取消。社区版没有私有产品的管理员维护流程可直接复用。
4. 停止 Worker 和 API，检查停止日志。执行 `stop` 不意味着所有业务任务已完成，应在停机前后核对原任务状态。

   ```bash
   sudo systemctl stop teeho-video-worker
   sudo systemctl stop teeho-api
   ```

5. 在新版本仓库根目录核对目标，再执行待应用迁移；预览与实际执行分开，逐条确认预览只包含本次计划：

   ```bash
   bunx supabase link --project-ref <production-project-ref>
   bunx supabase migration list
   bunx supabase db push --dry-run
   # 确认目标、备份与预览后执行
   bunx supabase db push
   bunx supabase migration list
   ```

   需要更新清理函数时，使用该版本函数及安装指南中的 `--project-ref`、`--use-api` 部署；保留并核对 Vault/Secrets。数据库历史不一致时停止，不用 `repair` 伪造已应用状态。

6. 检查新目录中的插件、配置和前端静态文件后切换链接：

   ```bash
   readlink -f /srv/teeho/current
   test -L /srv/teeho/current
   test -d /srv/teeho/releases/release-b/server/dist
   # 确认上述检查成功，且 current.next 不存在后执行
   sudo ln -s /srv/teeho/releases/release-b /srv/teeho/current.next
   sudo mv -Tf /srv/teeho/current.next /srv/teeho/current
   sudo systemctl start teeho-api
   sudo systemctl start teeho-video-worker
   ```

7. 在仍限制公共访问的情况下检查本机健康接口、日志和测试账号诊断；允许验收所需访问，不提前全面开放。Nginx/unit 配置有修改时分别检查并 reload/daemon-reload。
8. 按主指南第 8 节验收并恢复入口访问。从本站重新下载 Skill，核对版本与 `endpoint.json`，通知用户更新安装。记录应用、数据库、函数各自的实际版本和验收结果。

## 5. 失败时如何恢复

**没有改变数据库，或已验证旧应用兼容新 schema**：保持维护入口，停止进程，将 `current` 切回完整旧目录，启动旧服务并复验。沿用第 4 节相同的 `current.next` 切换方式，将目标改为 `release-a`；同时恢复该版插件、匹配的前端及必要的部署配置。不要只退回一个 JS 文件。

**迁移后旧应用不兼容，或出现数据损坏**：继续维护，保留失败现场，优先评估前向修复；需要恢复数据库时，先确定恢复点、可能丢失的新数据、Storage 对象对应关系以及 Auth/函数配置，再执行已演练的恢复方案。不要通过删除迁移记录、反向运行任意 SQL 或远程 `db reset` 代替恢复。备份恢复是独立操作，不随应用符号链接回滚自动发生。

恢复后核对原任务状态，结果未知的任务先查询，不自动批量重新提交。只有登录、素材处理、报告、Skill 和清理链路重新验收通过后，再恢复全面访问。
