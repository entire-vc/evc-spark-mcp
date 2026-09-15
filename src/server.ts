/**
 * MCP server construction — tools and resources.
 *
 * `createServer(cfg)` returns a fully wired McpServer that has not been
 * connected to any transport. Tests link it to an InMemoryTransport; the
 * binary (src/index.ts) links it to stdio.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  type Asset,
  type AssetListItem,
  type AiTag,
  type DomainGroup,
  type PaginatedResponse,
  type SparkConfig,
  formatAssetFull,
  formatAssetSummary,
  sparkApi,
  trialFooter,
} from "./lib.js";

export const SERVER_NAME = "spark-mcp";
export const SERVER_VERSION = "1.2.0";

const OUTCOME_RESULTS = [
  "applied_as_is",
  "applied_with_changes",
  "broke",
  "not_applicable",
] as const;

// Approved verbatim on #0f9f6735 item 2 (15.09.2026). Identical to PRIVACY_NOTICE in the
// hosted server (backend/app/services/outcome_reports.py) — the two servers drifted once.
export const PRIVACY_NOTICE =
  "Fields `task`, `note`, `changed_what`, `failed_at`, `expected`, `got` are shown to " +
  "the asset's author. Do not include client data, private paths, keys, emails or URLs " +
  "with tokens. Your identity is never shown to the author.";

export const REPORT_OUTCOME_DESCRIPTION =
  "Report what happened when you applied an asset you fetched with get_asset_content. " +
  "Call it once you know: applied as is, applied with changes, broke, or not applicable. " +
  "The next agent choosing this asset reads the outcomes in search results. " +
  "Reports made with an API key count; anonymous ones are stored as unverified. " +
  "Calling again with the same application_id updates your report.\n\n" +
  PRIVACY_NOTICE;

const ASSET_TYPES = [
  "agent",
  "skill",
  "prompt",
  "prompt_chain",
  "mcp_connector",
  "bundle",
] as const;

export function createServer(cfg: SparkConfig): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  const searchTrialNotice = !cfg.apiKey
    ? " [Trial mode: limited to 5 results. Set SPARK_API_KEY for full access: https://spark.entire.vc/create]"
    : "";

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  server.tool(
    "search_assets",
    `Search the Spark AI assets marketplace. Returns matching agents, skills, prompts, MCP connectors, and bundles.${searchTrialNotice}`,
    {
      query: z.string().describe("Search query (title, description)"),
      job: z
        .string()
        .optional()
        .describe(
          "Job/task the agent is trying to accomplish. Enables job-based relevance ranking (e.g. 'review Python code', 'generate marketing copy', 'analyze data'). Recommended for agent use."
        ),
      type: z.enum(ASSET_TYPES).optional().describe("Filter by asset type"),
      domain: z
        .string()
        .optional()
        .describe("Filter by domain slug (e.g. 'development', 'marketing')"),
      sort: z
        .enum(["combo", "popular", "newest", "rating"])
        .default("combo")
        .describe("Sort order. 'combo' = combined quality+ratings score (default, recommended)."),
      limit: z.number().min(1).max(50).default(10).describe("Number of results (1-50, default 10)"),
    },
    async ({ query, job, type, domain, sort, limit }) => {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("page_size", String(limit));
      params.set("sort", sort);
      if (job) params.set("job", job);
      if (type) params.set("asset_type", type);
      if (domain) params.set("domain", domain);

      const res = await sparkApi<PaginatedResponse<AssetListItem>>(
        cfg,
        `${cfg.assetsPath}?${params.toString()}`
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

      const isTrial = !cfg.apiKey || res.meta?.trial === true;
      const text =
        [
          `Found ${res.total} assets (showing ${res.items.length}):`,
          "",
          ...res.items.map((a, i) => `${i + 1}. ${formatAssetSummary(cfg, a)}`),
        ].join("\n") + trialFooter(res.items.length, isTrial);

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "get_asset",
    "Get full details of a Spark asset by its slug. Returns description, content, files, outcome reports, and more.",
    {
      slug: z.string().describe("Asset slug (e.g. 'vb-seo-expert', 'vb-python-expert')"),
    },
    async ({ slug }) => {
      const asset = await sparkApi<Asset>(cfg, `${cfg.assetsPath}/${slug}`);
      return {
        content: [{ type: "text" as const, text: formatAssetFull(cfg, asset) }],
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
      const asset = await sparkApi<Asset>(cfg, `${cfg.assetsPath}/${slug}`);

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
    "List the most popular Spark assets. Defaults to combined quality+ratings score (combo). Great for discovering top-rated AI tools.",
    {
      type: z.enum(ASSET_TYPES).optional().describe("Filter by asset type"),
      sort: z
        .enum(["combo", "popular", "newest", "rating"])
        .default("combo")
        .describe("Sort order. 'combo' = combined quality+ratings score (default)."),
      limit: z.number().min(1).max(20).default(10).describe("Number of results (1-20, default 10)"),
    },
    async ({ type, sort, limit }) => {
      const params = new URLSearchParams();
      params.set("sort", sort);
      params.set("page_size", String(limit));
      if (type) params.set("asset_type", type);

      const res = await sparkApi<PaginatedResponse<AssetListItem>>(
        cfg,
        `${cfg.assetsPath}?${params.toString()}`
      );

      const text = [
        `Top ${res.items.length} ${type || "all"} assets (sort: ${sort}):`,
        "",
        ...res.items.map((a, i) => `${i + 1}. ${formatAssetSummary(cfg, a)}`),
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
        sparkApi<AiTag[]>(cfg, "/taxonomy/ais"),
        sparkApi<DomainGroup[]>(cfg, "/taxonomy/domains"),
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

  server.tool(
    "get_api_key_info",
    "Check your Spark API key status and daily usage. Shows how many assets you've served today and your remaining quota.",
    {},
    async () => {
      if (!cfg.apiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No API key configured. Get one free: https://spark.entire.vc/create\nSet SPARK_API_KEY env var to enable full access (100 assets/day free).",
            },
          ],
        };
      }
      const info = await sparkApi<{
        prefix: string;
        assets_served_today: number;
        daily_limit: number;
        credits: number;
        reset_at: string;
      }>(cfg, "/mcp/keys/me");
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Key: ${info.prefix}...`,
              `Today: ${info.assets_served_today}/${info.daily_limit} assets`,
              `Credits: ${info.credits}`,
              `Reset at: ${info.reset_at}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "report_outcome",
    REPORT_OUTCOME_DESCRIPTION,
    {
      application_id: z
        .string()
        .describe("The application_id printed at the end of get_asset_content."),
      result: z
        .enum(OUTCOME_RESULTS)
        .describe(
          "applied_as_is: applied without edits, task solved. " +
            "applied_with_changes: had to edit it, then solved (requires changed_what). " +
            "broke: tried to apply and it failed (requires failed_at). " +
            "not_applicable: read it and did not apply, it does something else " +
            "(requires expected and got)."
        ),
      task: z.string().describe("What you were trying to do, one phrase (≤ 200)."),
      changed_what: z
        .string()
        .optional()
        .describe("applied_with_changes: what you changed (≤ 200)."),
      failed_at: z
        .string()
        .optional()
        .describe(
          "broke: the step, tool or command that failed, and the error class (≤ 200)."
        ),
      expected: z
        .string()
        .optional()
        .describe("not_applicable: what you were looking for (≤ 200)."),
      got: z.string().optional().describe("not_applicable: what it actually does (≤ 200)."),
      note: z.string().optional().describe("Anything else worth knowing (≤ 300)."),
      model: z
        .string()
        .optional()
        .describe("The model you run on, if you know it. Shown, never ranked."),
    },
    async ({ application_id, ...report }) => {
      const res = await fetch(
        `${cfg.apiUrl}/mcp/applications/${encodeURIComponent(application_id)}/outcome`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(cfg.apiKey ? { "X-API-Key": cfg.apiKey } : {}),
          },
          body: JSON.stringify(report),
        }
      );

      if (res.status === 422 || res.status === 401) {
        // The server names the reason ({detail: {error, message}}); pass it on unchanged
        // so both servers refuse in the same words.
        const body = (await res.json().catch(() => ({}))) as {
          detail?: { error?: string; message?: string } | unknown;
        };
        const d = body.detail as { error?: string; message?: string } | undefined;
        const reason =
          d && typeof d === "object" && d.error
            ? `${d.error}: ${d.message ?? ""}`.trim()
            : `report refused: ${res.status}`;
        return { isError: true, content: [{ type: "text" as const, text: reason }] };
      }
      if (!res.ok) {
        throw new Error(`Outcome report failed: ${res.status}`);
      }

      const data = (await res.json()) as { message: string };
      return { content: [{ type: "text" as const, text: data.message }] };
    }
  );

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  server.resource(
    "asset",
    new ResourceTemplate("spark://assets/{slug}", { list: undefined }),
    async (uri, { slug }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: formatAssetFull(cfg, await sparkApi<Asset>(cfg, `${cfg.assetsPath}/${slug as string}`)),
        },
      ],
    })
  );

  server.resource(
    "catalog",
    new ResourceTemplate("spark://catalog/{type}", { list: undefined }),
    async (uri, { type }) => {
      const res = await sparkApi<PaginatedResponse<AssetListItem>>(
        cfg,
        `${cfg.assetsPath}?asset_type=${type as string}&sort=combo&page_size=20`
      );
      const text = res.items.map((a) => formatAssetSummary(cfg, a)).join("\n\n---\n\n");
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

  return server;
}
