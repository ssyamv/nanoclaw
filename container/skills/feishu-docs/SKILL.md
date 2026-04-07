---
name: feishu-docs
description: Read Feishu (Lark) documents, wikis, spreadsheets, and bitables via API. ALWAYS use this tool for feishu.cn or xfchat.iflytek.com links instead of agent-browser. Works with private documents if the app has access.
allowed-tools: Bash(feishu-docs:*)
---

# Feishu Document Reader

Read content from Feishu (Lark) documents, wikis, spreadsheets, and bitables using the Feishu API.

## When to Use

**ALWAYS use this tool when you see:**
- `feishu.cn/docx/` or `feishu.cn/docs/` URLs
- `feishu.cn/wiki/` or `xfchat.iflytek.com/wiki/` URLs
- `feishu.cn/sheets/` or `xfchat.iflytek.com/sheets/` URLs
- `feishu.cn/base/` or `xfchat.iflytek.com/base/` URLs (bitable/多维表格)
- Any Feishu document, wiki, spreadsheet, or bitable link

**DO NOT use agent-browser for Feishu documents** - it will hit login pages. Use this API tool instead.

## Commands

```bash
# Read a single document (docx, wiki page, spreadsheet, bitable)
feishu-docs read <url_or_id>

# Read ALL documents in a wiki knowledge base (递归读取所有文档)
feishu-docs read-all <wiki_url>

# List all nodes in a wiki knowledge base (show structure)
feishu-docs list <wiki_url>

# List files in cloud drive
feishu-docs list-drive [folder_token]
```

## Examples

```bash
# Read a wiki page
feishu-docs read https://www.xfchat.iflytek.com/wiki/LXqCwW602iY3NukDUygrpJrpzEh

# Read ALL documents in a knowledge base
feishu-docs read-all https://www.xfchat.iflytek.com/wiki/LF4twk5YhiW4BWkyhFGrX2VVzuf

# List knowledge base structure
feishu-docs list https://www.xfchat.iflytek.com/wiki/LF4twk5YhiW4BWkyhFGrX2VVzuf

# Read a spreadsheet
feishu-docs read https://www.xfchat.iflytek.com/sheets/shtcnXXXXXX

# Read a bitable (多维表格)
feishu-docs read https://www.xfchat.iflytek.com/base/bascnXXXXXX
```

## Notes

- Uses Feishu API with app credentials (not browser automation)
- Works with private documents if the app has been granted access
- `read-all` recursively reads every document in a wiki — use when asked to "read the whole knowledge base"
- Supports both Feishu and Lark platforms (feishu.cn and xfchat.iflytek.com)
