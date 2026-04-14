---
name: arcflow-requirement
description: Create, inspect, and finalize ArcFlow requirement drafts via Gateway REST API. Use when the user wants to start a new requirement, update PRD fields on an existing draft, list drafts in the current workspace, or push a draft into Feishu review. The Agent should auto-extract PRD fields from conversation and call `patch` — do NOT ask the user to re-type structured fields.
allowed-tools: Bash(arcflow-requirement:*)
---

# ArcFlow Requirement Tool

Direct interface to ArcFlow Gateway requirement-draft endpoints. Replaces the old Dify `requirement_chat` flow: the Agent itself extracts PRD fields and writes them via `patch`.

## Environment

Requires the following env vars (injected by the container runner):

- `GATEWAY_URL` — e.g. `http://gateway:3000`
- `ARCFLOW_JWT` — Bearer token for the current user (from WebChannel auth context)
- `ARCFLOW_WORKSPACE_ID` — numeric workspace id (from WebChannel auth context)

## Commands

```bash
# Create a new draft in the current workspace
arcflow-requirement create_draft [--feishu-chat-id <id>]

# Fetch a single draft
arcflow-requirement get <draft_id>

# List drafts (workspace-scoped); status filter optional
arcflow-requirement list [--status drafting|review|approved|rejected] [--limit 20]

# Patch PRD fields on a draft
arcflow-requirement patch <draft_id> [--title "..."] [--description "..."] [--prd "<markdown>"]
arcflow-requirement patch <draft_id> --prd-file path/to/prd.md

# Finalize (locks draft + emits Feishu review card)
arcflow-requirement finalize <draft_id>
```

All commands print the Gateway JSON response (pretty-printed) to stdout and exit 0, or write an error line to stderr and exit 1.

## When to Use

- User says "开个新需求 / 帮我记录一下 / 我想做 X" → `create_draft`, then follow-up `patch` as the Agent extracts fields.
- User updates a field mid-conversation → `patch`.
- User says "提交审核 / 走 Review" → `finalize`.
- User asks "我的草稿有哪些" → `list`.

## Notes

- The old `requirement_chat` (Dify chatflow) has been removed. The Agent is now responsible for PRD-field extraction — use the `arcflow-prd-authoring` skill for checklist guidance.
- Writing to the draft table MUST go through this tool (Gateway enforces ownership + ws scope).
