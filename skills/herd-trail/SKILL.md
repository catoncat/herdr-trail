---
name: herd-trail
description: "herd 全局共享 todolist。当对话中出现需要用户后续处理的事(善后、跟进、需要人决策的阻塞、跨会话任务)时随手记入全局清单;也用于在对话里查看清单现状。溯源(哪个 agent/会话)自动落库,用户可从 herdr 里一键跳回本对话。"
---

# herd-trail — herd 全局 todolist

## 何时记(trail_add / `herd-trail add "文本"`)

- 留给**用户**后续处理的事:善后清理、需要人操作的步骤、等外部条件的跟进
- 需要**跨会话**存续的待办(本会话结束仍有效)
- 你发现但**不在当前任务范围**的问题(顺手记下,不中断主线)

## 何时不记

- 本会话内自己能完成的事 —— 直接做
- 纯对话内容、推测、临时笔记 —— 清单不是垃圾桶

## 规则

- 一条一事;文本必须自带上下文(对象 + 动作 + 条件),脱离对话也能看懂。
  坏:"清理容器"。好:"m1 恢复后 docker rm -f pi-fence-bundle pi-fence-kroki"。
- 重复前先 `herd-trail list` 查重。
- 溯源**不用你管**:add 时自动捕获 pane/cwd/pi session,不要自己传。

## 命令

```bash
herd-trail add "文本"     # 记录
herd-trail list           # 看 open 清单(--all 含 done)
herd-trail done <id>      # 闭环(确认用户的事已办才可标 done)
herd-trail show <id>      # 看某条溯源详情
```

有 model-visible 工具时优先用 `trail_add` / `trail_list`,免 shell 引用问题。
