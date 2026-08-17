# herdr-trail PRD

- 版本：v0.1(2026-08-17)
- 状态：已评审，待实现
- 决策记录：见 `../AGENTS.md` §已拍板决策

## 1. 定位

herd 全局共享 todolist。解决的真实问题：agent 干完活留下"善后事项/后续跟进"，散落在各会话记录里随滚动消失；人需要"哪个 agent 记的、当时它在干嘛"的上下文，甚至想直接回到那个对话继续。

**一句话**:agent 随手记，人统一看，每条都能跳回源头。

### 非目标（v0 明确不做）

- 定时提醒/通知（砍。已验证 launchd watcher 可行，以后想要再加）
- 项目级 backlog(tally、rohanthewiz/herdr-todo 已覆盖；我们只做 herd 全局级）
- 优先级/标签/阻塞关系等重度任务管理字段
- MCP(tally 的 38-tool 路线过重；我们用 pi 本地工具 + CLI)

## 2. 用户故事

- US-1【agent 记】我是 herd 里的 agent（人也是）。发现需要人后续处理的事（如"m1 恢复后清理容器")，调 `trail_add` 工具或 `herd-trail add "…"` 记入全局清单，溯源自动落库，不中断当前工作。
- US-2【对话内列】我在对话中跑 `trail_list` / `herd-trail list`，看清单现状，避免重复记录。
- US-3【人看全局】我在 herdr 里一个按键打开 overlay，看到全 herd 的 open/done 清单，每条标着来源 agent 和项目。
- US-4【跳回源头】我对某条按 enter:pane 还活着 → 焦点跳过去；已关闭 → 用落库的 session 文件 resume 出新会话（当前 workspace 新 tab)。我能直接在那个对话上下文里追问。
- US-5【闭环】事办完了，人（overlay 按 d）或 agent(`herd-trail done <id>`）标记完成；done 沉底不删，可 `x` 删除。

## 3. 数据模型

单文件 JSON:`$(herdr plugin config-dir envvar.herd-trail)/todos.json`,fallback `~/.local/share/herd-trail/todos.json`。

```jsonc
{
  "version": 1,
  "todos": [
    {
      "id": "t-a3f9",               // 短 id,add 时生成
      "text": "m1 恢复后清理 pi-fence 容器",   // 单行,必填
      "status": "open",              // open | done
      "created_at": "2026-08-17T04:30:00.000Z",
      "done_at": null,
      "source": {                    // add 时从 env 自动捕获;人手动记则 agent 字段为 null
        "kind": "pi",                // pane.agent 如实记:pi | grok | ...;herdr 外/无 agent shell = human-shell
        "agent_name": "pi-startup-fix",   // herdr pane 名(可能为 null)
        "pane_id": "w2Q:pC",
        "workspace_id": "w2Q",
        "tab_id": "w2Q:t5",
        "cwd": "/Users/envvar/.pi",
        "pi_session_id": "01a00df9-…",    // 实测无 PI_SESSION_ID env;由 herdr pane get 的 agent_session 解析
        "pi_session_file": "/Users/envvar/.pi/agent/sessions/…/….jsonl"
      }
    }
  ]
}
```

并发：多 agent pane 同时写是真实场景。mkdir 锁 + 写前重读 + tmp/rename 原子落盘；损坏时自动备份（`todos.json.corrupt-<ts>`）并从空表重建。

## 4. 功能需求

| # | 需求 | 形态 | 优先级 | 验收 |
|---|------|------|--------|------|
| T1 | 记录 | CLI `herd-trail add "文本"`，溯源零参数自动捕获；herdr 外运行记 `kind:"human-shell"` | P0 | 在 agent pane 内 add,`show` 显示 pane/cwd/session 全字段 |
| T2 | 对话内列出 | `herd-trail list [--all] [--json]`，默认只显示 open，紧凑单行 | P0 | agent 可解析；10 条内一屏 |
| T3 | agent 技能包 | `skills/herd-trail/SKILL.md`：何时记（留给人善后/跨会话跟进/阻塞）、何时不记（会话内可完成的）、一条一事、文本要带上下文 | P0 | 装入 `~/.pi/agent/skills/` 后新会话能正确使用 |
| T4 | pi 工具 | 本地扩展 `pi/herd-trail-tools.ts`(model-visible):`trail_add{text}` `trail_list{all?}`，薄封装 CLI | P0 | `/reload` 后工具出现；add 后 CLI 可见 |
| T5 | herdr overlay 全局列表 | placement=overlay;open 在前按 created 倒序，done 灰显沉底；列：id/状态/文本/来源 agent/项目/年龄；键：j/k、enter 跳源、d done 切换、x 删（确认）、a 新建（底部行输入）、r 刷新、q/esc 退出；2s mtime 轮询自动刷新 | P0 | 见 §6 E2E |
| T6 | 跳回源对话 | CLI `herd-trail open <id>` + overlay enter。pane 活 → focus；死 → `tab create` + `agent start … -- pi --session <file>`。布局变更走 `--exec` 延迟模式（overlay 关后执行） | P0 | 两种路径各验一次 |
| T7 | 完成/删除 | CLI `done/undo/rm <id>` + overlay d/x | P0 | — |
| T8 | 筛选 | `list --agent X --project Y`;overlay `/` 过滤 | P2 | — |
| T9 | 发布 | `herdr plugin install envvar/herdr-trail` 可走通（含 marketplace 的 manifest 字段完整性） | P2 | 干净机器装得上 |

## 5. UX 关键流

**overlay 打开**:`herdr plugin action invoke open`（绑定到用户按键，README 给出 config.toml keybinding 示例）。

**跳源（T6）细节**:
- 活 pane 判定：`herdr pane get <pane_id>` 成功且 agent 仍在跑。
- 活 → focus。⚠️ `herdr pane focus` 仅支持方向键模式；任意 pane 焦点路径待验证（`herdr tab focus` + socket API，见 AGENTS.md)。
- 死 → 当前 workspace 新 tab:`herdr tab create` → `herdr agent start <name> --kind pi --pane <new> -- --session <file>`（确切参数序列参考 rohanthewiz/herdr-todo 源码，README 称其解决了同类问题）。
- session 文件丢失（被清理）→ 报错并提示 cwd，退化行为：新 tab 在该 cwd 起裸 pi。

## 6. 验收（E2E)

1. agent pane 里 `trail_add "测试:给 m1 清容器"` → `herd-trail list` 输出该条，来源 = 当前 agent。
2. 人开 overlay → 看到该条，按 enter → 焦点落到该 agent pane。
3. 退出该 agent 会话 → overlay 再按 enter → 新 tab 里 resume 出同一 session（历史完整）。
4. 两个 pane 同时 add 20 条 → 无丢条、id 无重复、文件不损坏。
5. herdr 重启 → 清单完好。

## 7. 里程碑

- **M1 数据层+CLI**:store/锁 + T1/T2/T7，纯 CLI 全过验收 1、4
- **M2 agent 面**:T4 工具 + T3 skill，验收 1 走 tool 路径
- **M3 overlay**:T5+T6，验收 2、3、5
- **M4 打磨**:README/GIF、keybinding 示例、P2 项视需要

## 8. 风险与开放问题

- **任意 pane focus 的 API 路径未验证**（最高优先，阻塞 T6 活 pane 分支）。
- overlay 裸 ANSI 渲染在超窄 pane 的截断行为 —— 参考 pane-mover 的处理。
- pi session 文件被 `pi --no-session` 或清理策略删掉后的 resume 退化路径（§5 已定退化行为，需测）。
- `herdr plugin action invoke` 是否支持透传参数（影响 action 能否带参；v0 不依赖）。
