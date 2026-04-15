---
name: arcflow-api
description: Call ArcFlow Gateway (workflow trigger/status), Dify RAG (knowledge Q&A), and Wiki.js (document query) APIs. Use this for workflow operations, knowledge questions, and document lookups.
allowed-tools: Bash(arcflow-api:*)
---

# ArcFlow API Tool

Interact with ArcFlow platform services from inside the agent container.

## When to Use

- **Trigger workflows** — user asks to generate tech docs, OpenAPI, or code for an Issue
- **Check workflow status** — user asks about progress of a workflow execution
- **Knowledge Q&A** — user asks technical/documentation questions that need RAG search
- **Document operations** — user asks to find, search, or read docs from Wiki.js

## Commands

```bash
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

# Knowledge Q&A via Dify RAG (legacy, blocking chat)
arcflow-api rag query "your question here"

# RAG snippet search via Gateway (used by arcflow-rag skill)
arcflow-api rag search <workspace_id> "question" [top_k]

# Wiki.js document operations
arcflow-api wiki list                    # List recent documents
arcflow-api wiki search "keyword"        # Search documents
arcflow-api wiki read <path>             # Read document content
```

## Examples

```bash
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

- Workflow trigger will show the execution ID on success
- RAG query returns an answer based on indexed documentation
- Wiki operations query the Wiki.js GraphQL API
