---
name: arcflow-workflow
description: Trigger and inspect ArcFlow workflow executions (prd_to_tech / tech_to_openapi / code_gen / bug_analysis) via Gateway. Use when the user asks to generate tech docs, OpenAPI specs, or code from a Plane Issue, or wants to check which workflows are currently running.
allowed-tools: Bash(arcflow-workflow:*)
---

# ArcFlow Workflow Tool

Gateway-backed workflow orchestration. Each workflow is driven by a Plane Issue id and produces artifacts back into the docs repo + Feishu notifications.

## Environment

- `GATEWAY_URL`
- `ARCFLOW_JWT` (optional — Gateway workflow endpoints currently accept anonymous; pass when available)

## Commands

```bash
# Fire a workflow. type ∈ {prd_to_tech, tech_to_openapi, code_gen, bug_analysis}
arcflow-workflow trigger <type> <plane_issue_id> [target_repos...]
# target_repos: only valid for code_gen, one or more of: backend vue3 flutter android

# Convenience shorthand
arcflow-workflow trigger code_gen_backend <plane_issue_id>
arcflow-workflow trigger code_gen_vue3    <plane_issue_id>
arcflow-workflow trigger code_gen_flutter <plane_issue_id>
arcflow-workflow trigger code_gen_android <plane_issue_id>

# Status of a specific execution
arcflow-workflow status <execution_id>

# List currently in-flight executions (queued + running)
arcflow-workflow list_active [--type <workflow_type>] [--limit 20]
```

## When to Use

- "帮我生成 ISSUE-123 的技术文档" → `trigger prd_to_tech ISSUE-123`
- "出一份 OpenAPI" → `trigger tech_to_openapi ISSUE-123`
- "生成后端代码" → `trigger code_gen_backend ISSUE-123`
- "现在有哪些工作流在跑" → `list_active`
- "执行 exec-42 跑到哪了" → `status exec-42`

## Notes

- Workflow execution is asynchronous. Trigger returns an execution id; poll `status` or let Gateway push via Feishu.
- When the caller omits `ARCFLOW_JWT`, the Gateway currently executes workflows with system privilege. This will tighten in Batch 2-F.
