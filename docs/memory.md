# 记忆

这套东西有两套不同的记忆，别混为一谈。

## 一、事的记忆（ticket）

每张票在 `stateDir/orchestrator.sqlite` 里留一条记录：谁提的、依据什么被受理、给过什么输入、worker 报告了什么、怎么结束的。产物在票据目录（`work/<ticket>/`），票结束也不删。

主会话可以主动查：`orchestrator_read tickets` / `threads` / `decisions`。

**它记的是「这件事做到哪了」，不是你。** 票结束以后，它不会在下次对话里主动想起你提过什么。

## 二、人的记忆（memory 插件）

默认安装会带上 [dsh-memory-index](https://github.com/yinguobing/dsh-memory-index)。工作区就是状态目录：

```
<stateDir>/
├── MEMORY.md          # 稳定事实：人、偏好、长期约定
├── memory/YYYY-MM-DD.md   # 当天发生的事
├── wiki/              # 可选，长期知识
└── .memory/index.sqlite   # 检索索引（FTS5）
```

主会话与 worker 都能用三个工具：`memory_search`、`memory_read`、`memory_write`。

**写入规则**（写在提示词里）：你说到关于你自己、你的人、你的偏好、你在做的事的稳定事实，它写下来；回答这类问题前先搜记忆；票里的事不进记忆。

**启动注入**：`autoRecall: startup` 会把 `MEMORY.md`、今天与昨天的日记拼进系统提示，所以近期的事不用搜也在。

**权限**：只允许写 `MEMORY.md` 和 `memory/`；索引只读不写别的目录。

## 怎么验的

1. 面板说「记住：我女儿叫小满，今年 6 岁，喜欢恐龙」；
2. 它写进 `MEMORY.md`：
   ```
   ## People
   - 女儿：小满，2020 年出生（2026 年 6 岁），喜欢恐龙。
   ```
3. **删掉 DSH 的会话记录**（`sessions/` 整个删掉，但保留状态目录），重启；
4. 问「我女儿叫什么？今年几岁？」——回答「小满，2020 年出生，今年 6 岁，喜欢恐龙」。

会话记录没了、记忆还在，这是这次验证要证明的事。

## 边界

- **它不会自己挑事实。** 记忆里有的，是你（或它当场判断值得记而写下的）内容；没写进去的，它不会事后补。
- **autoRecall 只覆盖最近。** 更早的事要靠搜索，而搜索是词法匹配（FTS5），不是语义——换个说法可能搜不到。
- **存在本地文件里。** 想备份就备份 `MEMORY.md` 与 `memory/`；想迁移就整目录搬走。
- **这是外挂。** 等 DSH 自己有记忆方案，这一层可以换掉，格式是普通 Markdown，不会被绑死。

## 关掉

安装时加 `--no-memory`；或从 profile 的 `cordis.patch.yml` 里删掉 `memory-index` 那一段。
