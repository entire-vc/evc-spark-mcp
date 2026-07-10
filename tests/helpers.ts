import { vi } from "vitest";

import type { Asset, AssetListItem, SparkConfig } from "../src/lib.js";

export const TEST_CFG: SparkConfig = {
  apiUrl: "https://spark.test/api/v1",
  siteUrl: "https://spark.test",
  apiKey: undefined,
  assetsPath: "/mcp/assets",
};

export const KEYED_CFG: SparkConfig = { ...TEST_CFG, apiKey: "sk-test-123" };

/** Minimal but complete AssetListItem; override only what a test cares about. */
export function listItem(over: Partial<AssetListItem> = {}): AssetListItem {
  return {
    id: "a1",
    type: "agent",
    title: "Code Reviewer",
    slug: "code-reviewer",
    short_description: "Reviews your code.",
    ai_tags: [],
    domain_tags: [],
    pricing_type: "free",
    price_credits: 0,
    downloads_count: 42,
    rating_avg: 4.5,
    rating_count: 8,
    is_featured: false,
    is_verified: false,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export function asset(over: Partial<Asset> = {}): Asset {
  return {
    ...listItem(),
    description_md: "Full description.",
    version: "1.0.0",
    files: [],
    ...over,
  };
}

/**
 * Install a `global.fetch` mock.
 *
 * mock: external boundary — the Spark HTTP API is the only true external
 * dependency of this package (§1o). The MCP SDK and server are exercised for real.
 */
export function mockFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    impl(String(input), init)
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A paginated envelope around the given items. */
export function page<T>(items: T[], over: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, page_size: items.length, ...over };
}
