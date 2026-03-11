# Spark MCP

[![npm version](https://img.shields.io/npm/v/evc-spark-mcp.svg)](https://www.npmjs.com/package/evc-spark-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-00A67E)](https://modelcontextprotocol.io)
[![Install via Spark](https://spark.entire.vc/badges/spark-mcp-server/install.svg)](https://spark.entire.vc/get/spark-mcp-server?utm_source=github&utm_medium=readme)

MCP server for [Spark](https://spark.entire.vc) — your AI toolbox for real work. Search and discover agents, skills, prompts, bundles, and MCP connectors.

---

## Quick Start

```bash
npx evc-spark-mcp
```

That's it. No API key needed.

---

## Setup

### Claude Code

```bash
claude mcp add spark -- npx -y evc-spark-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "spark": {
      "command": "npx",
      "args": ["-y", "evc-spark-mcp"]
    }
  }
}
```

### Cursor

Add to Cursor MCP settings:

```json
{
  "mcpServers": {
    "spark": {
      "command": "npx",
      "args": ["-y", "evc-spark-mcp"]
    }
  }
}
```

### OpenClaw

```json
{
  "mcpServers": {
    "spark": {
      "command": "npx",
      "args": ["-y", "evc-spark-mcp"]
    }
  }
}
```

### ChatGPT (via MCP bridge)

Any MCP-compatible client works — just point it at `npx evc-spark-mcp`.

---

## Tools

| Tool | Description |
|------|-------------|
| `search_assets` | Search the Spark catalog by query, type, and domain |
| `get_asset` | Get full details of an asset by slug |
| `get_asset_content` | Get raw prompt/skill content (best for prompts and skills) |
| `list_popular` | List most popular assets by download count |
| `list_categories` | List available domains and AI tags for filtering |

## Resources

| URI Pattern | Description |
|-------------|-------------|
| `spark://assets/{slug}` | Asset content as markdown |
| `spark://catalog/{type}` | Asset list by type (agent, skill, prompt, etc.) |

---

## What's in the Catalog

[Spark](https://spark.entire.vc) is a marketplace of AI workflow assets:

- **Agents** — ready-to-use AI agent configurations
- **Skills** — capabilities you can add to your agent (like this MCP server)
- **Prompts** — tested prompt templates for specific tasks
- **Bundles** — curated sets of tools that work together
- **MCP Connectors** — integrations with external services

Find, share, and monetize AI tools — all in one place.

---

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SPARK_API_URL` | `https://spark.entire.vc/api/v1` | Spark API base URL |
| `SPARK_SITE_URL` | `https://spark.entire.vc` | Spark website URL (for links) |

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Test with MCP Inspector
npm run inspect
```

---

## Part of the Entire VC Toolbox

| Product | What it does | Link |
|---------|-------------|------|
| **Local Sync** | Vault ↔ AI dev tools sync | [repo](https://github.com/entire-vc/evc-local-sync-plugin) |
| **Team Relay** | Self-hosted collaboration server | [repo](https://github.com/entire-vc/evc-team-relay) |
| **Team Relay Plugin** | Obsidian plugin for Team Relay | [repo](https://github.com/entire-vc/evc-team-relay-obsidian-plugin) |
| **OpenClaw Skill** | AI agent ↔ vault access | [repo](https://github.com/entire-vc/evc-team-relay-openclaw-skill) |
| **Spark MCP** ← you are here | MCP server for Spark catalog | this repo |

<a href="https://glama.ai/mcp/servers/entire-vc/evc-spark-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/entire-vc/evc-spark-mcp/badge" alt="evc-spark-mcp MCP server" />
</a>

## Community

- 🌐 [entire.vc](https://entire.vc)
- ⚡ [spark.entire.vc](https://spark.entire.vc)
- 💬 [Discussions](https://github.com/entire-vc/.github/discussions)
- 📧 in@entire.vc

## License

MIT — Copyright (c) 2026 Entire VC
