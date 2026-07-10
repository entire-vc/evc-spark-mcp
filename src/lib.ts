/**
 * Pure helpers and types for the Spark MCP server.
 *
 * Everything here is side-effect free and takes an explicit `SparkConfig`
 * instead of reading `process.env` at module load, so it can be unit tested.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SparkConfig {
  /** Base URL of the Spark REST API, e.g. https://spark.entire.vc/api/v1 */
  apiUrl: string;
  /** Base URL of the public site, used to build asset permalinks. */
  siteUrl: string;
  /** API key, or undefined for the anonymous trial. */
  apiKey?: string;
  /** Asset collection path — `/mcp/assets` unless MCP mode is disabled. */
  assetsPath: string;
}

/**
 * Build the config from an environment. `SPARK_MCP_MODE=false` falls back to the
 * plain `/assets` namespace for local dev against a backend without MCP routes.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SparkConfig {
  const useMcpNamespace = env.SPARK_MCP_MODE !== "false";
  return {
    apiUrl: env.SPARK_API_URL || "https://spark.entire.vc/api/v1",
    siteUrl: env.SPARK_SITE_URL || "https://spark.entire.vc",
    apiKey: env.SPARK_API_KEY,
    assetsPath: useMcpNamespace ? "/mcp/assets" : "/assets",
  };
}

export const TYPE_SLUG: Record<string, string> = {
  agent: "agents",
  skill: "skills",
  prompt: "prompts",
  prompt_chain: "prompt-chains",
  mcp_connector: "mcps",
  bundle: "bundles",
};

// ---------------------------------------------------------------------------
// Types (matching Spark API responses)
// ---------------------------------------------------------------------------

/** Where a tool can be reached. `gate` is absent unless the tool is in MCP Gate. */
export interface AssetEndpoints {
  original: {
    url: string | null;
    auth: string;
    kind: "self_host" | "hosted";
  };
  gate?: {
    url: string;
    auth: string;
    signup_url: string;
    billed: boolean;
    server_id?: string | null;
  };
}

export interface AssetListItem {
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
  combo_score?: number;
  agent_rating_avg?: number;
  agent_rating_count?: number;
  is_featured: boolean;
  is_verified: boolean;
  created_at: string;
  endpoints?: AssetEndpoints;
}

export interface Asset extends AssetListItem {
  description_md: string;
  inline_content?: string | null;
  version: string;
  files: { filename: string; size_bytes: number }[];
  bundle_items?: { asset_title: string; asset_slug: string; asset_type: string; role: string }[];
  chain_steps?: { title: string; content: string; order: number }[];
  external_source_name?: string | null;
  external_source_url?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  meta?: { trial?: boolean };
}

export interface AiTag {
  slug: string;
  name: string;
}

export interface DomainGroup {
  parent_name: string;
  parent_slug: string;
  children: { child_name: string; child_slug: string }[];
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export function authHeaders(cfg: SparkConfig): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (cfg.apiKey) h["X-API-Key"] = cfg.apiKey;
  return h;
}

export async function sparkApi<T = unknown>(cfg: SparkConfig, path: string): Promise<T> {
  const url = `${cfg.apiUrl}${path}`;
  const res = await fetch(url, { headers: authHeaders(cfg) });

  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(
      `Spark API key invalid. Get your key: ${body.signup_url || "https://spark.entire.vc/create"}`
    );
  }
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(
      `Daily limit reached (100 assets/day). Resets at ${body.reset_at}. Top up: ${body.topup_url || "https://spark.entire.vc"}`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Spark API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function assetUrl(cfg: SparkConfig, asset: { type: string; slug: string }): string {
  const slug = TYPE_SLUG[asset.type] || "assets";
  return `${cfg.siteUrl}/${slug}/${asset.slug}`;
}

/** Render the original/gate endpoint pair. Empty array when the asset carries none. */
export function formatEndpoints(e: AssetEndpoints | undefined, indent: string): string[] {
  if (!e) return [];
  const lines = ["Endpoints:"];
  if (e.original.url) {
    const kind = e.original.kind === "hosted" ? "hosted" : "self-host";
    lines.push(`${indent}original (${kind}): ${e.original.url}`);
  }
  if (e.gate) {
    lines.push(
      `${indent}gate (billed, via Entire VC): ${e.gate.url} — API key: ${e.gate.signup_url}`
    );
  }
  // Only the header would remain if the asset has neither a source url nor a gate entry.
  return lines.length > 1 ? lines : [];
}

export function formatAssetSummary(cfg: SparkConfig, a: AssetListItem): string {
  const badges = [a.is_featured ? "Featured" : "", a.is_verified ? "Verified" : ""]
    .filter(Boolean)
    .join(", ");
  const badgeStr = badges ? ` [${badges}]` : "";

  const agentRatingStr = (a.agent_rating_count ?? 0) > 0 ? ` + ${a.agent_rating_count} agent` : "";

  return [
    `**${a.title}**${badgeStr}`,
    `Score: ${a.combo_score?.toFixed(2) ?? "N/A"} | Rating: ${a.rating_avg.toFixed(1)}/5 (${a.rating_count} human${agentRatingStr}) | Downloads: ${a.downloads_count}`,
    `${a.short_description}`,
    `Price: ${a.pricing_type === "free" ? "Free" : `${a.price_credits} EVC`}`,
    a.ai_tags.length ? `AI Models: ${a.ai_tags.join(", ")}` : "",
    a.domain_tags.length
      ? `Domains: ${a.domain_tags.map((d) => d.child_name).join(", ")}`
      : "",
    `URL: ${assetUrl(cfg, a)}`,
    ...formatEndpoints(a.endpoints, "  "),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatAssetFull(cfg: SparkConfig, a: Asset): string {
  const sections: string[] = [
    `# ${a.title}`,
    "",
    `**Type:** ${a.type}`,
    `**Rating:** ${a.rating_avg.toFixed(1)}/5 (${a.rating_count} ratings)`,
    `**Downloads:** ${a.downloads_count}`,
    `**Price:** ${a.pricing_type === "free" ? "Free" : `${a.price_credits} EVC`}`,
    `**Version:** ${a.version}`,
    `**URL:** ${assetUrl(cfg, a)}`,
  ];

  if (a.ai_tags.length) {
    sections.push(`**AI Models:** ${a.ai_tags.join(", ")}`);
  }
  if (a.domain_tags.length) {
    sections.push(`**Domains:** ${a.domain_tags.map((d) => d.child_name).join(", ")}`);
  }
  if (a.external_source_name) {
    sections.push(
      `**Source:** ${a.external_source_name}${a.external_source_url ? ` (${a.external_source_url})` : ""}`
    );
  }

  const endpointLines = formatEndpoints(a.endpoints, "- ");
  if (endpointLines.length) {
    sections.push("", "## Endpoints", "", ...endpointLines.slice(1));
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

export function trialFooter(count: number, isTrial: boolean): string {
  if (!isTrial) return "";
  return `\n\n⚠️ Trial mode — showing ${count}/5 results. Set SPARK_API_KEY for full access: https://spark.entire.vc/create`;
}
