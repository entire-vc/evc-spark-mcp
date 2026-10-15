# Spark MCP

[![npm version](https://img.shields.io/npm/v/evc-spark-mcp.svg)](https://www.npmjs.com/package/evc-spark-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-00A67E)](https://modelcontextprotocol.io)
[![Install via Spark](https://spark.entire.vc/badges/spark-mcp-server/install.svg)](https://spark.entire.vc/assets/spark-mcp-server?utm_source=github&utm_medium=readme)
[![Smithery](https://img.shields.io/badge/Smithery-entirevc%2Fspark-F26B21)](https://smithery.ai/servers/entirevc/spark)

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

### Install in Cursor

This repository includes a Cursor plugin with a remote Spark MCP server and the
`use-spark` skill. No Node.js process or API key is needed for anonymous access.

To test a local install:

```bash
git clone https://github.com/entire-vc/evc-spark-mcp.git
mkdir -p ~/.cursor/plugins/local/spark
cp -R evc-spark-mcp/.cursor-plugin evc-spark-mcp/mcp.json \
  evc-spark-mcp/server.json evc-spark-mcp/skills ~/.cursor/plugins/local/spark/
```

Restart Cursor or run **Developer: Reload Window**, then open **Customize** and
confirm the `use-spark` skill and Spark MCP server. Enable the server if prompted;
its tools include `search_assets`, `get_asset`, `get_asset_content`, and
`report_outcome`. Try: “Find a Spark skill for reviewing Python code.”
Local plugin imports must be allowed by your team administrator. Copy the files:
Cursor skips symlinks whose target is outside `~/.cursor/plugins/local`.
See [Cursor's local plugin instructions](https://cursor.com/docs/plugins#test-plugins-locally).

For optional authenticated access, set `SPARK_API_KEY` in the environment used to
launch Cursor and restart it. `mcp.json` uses Cursor's `${env:SPARK_API_KEY}`
interpolation for `X-API-Key`; leave it unset or empty for anonymous access. Never
put a key in the repository. Get a key from your [Spark profile](https://spark.entire.vc/profile).

Plugin contents:

| Path | Purpose |
|------|---------|
| `.cursor-plugin/plugin.json` | Cursor manifest with explicit relative component paths |
| `mcp.json` | Streamable HTTP connection to `https://spark.entire.vc/mcp/` |
| `skills/use-spark/SKILL.md` | Search, inspect, fetch, apply, and report outcomes |
| `server.json` | Remote server metadata; its version matches the plugin version |

The plugin follows the hosted server version (`4.0.4`), independently of the npm
stdio package version. When updating the hosted version, update `server.json` and the plugin manifest
together; `npm test` checks that they match.

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
| `get_api_key_info` | Check your API key status and daily usage |
| `report_outcome` | Report what happened when you applied fetched content: applied as is, applied with changes, broke, or not applicable |

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

<details>
<summary>Find us in other directories</summary>

<br>

[![MCP Badge](https://lobehub.com/badge/mcp/entire-vc-evc-spark-mcp)](https://lobehub.com/mcp/entire-vc-evc-spark-mcp)
[![Glama](https://img.shields.io/badge/Glama-listed-1F2937)](https://glama.ai/mcp/servers/entire-vc/evc-spark-mcp)
[![Smithery](https://img.shields.io/badge/Smithery-listed-F26B21)](https://smithery.ai/servers/entirevc/spark)

</details>

## License

MIT — Copyright (c) 2026 Entire VC
