# 题火 Skill 开发维护

Agent 的日常调用协议集中在 [SKILL.md](SKILL.md)，[卸载](references/uninstall.md)单独维护，安装与升级说明在网站 `/skill-install.md`。

## 版本与发布

本目录是题火 Skill 的唯一源码，运行资源位于 `resources/`，无需同步或构建即可复制安装。版本身份与最低兼容版本统一维护在 `release.json`；`SKILL.md` 的 `metadata.version` 必须一致，打包时校验。

从 `2.1.0` 开始使用“大改动.功能.补丁”：BUG 修复递增补丁，功能增删改递增功能位，重大调整递增首位。普通算法、评分系数或可选展示字段更新不提高最低兼容版本；真正无法兼容时才提高 `minimumVersion`，必要的补丁也可成为最低版本。

每个业务 API 请求由 `api.py` 自动携带 `X-Teeho-Skill-Version`。服务端返回 HTTP 400、业务 `code=4260`、`data.reason=skill_upgrade_required`，并提供最低/最新版本和本站下载路径；旧 `1.14.1` 只能显示既有固定参数错误提示。新工具优先识别该码，输出 `state=upgrade_required` 和 `nextAction=upgrade_skill`。缺失或非法版本同样拦截；真实身份仍须独立验证。网页 Cookie 请求不受技能版本门槛影响。

`GET /api/skill/version` 与 `/api/skill/download` 始终可访问。开始授权、匿名创建、续期及已鉴权业务调用均检查版本；退出、浏览器审批和撤销入口不拦截。普通网络失败不转换成升级错误。升级只替换安装文件，已提交任务继续执行，本机身份、历史和待恢复记录保持原样。

发布时先验证新包可以下载，再启用更高最低版本；后端发布包和静态技能包一并核验。网站版本与技能版本独立，下载后端缓存随重启更新。

在本目录运行独立单元测试（仅需 Python）：

```sh
python -B -S -X utf8 -m unittest discover -s tests
```

完整题火开发仓库中的路径为 `_github/skills/teeho/`。维护者在完整仓库根目录发布前运行：

```sh
bun run test:skill
bun test _github/tools/release/package-skill.test.ts
bun run package:skill
```

安装说明正文只维护完整仓库中的 `_github/docs/skill-install.md`（公开仓库中的 `docs/skill-install.md`）。`bun run package:skill` 更新其发布标记，并将完整文档生成到 `frontend/public/skill-install.md`；网站副本和发布标记不手改。网站与 localhost 使用同源 `/api/skill/download`，GitHub 使用文档版本对应的 Release 附件。新增 GitHub 渠道保留现有网站和本地安装入口。

打包使用 Python 3.9+ 标准库 `zipfile`（Deflate），同时生成 `frontend/public/downloads/teeho-skill.zip` 和 `frontend/src/config/skill-release.generated.json`。构建环境可通过 `TEEHO_PYTHON` 指定 Python，无需安装 pip 包。下载后端通过 Bun 内置 CRC32 和 Node 内置 zlib 重写本站配置并缓存 ZIP，不要求线上服务器安装 Python；更新后需重启。仓库修改不会自动同步到用户已安装的副本。

打包清单在 `tools/release/package-skill.ts`：显式文档、`endpoint.json` 和递归收集的 Python 源码；排除测试、缓存、字节码、链接和用户数据。增删参考文件时同步清单及安装校验，归档链接由打包测试检查。

## 运行与模块

报告解析严格检查任务身份、最终主分的基本类型与 0～10 范围、必要总结及链接安全。技能不复算分数，不要求 `schemaVersion` 或 `scorePolicy` 完全匹配；可选字段局部损坏时保留其他有效内容，未知来源使用通用标签。`report_optional_field_skipped` 记录字段路径，`report_core_invalid` 记录核心报告错误，均不记录报告原文。

用户运行时只需 Python 3.9+ 标准库；开发和测试由根 Bun 脚本编排。`test:skill` 使用标准库 unittest，Python 由 `tools/release/python-runtime.ts` 选择，也可通过 `TEEHO_PYTHON` 指定可执行文件路径。

`tools/teeho.py` 是统一入口，`tools/teeho_skill/` 是随包分发的实现：

- `constants.py`：接口路径；`api.py`：请求与响应校验；`http_transport.py`：网络传输。
- 身份、诊断、素材、历史按模块编排；展示模板只在程序中维护，操作说明不复制模板。
- `help_content.py`：六项公开功能和单项用法的唯一目录；总览、登录结果及旧帮助快照共用固定编号，帮助查询仅接受目录内的主题。
- `render` 从本机快照回填译文，不请求业务接口；日常展示遵循入口中的统一输出流程。

## 配置与数据

下载服务生成 `endpoint.json`，工具相对安装位置读取；开发可用 `TEEHO_API_URL` 覆盖。服务仅允许 HTTPS 或本机回环 HTTP。`TEEHO_HOME` 可替代默认数据根 `~/.teeho`。

数据按服务地址摘要及账号隔离，同一服务和账号跨客户端共享；公共帮助和安装说明使用 `presentations/public/`，账号快照保存在各自命名空间。正式登录后的展示快照归新身份，供下一进程渲染。

数据目录独立于源码和安装目录，更新技能保留既有数据。凭据独立保存且不返回 Agent；历史只保存完整报告及本次采用的封面、图片和视频原始位置字符串，不复制素材；素材移动或删除后位置不会自动更新，清理历史也不会删除原素材。旧版已保存的封面副本仍兼容读取和清理。测试使用临时数据与本地服务，不读取真实凭据。

## 调试

本机回环服务默认开启调试，正式站关闭；下载配置的 `debug` 可控制开关。调试输出写入 stderr 和服务数据目录 `logs/`，stdout 始终为业务 JSON 信封。

按 `runId` 查 `command_started → request_started → response_headers_received → api_response_parsed → output_rendered → command_finished`。响应头到达不代表 JSON 已读完；任务恢复看 `task_resume_checked`，状态变化看 `task_status_changed`，保存失败看 `report_save_failed`。

`scripts_loaded` 的源码摘要用于核对运行版本；代码更新但安装副本未变化时，重新打包、重启下载后端并更新安装。日志不记录凭据、授权码、完整笔记或原始敏感响应；日志写入失败不影响业务，调试信息不转发给用户。
