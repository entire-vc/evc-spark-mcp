#!/usr/bin/env node

/**
 * Spark MCP Server — discover AI assets from spark.entire.vc
 *
 * Tools:
 *   search_assets  — search the Spark catalog
 *   get_asset      — get full asset details by slug
 *   get_asset_content — get raw prompt/skill content
 *   list_popular   — top assets by downloads
 *   list_categories — available domains and AI tags
 *
 * Resources:
 *   spark://assets/{slug}   — asset content as text
 *   spark://catalog/{type}  — asset list by type
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SPARK_API =
  process.env.SPARK_API_URL || "https://spark.entire.vc/api/v1";
const SPARK_SITE = process.env.SPARK_SITE_URL || "https://spark.entire.vc";

const TYPE_SLUG: Record<string, string> = {
  agent: "agents",
  skill: "skills",
  prompt: "prompts",
  prompt_chain: "prompt-chains",
  mcp_connector: "mcps",
  bundle: "bundles",
};

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function sparkApi<T = unknown>(path: string): Promise<T> {
  const url = `${SPARK_API}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Spark API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types (matching Spark API responses)
// ---------------------------------------------------------------------------

interface AssetListItem {
  id: string;
  type: string;
  title: string;
  slug: string;
  short_description: string;
  ai_tags: string[];
  domain_tags: { parent_name: string; child_name: string; child_slug: string }[];
  pricing_type: string;
  price_credits: number;
  downloads_count: number;
  rating_avg: number;
  rating_count: number;
  is_featured: boolean;
  is_verified: boolean;
  created_at: string;
}

interface Asset extends AssetListItem {
  description_md: string;
  inline_content?: string | null;
  version: string;
  files: { filename: string; size_bytes: number }[];
  bundle_items?: { asset_title: string; asset_slug: string; asset_type: string; role: string }[];
  chain_steps?: { title: string; content: string; order: number }[];
  external_source_name?: string | null;
  external_source_url?: string | null;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

interface AiTag {
  slug: string;
  name: string;
}

interface DomainGroup {
  parent_name: string;
  parent_slug: string;
  children: { child_name: string; child_slug: string }[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function assetUrl(asset: { type: string; slug: string }): string {
  const slug = TYPE_SLUG[asset.type] || "assets";
  return `${SPARK_SITE}/${slug}/${asset.slug}`;
}

function formatAssetSummary(a: AssetListItem): string {
  const badges = [
    a.is_featured ? "Featured" : "",
    a.is_verified ? "Verified" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const badgeStr = badges ? ` [${badges}]` : "";

  return [
    `**${a.title}**${badgeStr}`,
    `Type: ${a.type} | Rating: ${a.rating_avg.toFixed(1)}/5 (${a.rating_count}) | Downloads: ${a.downloads_count}`,
    `${a.short_description}`,
    `Price: ${a.pricing_type === "free" ? "Free" : `${a.price_credits} EVC`}`,
    a.ai_tags.length ? `AI Models: ${a.ai_tags.join(", ")}` : "",
    a.domain_tags.length
      ? `Domains: ${a.domain_tags.map((d) => d.child_name).join(", ")}`
      : "",
    `URL: ${assetUrl(a)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAssetFull(a: Asset): string {
  const sections: string[] = [
    `# ${a.title}`,
    "",
    `**Type:** ${a.type}`,
    `**Rating:** ${a.rating_avg.toFixed(1)}/5 (${a.rating_count} ratings)`,
    `**Downloads:** ${a.downloads_count}`,
    `**Price:** ${a.pricing_type === "free" ? "Free" : `${a.price_credits} EVC`}`,
    `**Version:** ${a.version}`,
    `**URL:** ${assetUrl(a)}`,
  ];

  if (a.ai_tags.length) {
    sections.push(`**AI Models:** ${a.ai_tags.join(", ")}`);
  }
  if (a.domain_tags.length) {
    sections.push(
      `**Domains:** ${a.domain_tags.map((d) => d.child_name).join(", ")}`
    );
  }
  if (a.external_source_name) {
    sections.push(
      `**Source:** ${a.external_source_name}${a.external_source_url ? ` (${a.external_source_url})` : ""}`
    );
  }

  sections.push("", "## Description", "", a.description_md);

  if (a.inline_content) {
    sections.push("", "## Content", "", a.inline_content);
  }

  if (a.chain_steps?.length) {
    sections.push("", "## Prompt Chain Steps");
    for (const step of a.chain_steps.sort((x, y) => x.order - y.order)) {
      sections.push("", `### Step ${step.order}: ${step.title}`, "", step.content);
    }
  }

  if (a.bundle_items?.length) {
    sections.push("", "## Bundle Contents");
    for (const item of a.bundle_items) {
      sections.push(`- **${item.asset_title}** (${item.asset_type}) — ${item.role}`);
    }
  }

  if (a.files?.length) {
    sections.push("", "## Files");
    for (const f of a.files) {
      sections.push(`- ${f.filename} (${(f.size_bytes / 1024).toFixed(1)} KB)`);
    }
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  {
    name: "spark-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.tool(
  "search_assets",
  "Search the Spark AI assets marketplace. Returns matching agents, skills, prompts, MCP connectors, and bundles.",
  {
    query: z.string().describe("Search query (title, description)"),
    type: z
      .enum(["agent", "skill", "prompt", "prompt_chain", "mcp_connector", "bundle"])
      .optional()
      .describe("Filter by asset type"),
    domain: z.string().optional().describe("Filter by domain slug (e.g. 'development', 'marketing')"),
    limit: z.number().min(1).max(50).default(10).describe("Number of results (1-50, default 10)"),
  },
  async ({ query, type, domain, limit }) => {
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("page_size", String(limit));
    if (type) params.set("asset_type", type);
    if (domain) params.set("domain", domain);

    const res = await sparkApi<PaginatedResponse<AssetListItem>>(
      `/assets?${params.toString()}`
    );

    if (res.items.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No assets found for "${query}". Try a different search term or remove filters.`,
          },
        ],
      };
    }

    const text = [
      `Found ${res.total} assets (showing ${res.items.length}):`,
      "",
      ...res.items.map(
        (a, i) => `${i + 1}. ${formatAssetSummary(a)}`
      ),
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "get_asset",
  "Get full details of a Spark asset by its slug. Returns description, content, files, ratings, and more.",
  {
    slug: z.string().describe("Asset slug (e.g. 'vb-seo-expert', 'vb-python-expert')"),
  },
  async ({ slug }) => {
    const asset = await sparkApi<Asset>(`/assets/${slug}`);
    return {
      content: [{ type: "text" as const, text: formatAssetFull(asset) }],
    };
  }
);

server.tool(
  "get_asset_content",
  "Get the raw content of a Spark asset (prompt text, skill instructions, agent config). Best for prompts and skills that have inline content.",
  {
    slug: z.string().describe("Asset slug"),
  },
  async ({ slug }) => {
    const asset = await sparkApi<Asset>(`/assets/${slug}`);

    // For prompt chains, concatenate steps
    if (asset.chain_steps?.length) {
      const steps = asset.chain_steps
        .sort((a, b) => a.order - b.order)
        .map((s) => `## Step ${s.order}: ${s.title}\n\n${s.content}`)
        .join("\n\n---\n\n");
      return { content: [{ type: "text" as const, text: steps }] };
    }

    // For assets with inline content
    if (asset.inline_content) {
      return {
        content: [{ type: "text" as const, text: asset.inline_content }],
      };
    }

    // Fallback to description
    return {
      content: [
        {
          type: "text" as const,
          text: asset.description_md || asset.short_description,
        },
      ],
    };
  }
);

server.tool(
  "list_popular",
  "List the most popular Spark assets by download count. Great for discovering top-rated AI tools.",
  {
    type: z
      .enum(["agent", "skill", "prompt", "prompt_chain", "mcp_connector", "bundle"])
      .optional()
      .describe("Filter by asset type"),
    limit: z.number().min(1).max(20).default(10).describe("Number of results (1-20, default 10)"),
  },
  async ({ type, limit }) => {
    const params = new URLSearchParams();
    params.set("sort", "popular");
    params.set("page_size", String(limit));
    if (type) params.set("asset_type", type);

    const res = await sparkApi<PaginatedResponse<AssetListItem>>(
      `/assets?${params.toString()}`
    );

    const text = [
      `Top ${res.items.length} ${type || "all"} assets by downloads:`,
      "",
      ...res.items.map(
        (a, i) => `${i + 1}. ${formatAssetSummary(a)}`
      ),
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "list_categories",
  "List available categories (domains and AI tags) in the Spark marketplace. Useful for filtering searches.",
  {},
  async () => {
    const [ais, domains] = await Promise.all([
      sparkApi<AiTag[]>("/taxonomy/ais"),
      sparkApi<DomainGroup[]>("/taxonomy/domains"),
    ]);

    const sections: string[] = ["## AI Tags", ""];
    for (const tag of ais) {
      sections.push(`- ${tag.name} (\`${tag.slug}\`)`);
    }

    sections.push("", "## Domains", "");
    for (const group of domains) {
      sections.push(`### ${group.parent_name}`);
      for (const child of group.children) {
        sections.push(`- ${child.child_name} (\`${child.child_slug}\`)`);
      }
      sections.push("");
    }

    return {
      content: [{ type: "text" as const, text: sections.join("\n") }],
    };
  }
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.resource(
  "asset",
  new ResourceTemplate("spark://assets/{slug}", { list: undefined }),
  async (uri, { slug }) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: formatAssetFull(
          await sparkApi<Asset>(`/assets/${slug as string}`)
        ),
      },
    ],
  })
);

server.resource(
  "catalog",
  new ResourceTemplate("spark://catalog/{type}", { list: undefined }),
  async (uri, { type }) => {
    const res = await sparkApi<PaginatedResponse<AssetListItem>>(
      `/assets?asset_type=${type as string}&sort=popular&page_size=20`
    );
    const text = res.items.map((a) => formatAssetSummary(a)).join("\n\n---\n\n");
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: text || "No assets found for this type.",
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[spark-mcp] Server running on stdio");
  console.error(`[spark-mcp] API: ${SPARK_API}`);
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((err) => {
  console.error("[spark-mcp] Fatal:", err);
  process.exit(1);
});
