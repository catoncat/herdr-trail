# AGENTS.md — herdr-trail

> 交接文档。目标：任何新会话的 agent 读完本文件 + `docs/prd.md` 即可直接开工，无需重新调研。

## 项目一句话

herdr 插件：**herd 全局共享 todolist**。agent 在对话中随手记/随手列；人在 herdr overlay 统一管理；每条记录自带溯源（哪个 agent/pane/pi 会话），一键跳回源对话（活着 focus，已关闭用 `pi --session` resume)。

## 已拍板决策（2026-08-17)

| # | 决策 | 结论 |
|---|------|------|
| Q1 | 命名 | `herdr-trail`，plugin id `envvar.herd-trail`（社区已有两个 `herdr-todo`，避开） |
| Q2 | 形态 | GitHub 仓库结构（README/LICENSE/manifest 齐全），开发期 `herdr plugin link` |
| Q3 | pi 工具 | **P0**。model-visible 工具 `trail_add`/`trail_list`，薄封装 CLI；CLI 是唯一事实源 |
| Q4 | 提醒功能 | **砍掉**。单一职责，不加 `--due` 字段 |
| Q5 | resume 落点 | 当前 workspace 新开 tab，不动现有布局 |
| Q6 | 数据位置 | `herdr plugin config-dir envvar.herd-trail`（插件未注册时 fallback `~/.local/share/herd-trail`) |

## 已验证的 herdr 事实（0.8.0,`~/.local/bin/herdr`)

**插件机制**
- manifest = 仓库根的 `herdr-plugin.toml`；支持 `[[build]]`（仅 install 时跑）、`[[actions]]`(id/title/contexts=["workspace"]/command 数组）、`[[panes]]`(id/title/placement/command)
- pane placement:`overlay | popup | split | tab | zoomed`；命令行可覆盖：`herdr plugin pane open --plugin ID --entrypoint ID [--placement ...] [--width --height ...]`
- 插件进程注入 env:`HERDR_BIN_PATH` `HERDR_PLUGIN_ID` `HERDR_PLUGIN_ENTRYPOINT_ID` `HERDR_PLUGIN_CONTEXT_JSON` `HERDR_PLUGIN_CONFIG_DIR` `HERDR_PLUGIN_STATE_DIR` `HERDR_SOCKET_PATH` `HERDR_PANE_ID`
- command 数组用相对路径时，cwd = plugin_root
- CLI:`herdr plugin install OWNER/REPO[/SUBDIR]` / `link <path>` / `unlink` / `enable` / `disable` / `list` / `config-dir <PLUGIN_ID>` / `action invoke <ACTION_ID>` / `log` / `pane open|focus|close`
- **overlay 关闭时会恢复打开前的布局** → 布局变更类操作（开新 tab/pane）必须在 overlay 关闭后执行。参考 pane-mover 的 `--exec` 延迟模式：overlay 退出前 spawn 一个 detached 进程，延时 400ms 再执行 herdr 命令
- `herdr notification show <TITLE> [--body --position --sound none|done|request]`（本项目砍掉了提醒，但 API 在这）
- 注册表：`~/.config/herdr/plugins.json`；github 来源插件装到 `~/.config/herdr/plugins/github/<id>-<hash>/`

**焦点/跳转**
- `herdr pane current` 在 agent pane 内返回 JSON:`{ result: { pane: { pane_id, tab_id, workspace_id, cwd, agent, agent_session: { value: <session 文件路径> }, ... } } }`（已实测）
- ⚠️ `herdr pane focus` 只支持 `--direction left|right|up|down`（邻居焦点）,**任意 pane 焦点需另找路**：候选 `herdr tab focus` + socket API(`herdr api schema` 查 FocusPane)。**这是开工第一个待验证项**
- `herdr tab create` / `herdr tab focus` / `herdr agent start <NAME> --kind pi --pane <ID> -- <args...>`(pane 需停在 shell 提示符）

## 已验证的 pi 事实

- agent pane 内 env:`PI_SESSION_ID`、`PI_SESSION_FILE`（完整路径）、`HERDR_PANE_ID`、`HERDR_WORKSPACE_ID`、`HERDR_TAB_ID` —— **溯源字段 add 时零参数自动捕获**
- resume:`pi --session <path|partial-uuid>`；分叉用 `--fork`。session 文件在 `~/.pi/agent/sessions/<project-slug>/`
- 本地扩展目录 `~/.pi/agent/extensions/*.ts` 自动被发现（用户已有一堆 .ts 在用）
- pi 工具注册 API **未验证** → 参考 `~/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/`（已装的 npm 扩展）或 GitHub `leset0ng/pi-todo-herdr`,pi 官方文档在 `~/.local/share/fnm/.../pi-coding-agent/docs/extensions.md`

## 竞品参考（各自抄什么）

| 仓库 | 抄什么 |
|------|--------|
| `rohanthewiz/herdr-todo` | pane 跳转 + "drop 后 focus 目标 pane" 的具体 herdr API 调用序列（Go) |
| `jasonrr/herdr-tally` | store 原子写（tmp+rename)+ 改动前重读 + 多端 2s mtime 轮询同步 |
| `leset0ng/pi-todo-herdr` | pi 扩展工具包范式（npm 形态、tool 定义、会话持久化） |
| `osamahbeig/pane-mover`（本机 `~/.config/herdr/plugins/github/...` 有源码） | 零依赖 node 裸 ANSI overlay、`--exec` 延迟执行模式 |

## 工程约定

- **零依赖 node**(≥18,社区惯例；插件进程直接用 herdr 注入的 env)
- store：单 JSON 文件；写路径 = mkdir 锁（50ms 退避，5s 超时，30s stale 回收）→ 重读 → mutate → tmp+rename
- todo id：短 id(`t-` + 4 位 base36，冲突重摇）
- commit:`<type>(scope): <summary>`，中文动词开头，<50 字，无句号，原子提交
- 输出偏好：竖向布局图表；回复不超过一屏

## 验证配方

```bash
herdr plugin link ~/src/herdr-trail        # 注册
herdr plugin list                          # 确认 enabled
herdr plugin action invoke open --plugin envvar.herd-trail   # 开 overlay(语法待验证)
bin/herd-trail add "测试条目"               # 在本 pane 跑,list 应带溯源
herdr plugin pane open --plugin envvar.herd-trail --entrypoint list  # 直接开 pane
```

E2E 验收（PRD §验收）：本 pane add 一条 → overlay 可见且显示本 agent 名 → enter 跳回本 pane → 关掉本会话后从 overlay 能 resume 出同一会话。
