# herdr-trail

> 🚧 WIP — 需求已定稿([docs/prd.md](docs/prd.md))，实现进行中。Agent 接手请先读 [AGENTS.md](AGENTS.md)。

**herd 全局共享 todolist** — a [herdr](https://herdr.dev) plugin.

- **Agent 随手记**：对话中调 `trail_add` 工具或 `herd-trail add "…"`，溯源（哪个 agent / pane / pi 会话）自动落库
- **人统一看**:herdr overlay 打开全 herd 清单
- **每条可溯源跳回**:pane 活着就 focus，关了就用 session 文件 resume 出原对话

## Install(开发期)

```bash
herdr plugin link ~/src/herdr-trail
herdr plugin action invoke open --plugin envvar.herd-trail
```

## License

MIT
