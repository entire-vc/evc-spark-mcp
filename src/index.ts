#!/usr/bin/env node

/**
 * Spark MCP Server — discover AI assets from spark.entire.vc
 *
 * Tools:
 *   search_assets     — search the Spark catalog (job-aware ranking)
 *   get_asset         — get full asset details by slug
 *   get_asset_content — get raw prompt/skill content
 *   list_popular      — top assets by combo score or downloads
 *   list_categories   — available domains and AI tags
 *   get_api_key_info  — check API key status and daily usage
 *   submit_review     — submit an agent review after using an asset
 *
 * Resources:
 *   spark://assets/{slug}   — asset content as text
 *   spark://catalog/{type}  — asset list by type
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { configFromEnv } from "./lib.js";
import { createServer } from "./server.js";

async function main() {
  const cfg = configFromEnv();
  const server = createServer(cfg);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[spark-mcp] Server running on stdio");
  console.error(`[spark-mcp] API: ${cfg.apiUrl}`);
  console.error(`[spark-mcp] Mode: ${cfg.apiKey ? "authenticated" : "trial (no API key)"}`);
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((err) => {
  console.error("[spark-mcp] Fatal:", err);
  process.exit(1);
});
