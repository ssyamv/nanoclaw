---
name: arcflow-knowledge
description: Search and read documents in the current workspace's docs repo (PRD, tech-design, OpenAPI, arch, ops, market) via Gateway. Use when the user asks to find or recall something from the knowledge base. For free-text grep inside the mounted /workspace tree, prefer the native Grep tool instead.
allowed-tools: Bash(arcflow-knowledge:*)
---

# ArcFlow Knowledge Tool

Gateway-backed docs access. The Gateway resolves the correct per-workspace git repo (`ws-<id>-docs`) based on the caller's JWT, so the Agent doesn't need to know repo paths.

## Environment

- `GATEWAY_URL`
- `ARCFLOW_JWT` — required (workspace scope is derived from the token)

## Commands

```bash
# Search docs by keyword (full-text). Returns {path, title, snippet} entries.
arcflow-knowledge kb_search_prd <keyword> [--type prd|tech-design|api|arch|ops|market]

# Read a single document by its repo-relative path (e.g. "prd/login-flow.md")
arcflow-knowledge kb_read_doc <path>
```

## When to Use

- User asks "登录相关的 PRD 有什么" → `kb_search_prd 登录`
- User asks "帮我看一下 prd/payment.md" → `kb_read_doc prd/payment.md`
- User wants to grep inside the mounted source tree (`/workspace/...`) → use the native `Grep` tool, **not** this skill. Per design, `kb_grep` is intentionally not a Gateway tool.

## Notes

- Search hits are filtered client-side by `--type` prefix if provided (e.g. `--type prd` keeps only `prd/*`).
- The Gateway currently exposes `/api/docs/search` (keyword) and `/api/docs/file` (read). The spec's eventual shape (`/api/docs?type=prd&q=...`) will land in Batch 2-F; this skill uses what's available today.
- RAG-style semantic query (`kb_query`) is explicitly NOT part of this skill — we rely on Agent + Grep + MemPalace rather than Weaviate.
