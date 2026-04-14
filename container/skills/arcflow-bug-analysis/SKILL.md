---
name: arcflow-bug-analysis
description: Use when receiving a CI/CD failure, a raw stacktrace, or an ibuild webhook payload, and you need to turn it into an actionable bug report for the dev team. Replaces the former Dify "CI log → bug report" workflow. Produces a structured Markdown report that ArcFlow posts as a Feishu card. Triggers on "CI 失败 / 构建失败 / 分析日志 / 生成 Bug 报告".
---

# ArcFlow Bug Analysis

Turn noisy CI logs into a concise, routable bug report. Pair with `systematic-debugging` — that skill gives the investigation methodology; this one fixes the **output format**.

## Inputs

- Build log (stdout + stderr)
- Workflow metadata: repo, branch, commit, triggering Plane Issue
- Recent diff on the failing job (from `git log --stat` within `/workspace`)

## Required Output

```markdown
# Bug Report — <repo>#<short-sha>

## 概要
一句话说明失败现象。例："后端单测 UserServiceTest 空指针，入参 username 为 null。"

## 失败点
- 命令: `<失败的 CI step 原命令>`
- 文件/行: `path/to/File.java:42`
- 栈顶: `<class.method(File.java:42)>`

## 根因假设（按置信度排序）
1. **[高]** <一句话> — 证据: <log 摘录 / diff 指向>
2. **[中]** ...
3. **[低]** ...

## 修复建议
- 最小改动: <具体到文件 + 改法>
- 测试用例补充: <具体场景>
- 回归风险: <影响面>

## 上下文
- 关联 PR / commit: <link>
- 相似历史问题: <link | 无>
- 复现步骤: `<command>`
```

## 工作流

1. 扫日志找第一个非级联的 ERROR / FAILED / stacktrace — 那通常是根因；后面一堆红色常是级联。
2. 拉触发本次失败的 diff (`git diff <prev-green>..HEAD -- <suspect path>`)，关联代码改动与失败点。
3. 按"根因假设"模板输出 — **至少列 2 个假设**，单一假设说明分析不够。
4. 每条假设必须附 log 摘录或代码行作为证据 — 没证据的猜测不写。
5. 修复建议精确到文件 + 改法，不写"检查一下 XX 模块" 这种空话。
6. 落盘 `ops/bug-reports/<YYYY-MM-DD>-<issue>.md`（通过 Gateway `/api/docs/file`），再让 Gateway 推飞书卡片。

## 反模式

- 不复述整段 log — 摘要 + 关键行即可，附原 log 链接。
- 不把 warning 当 error — 区分致命错误与告警。
- 单根因 + "可能原因: 以上任一" — 禁止。每条假设独立论证。
- 不写"建议增强日志" 作为修复 — 那是后续动作，本次要给出最小修复。
