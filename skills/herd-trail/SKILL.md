---
name: herd-trail
description: "herd 全局共享备忘。对话中出现需要用户后续处理的事(清理、跟进、阻塞、跨会话)时随手记入;也可随时查清单现状。不是本会话的施工清单。"
---

# herd-trail — herd 全局备忘

## 和对话 todo 的区别(别记错地方)

- **trail_add 等工具** / `herd-trail` = 写给**用户**的跨会话备忘,长久保留,人在 overlay 里管。
- **对话里的 todo 工具** = agent 自己的施工清单,会话结束即焚,用户不用看。
- 用户说"设个 todo / 记一下"时:你自己要做的步骤 → 对话 todo;留给人后续处理 → `trail_add`。

## 何时记(trail_add / `herd-trail add "文本"`)

- 留给**用户**后续处理的事:善后清理、需要人操作的步骤、等外部条件的跟进
- 需要**跨会话**存续的备忘(本会话结束仍有效)
- 你发现但**不在当前任务范围**的问题(顺手记下,不中断主线)

## 何时不记

- 本会话内自己能完成的事 —— 直接做,或记对话 todo
- 纯对话内容、推测、临时笔记 —— 清单不是垃圾桶

## 规则

- 一条一事;文本必须自带上下文(对象 + 动作 + 条件),脱离对话也能看懂。
  坏:"清理容器"。好:"m1 恢复后 docker rm -f pi-fence-bundle pi-fence-kroki"。
- 重复前先 `herd-trail list` 查重。
- 溯源**不用你管**:add 时自动捕获 pane/cwd/pi session,不要自己传。
- `done` 闭环:仅当用户在本对话明确表示该事项已办/处理完,不要自己判断。

## 命令

```bash
herd-trail add "文本"            # 记录
herd-trail list [--all]        # 看清单(默认 open)
herd-trail edit <id> "新文本"   # 改文本(保留状态/溯源;笔误随手改,不改状态)
herd-trail done <id>           # 闭环(规则见上)
herd-trail show <id>           # 看某条溯源详情
```

有 model-visible 工具时优先用 `trail_add` / `trail_list` / `trail_done` / `trail_edit`,免 shell 引用问题。
