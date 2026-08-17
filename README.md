# herdr-trail

Herd-wide shared todo list — a [herdr](https://herdr.dev) plugin. Agents jot follow-ups mid-conversation; humans manage one global list; every entry links back to the conversation that created it.

> 中文:agent 随手记,人统一看,每条都能跳回源头(pane 活着 focus,关了用 pi session resume)。

## Why

Agents finish work and leave "clean this up later" / "follow up when X" notes that scroll away and die with the session. herdr-trail keeps them in one herd-wide list with provenance (which agent, which pane, which pi session), so a human can review everything in one overlay and jump straight back into the originating conversation to act on it.

Non-goals (v0): no reminders/notifications, no per-project backlogs, no priority/label machinery, no MCP.

## Install

```bash
herdr plugin install envvar/herd-trail
# or, while developing:
herdr plugin link /path/to/herdr-trail
```

Requires Node ≥ 18 (the plugin is dependency-free).

## Setup: pi tools + agent skill

```bash
herdr plugin action invoke agent-setup --plugin envvar.herd-trail
```

This installs (idempotently):

- `~/.pi/agent/extensions/herd-trail-tools.ts` — model-visible `trail_add` / `trail_list` tools (thin wrappers over the CLI; the CLI is the single source of truth)
- `~/.pi/agent/skills/herd-trail/SKILL.md` — teaches agents when to record (human follow-ups, cross-session tasks, blockers) and when not to (anything finishable in-session)

`/reload` in pi afterwards.

## Bind a key

```toml
[[keys.command]]
key = "prefix+t"
type = "plugin_action"
command = "envvar.herd-trail.open"
description = "trail: herd-wide todo list"
```

## Use

**In conversation (agent or human):**

```bash
herd-trail add "m1 恢复后 docker rm -f pi-fence-bundle pi-fence-kroki"
herd-trail list [--all] [--json] [--agent X] [--project Y]
herd-trail show <id>          # full provenance
herd-trail done|undo|rm <id>  # id accepts unique prefixes
herd-trail open <id>          # jump back to the source conversation
```

Provenance is captured automatically at add time (herdr pane, cwd, pi session file) — never pass it yourself.

**Overlay (the key above, or `herdr plugin action invoke open --plugin envvar.herd-trail`):**

| key | action |
|-----|--------|
| `j`/`k`/↑/↓ | move |
| `enter` | jump to source: live pane → focus; closed → resume the pi session in a new tab |
| `d` | toggle done (done sinks to the bottom, dimmed) |
| `x` | delete (asks y/n) |
| `a` | add (bottom-line input) |
| `/` | filter |
| `r` | refresh (also auto-refreshes every 2s on change) |
| `q`/esc | close |

## Data

Single JSON file: `$(herdr plugin config-dir envvar.herd-trail)/todos.json` (fallback `~/.local/share/herd-trail/`). Writes take a mkdir lock, re-read before mutate, and land atomically via tmp+rename; a corrupt file is backed up (`todos.json.corrupt-<ts>`) and rebuilt empty. Concurrent adds from many panes are safe.

## How jumping works

- **Live pane** — `herdr agent focus <pane_id>` (works across workspaces; falls back to `tab focus`).
- **Closed pane** — `tab create` in your current workspace, then `agent start --kind pi -- --session <file>`. If the session file is gone, degrades to a bare pi in the recorded cwd.
- Layout changes run ~400ms after the overlay closes (a closing overlay restores the pre-overlay layout, which would silently undo the jump otherwise — trick borrowed from pane-mover).

## License

MIT
