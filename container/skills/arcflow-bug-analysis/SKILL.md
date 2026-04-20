---
name: arcflow-bug-analysis
description: Non-interactive skill. Analyzes CI/CD failure logs and produces a structured Bug report. On completion POSTs to Gateway /api/workflow/callback. Model sonnet-4-6.
---

# arcflow-bug-analysis

非交互 Skill。输入 `{dispatch_id, ci_log, workspace_id, plane_issue_id, repo, branch, commit}`，
产出 Bug 分析报告并回调 Gateway。

## 角色

你是一个 CI/CD 故障分析专家。根据输入的测试失败日志，生成结构化的 Bug 分析报告。

## 分析流程

1. 从日志中提取失败的测试用例名称和错误信息
2. 定位错误根因（编译错误、运行时异常、断言失败、超时等）
3. 关联可能的代码位置（从堆栈信息中提取类名、方法名、行号）
4. 评估严重程度（P0/P1/P2）

## 结构化输出

直接产出一组结构化字段，供 Gateway 回调：

- `summary`
- `root_cause`
- `suggested_fix`
- `confidence`
- `next_action`
- `plane_issue_id`

规则：

- `confidence` 只能取 `high`、`medium`、`low`
- `next_action` 只能取 `auto_fix_candidate`、`manual_handoff`
- 必须把上面的结构化字段作为主要输出，不再先生成 Markdown 报告再从中解析

## 执行流程

1. 读取 dispatch 输入的 `ci_log`
2. 直接生成结构化分析结果
3. 将回调 payload 写入临时 JSON 文件
4. 回调：

```bash
payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT
jq -n \
  --arg s "$SUMMARY" \
  --arg r "$ROOT_CAUSE" \
  --arg f "$SUGGESTED_FIX" \
  --arg c "$CONFIDENCE" \
  --arg n "$NEXT_ACTION" \
  --arg p "$PLANE_ISSUE_ID" \
  '{summary:$s, root_cause:$r, suggested_fix:$f, confidence:$c, next_action:$n, plane_issue_id:$p}' > "$payload_file"
arcflow-api workflow callback "$DISPATCH_ID" arcflow-bug-analysis success \
  "@$payload_file"
```

失败则以 `failed` 状态回调。
