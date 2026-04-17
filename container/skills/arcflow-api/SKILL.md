---
name: arcflow-api
description: Call ArcFlow Gateway for workflow operations, docs Git lookup, and knowledge retrieval. Use this for workflow operations, project/document questions, and document lookups.
allowed-tools: Bash(arcflow-api:*)
---

# ArcFlow API Tool

Interact with ArcFlow platform services from inside the agent container.

## When to Use

- **Trigger workflows** — user asks to generate tech docs, OpenAPI, or code for an Issue
- **Check workflow status** — user asks about progress of a workflow execution
- **Knowledge Q&A** — user asks technical/documentation questions that need workspace docs retrieval
- **Document operations** — user asks to find, search, or read docs from the current workspace docs Git repository

## Commands

```bash
# List my issues in current workspace
arcflow-api issues my

# Create a requirement draft preview (dry-run by default)
arcflow-api requirements draft "统一登录改造" "需要支持 SSO 与权限分级"

# Execute requirement draft creation
arcflow-api requirements draft "统一登录改造" "需要支持 SSO 与权限分级" --execute

# Trigger a workflow
arcflow-api workflow trigger <type> <plane_issue_id> [target_repos...]
# type: prd_to_tech | tech_to_openapi | code_gen | bug_analysis
# target_repos (code_gen only): backend vue3 flutter android

# Shorthand for code_gen with specific target
arcflow-api workflow trigger code_gen_backend <plane_issue_id>
arcflow-api workflow trigger code_gen_vue3 <plane_issue_id>
arcflow-api workflow trigger code_gen_flutter <plane_issue_id>
arcflow-api workflow trigger code_gen_android <plane_issue_id>

# Query workflow execution status
arcflow-api workflow status <plane_issue_id>

# Post workflow callback to Gateway (used by non-interactive arcflow-* skills)
# output_json must be a JSON string; on failure pass an error message instead.
arcflow-api workflow callback <dispatch_id> <skill> success '<output_json>'
arcflow-api workflow callback <dispatch_id> <skill> failed '{}' "error message"

# Knowledge Q&A via Gateway RAG snippet search
arcflow-api rag query "your question here"

# RAG snippet search via Gateway (used by arcflow-rag skill)
arcflow-api rag search <workspace_id> "question" [top_k]

# Workspace docs Git document operations (via Gateway)
arcflow-api wiki list                    # List recent documents
arcflow-api wiki search "keyword"        # Search documents
arcflow-api wiki read <path>             # Read document content
```

## Examples

```bash
# Look at my current issues
arcflow-api issues my

# Preview a requirement draft before asking the user to confirm execution
arcflow-api requirements draft "统一登录改造" "需要支持 SSO 与权限分级"

# Trigger tech doc generation for ISSUE-123
arcflow-api workflow trigger prd_to_tech ISSUE-123

# Trigger backend code generation
arcflow-api workflow trigger code_gen_backend ISSUE-123

# Trigger code gen for multiple targets
arcflow-api workflow trigger code_gen ISSUE-123 backend vue3

# Check status
arcflow-api workflow status ISSUE-123

# Ask a question
arcflow-api rag query "用户登录的接口定义在哪？"

# Find a document
arcflow-api wiki search "用户注册"
```

## Notes

- `issues my` and `requirements draft` read `/run/arcflow/credentials.json`
  to forward the current user's token and workspace automatically
- `requirements draft` is dry-run by default; pass `--execute` only after the
  user explicitly confirms the write
- Workflow trigger will show the execution ID on success
- `rag query` prints the most relevant indexed snippets from the current workspace docs so the model can answer grounded in docs
- `wiki` operations read the current workspace docs Git repository via Gateway `/api/docs` endpoints
