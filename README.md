# evc-spark-mcp

[![npm version](https://img.shields.io/npm/v/evc-spark-mcp.svg)](https://www.npmjs.com/package/evc-spark-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [Spark AI Assets Marketplace](https://spark.entire.vc) — search and discover agents, skills, prompts, and MCP connectors.

## Quick Start

```bash
npx evc-spark-mcp
```

### Add to Claude Code

```bash
claude mcp add spark -- npx -y evc-spark-mcp
```

### Add to Claude Desktop

Add to your `claude_desktop_config.json`:

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

### Add to Cursor

Add to your Cursor MCP settings:

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

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SPARK_API_URL` | `https://spark.entire.vc/api/v1` | Spark API base URL |
| `SPARK_SITE_URL` | `https://spark.entire.vc` | Spark website URL (for links) |

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

## License

MIT
