/**
 * Tool-handler tests over a real MCP client<->server pair.
 *
 * The SDK, the McpServer and zod validation all run for real; only
 * `global.fetch` (the Spark HTTP API) is mocked — that is the one true
 * external boundary of this package.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SparkConfig } from "../src/lib.js";
import { createServer } from "../src/server.js";
import { KEYED_CFG, TEST_CFG, asset, jsonResponse, listItem, mockFetch, page } from "./helpers.js";

let client: Client;
let close: () => Promise<void>;

async function connect(cfg: SparkConfig = TEST_CFG) {
  const server = createServer(cfg);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  close = async () => {
    await client.close();
    await server.close();
  };
  return client;
}

/** Text of the first content block of a tool result. */
function text(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content.map((c) => c.text).join("\n");
}

/** The URL of the nth fetch call. */
function calledUrl(spy: ReturnType<typeof mockFetch>, n = 0): URL {
  return new URL(String(spy.mock.calls[n][0]));
}

afterEach(async () => {
  await close?.();
});

describe("tool registration", () => {
  beforeEach(() => mockFetch(() => jsonResponse({})));

  it("exposes exactly the seven documented tools", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_api_key_info",
      "get_asset",
      "get_asset_content",
      "list_categories",
      "list_popular",
      "search_assets",
      "submit_review",
    ]);
  });

  it("advertises trial mode in the search description when no key is set", async () => {
    const c = await connect(TEST_CFG);
    const { tools } = await c.listTools();
    const search = tools.find((t) => t.name === "search_assets")!;
    expect(search.description).toContain("Trial mode: limited to 5 results");
  });

  it("drops the trial notice when an API key is configured", async () => {
    const c = await connect(KEYED_CFG);
    const { tools } = await c.listTools();
    const search = tools.find((t) => t.name === "search_assets")!;
    expect(search.description).not.toContain("Trial mode");
  });

  it("rejects an unknown tool name with an MCP error result", async () => {
    const c = await connect();
    const res = await c.callTool({ name: "no_such_tool", arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Tool no_such_tool not found");
  });
});

describe("search_assets", () => {
  it("maps query to q, applies sort=combo and page_size defaults", async () => {
    const spy = mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    await c.callTool({ name: "search_assets", arguments: { query: "code review" } });

    const url = calledUrl(spy);
    expect(url.pathname).toBe("/api/v1/mcp/assets");
    expect(url.searchParams.get("q")).toBe("code review");
    expect(url.searchParams.get("sort")).toBe("combo");
    expect(url.searchParams.get("page_size")).toBe("10");
    expect(url.searchParams.has("job")).toBe(false);
  });

  it("forwards the job parameter for job-based ranking", async () => {
    const spy = mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    await c.callTool({
      name: "search_assets",
      arguments: { query: "python", job: "review Python code" },
    });
    expect(calledUrl(spy).searchParams.get("job")).toBe("review Python code");
  });

  it("forwards type and domain filters as asset_type and domain", async () => {
    const spy = mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    await c.callTool({
      name: "search_assets",
      arguments: { query: "x", type: "mcp_connector", domain: "development", sort: "rating", limit: 3 },
    });
    const url = calledUrl(spy);
    expect(url.searchParams.get("asset_type")).toBe("mcp_connector");
    expect(url.searchParams.get("domain")).toBe("development");
    expect(url.searchParams.get("sort")).toBe("rating");
    expect(url.searchParams.get("page_size")).toBe("3");
  });

  it("returns a helpful message instead of an empty list when nothing matches", async () => {
    mockFetch(() => jsonResponse(page([], { total: 0 })));
    const c = await connect();
    const res = await c.callTool({ name: "search_assets", arguments: { query: "zzz" } });
    expect(text(res)).toBe(
      'No assets found for "zzz". Try a different search term or remove filters.'
    );
  });

  it("renders results with the trial footer in anonymous mode", async () => {
    mockFetch(() => jsonResponse(page([listItem()], { total: 1 })));
    const c = await connect(TEST_CFG);
    const out = text(await c.callTool({ name: "search_assets", arguments: { query: "x" } }));
    expect(out).toContain("Found 1 assets (showing 1):");
    expect(out).toContain("1. **Code Reviewer**");
    expect(out).toContain("Trial mode — showing 1/5 results");
  });

  it("omits the trial footer for an authenticated caller", async () => {
    mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect(KEYED_CFG);
    const out = text(await c.callTool({ name: "search_assets", arguments: { query: "x" } }));
    expect(out).not.toContain("Trial mode");
  });

  it("keeps the trial footer when the server marks the response as a trial despite a key", async () => {
    mockFetch(() => jsonResponse(page([listItem()], { meta: { trial: true } })));
    const c = await connect(KEYED_CFG);
    const out = text(await c.callTool({ name: "search_assets", arguments: { query: "x" } }));
    expect(out).toContain("Trial mode");
  });

  it("renders the dual original+gate endpoints of a search hit", async () => {
    mockFetch(() =>
      jsonResponse(
        page([
          listItem({
            endpoints: {
              original: { url: "https://github.com/x", auth: "none", kind: "self_host" },
              gate: {
                url: "https://gate.entire.vc/mcp/x",
                auth: "api_key",
                signup_url: "https://spark.test/create",
                billed: true,
              },
            },
          }),
        ])
      )
    );
    const c = await connect();
    const out = text(await c.callTool({ name: "search_assets", arguments: { query: "x" } }));
    expect(out).toContain("original (self-host): https://github.com/x");
    expect(out).toContain("gate (billed, via Entire VC): https://gate.entire.vc/mcp/x");
  });

  it("surfaces a 429 rate limit to the client as a readable error", async () => {
    mockFetch(() => jsonResponse({ reset_at: "2026-07-11T00:00:00Z" }, 429));
    const c = await connect();
    const res = await c.callTool({ name: "search_assets", arguments: { query: "x" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Daily limit reached (100 assets/day)");
    expect(text(res)).toContain("Resets at 2026-07-11T00:00:00Z");
  });

  it("surfaces a 401 invalid-key error to the client", async () => {
    mockFetch(() => jsonResponse({ signup_url: "https://spark.test/create" }, 401));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "search_assets", arguments: { query: "x" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Spark API key invalid");
  });

  it("rejects a missing query via zod validation without calling the API", async () => {
    const spy = mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    const res = await c.callTool({ name: "search_assets", arguments: {} });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range limit", async () => {
    const spy = mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    const res = await c.callTool({ name: "search_assets", arguments: { query: "x", limit: 99 } });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unknown asset type", async () => {
    mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    const res = await c.callTool({ name: "search_assets", arguments: { query: "x", type: "robot" } });
    expect(res.isError).toBe(true);
  });
});

describe("get_asset / get_asset_content", () => {
  it("fetches the asset by slug under the MCP namespace", async () => {
    const spy = mockFetch(() => jsonResponse(asset()));
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset", arguments: { slug: "code-reviewer" } }));
    expect(calledUrl(spy).pathname).toBe("/api/v1/mcp/assets/code-reviewer");
    expect(out).toContain("# Code Reviewer");
  });

  it("honours SPARK_MCP_MODE=false by using the plain /assets namespace", async () => {
    const spy = mockFetch(() => jsonResponse(asset()));
    const c = await connect({ ...TEST_CFG, assetsPath: "/assets" });
    await c.callTool({ name: "get_asset", arguments: { slug: "x" } });
    expect(calledUrl(spy).pathname).toBe("/api/v1/assets/x");
  });

  it("returns inline content verbatim", async () => {
    mockFetch(() => jsonResponse(asset({ inline_content: "You are a reviewer." })));
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset_content", arguments: { slug: "x" } }));
    expect(out).toBe("You are a reviewer.");
  });

  it("concatenates prompt chain steps in order", async () => {
    mockFetch(() =>
      jsonResponse(
        asset({
          chain_steps: [
            { title: "Second", content: "b", order: 2 },
            { title: "First", content: "a", order: 1 },
          ],
        })
      )
    );
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset_content", arguments: { slug: "x" } }));
    expect(out).toBe("## Step 1: First\n\na\n\n---\n\n## Step 2: Second\n\nb");
  });

  it("falls back to the description when there is no inline content", async () => {
    mockFetch(() => jsonResponse(asset({ description_md: "Long description." })));
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset_content", arguments: { slug: "x" } }));
    expect(out).toBe("Long description.");
  });

  it("falls back to the short description when the body is empty too", async () => {
    mockFetch(() => jsonResponse(asset({ description_md: "", short_description: "Short." })));
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset_content", arguments: { slug: "x" } }));
    expect(out).toBe("Short.");
  });
});

describe("list_popular", () => {
  it("defaults to sort=combo and omits asset_type when no type is given", async () => {
    const spy = mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    const out = text(await c.callTool({ name: "list_popular", arguments: {} }));
    const url = calledUrl(spy);
    expect(url.searchParams.get("sort")).toBe("combo");
    expect(url.searchParams.get("page_size")).toBe("10");
    expect(url.searchParams.has("asset_type")).toBe(false);
    expect(out).toContain("Top 1 all assets (sort: combo):");
  });

  it("filters by type and echoes it in the heading", async () => {
    const spy = mockFetch(() => jsonResponse(page([listItem({ type: "skill" })])));
    const c = await connect();
    const out = text(await c.callTool({ name: "list_popular", arguments: { type: "skill" } }));
    expect(calledUrl(spy).searchParams.get("asset_type")).toBe("skill");
    expect(out).toContain("Top 1 skill assets (sort: combo):");
  });

  it("rejects a limit above the 20-item cap", async () => {
    mockFetch(() => jsonResponse(page([listItem()])));
    const c = await connect();
    const res = await c.callTool({ name: "list_popular", arguments: { limit: 21 } });
    expect(res.isError).toBe(true);
  });
});

describe("list_categories", () => {
  it("fetches ai tags and domains in parallel and renders both sections", async () => {
    const spy = mockFetch((url) => {
      if (url.endsWith("/taxonomy/ais")) return jsonResponse([{ slug: "claude", name: "Claude" }]);
      if (url.endsWith("/taxonomy/domains"))
        return jsonResponse([
          {
            parent_name: "Tech",
            parent_slug: "tech",
            children: [{ child_name: "Development", child_slug: "dev" }],
          },
        ]);
      throw new Error(`unexpected url ${url}`);
    });
    const c = await connect();
    const out = text(await c.callTool({ name: "list_categories", arguments: {} }));

    expect(spy).toHaveBeenCalledTimes(2);
    expect(out).toContain("## AI Tags");
    expect(out).toContain("- Claude (`claude`)");
    expect(out).toContain("### Tech");
    expect(out).toContain("- Development (`dev`)");
  });

  it("propagates a failure of either taxonomy call", async () => {
    mockFetch((url) =>
      url.endsWith("/taxonomy/domains")
        ? new Response("boom", { status: 500 })
        : jsonResponse([])
    );
    const c = await connect();
    const res = await c.callTool({ name: "list_categories", arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Spark API 500");
  });
});

describe("get_api_key_info", () => {
  it("tells an anonymous caller how to get a key, without hitting the API", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    const c = await connect(TEST_CFG);
    const out = text(await c.callTool({ name: "get_api_key_info", arguments: {} }));
    expect(out).toContain("No API key configured");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports usage for an authenticated caller", async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        prefix: "sk-abc",
        assets_served_today: 7,
        daily_limit: 100,
        credits: 250,
        reset_at: "2026-07-11T00:00:00Z",
      })
    );
    const c = await connect(KEYED_CFG);
    const out = text(await c.callTool({ name: "get_api_key_info", arguments: {} }));
    expect(calledUrl(spy).pathname).toBe("/api/v1/mcp/keys/me");
    expect(out).toContain("Key: sk-abc...");
    expect(out).toContain("Today: 7/100 assets");
    expect(out).toContain("Credits: 250");
  });
});

describe("submit_review", () => {
  const review = { slug: "code-reviewer", session_id: "sess-1", outcome: "success" };

  it("POSTs the review to the agent-review endpoint with the API key", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "r1", outcome: "success", created_at: "now" }, 201));
    const c = await connect(KEYED_CFG);
    const out = text(await c.callTool({ name: "submit_review", arguments: review }));

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe("https://spark.test/api/v1/mcp/assets/code-reviewer/agent-review");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": "sk-test-123" },
    });
    expect(JSON.parse(String(init!.body))).toEqual({ session_id: "sess-1", outcome: "success" });
    expect(out).toContain('✓ Review Submitted for "code-reviewer"');
    expect(out).toContain("ID: r1");
  });

  it("omits the API key header for an anonymous caller", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "r1", outcome: "success", created_at: "now" }, 201));
    const c = await connect(TEST_CFG);
    await c.callTool({ name: "submit_review", arguments: review });
    expect(spy.mock.calls[0][1]!.headers).not.toHaveProperty("X-API-Key");
  });

  it("includes only the optional scores that were supplied", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "r1", outcome: "partial", created_at: "now" }, 201));
    const c = await connect(KEYED_CFG);
    const out = text(
      await c.callTool({
        name: "submit_review",
        arguments: { ...review, outcome: "partial", value: 4, accuracy: 5 },
      })
    );
    expect(JSON.parse(String(spy.mock.calls[0][1]!.body))).toEqual({
      session_id: "sess-1",
      outcome: "partial",
      value: 4,
      accuracy: 5,
    });
    expect(out).toContain("Outcome: partial | Value: 4/5 | Accuracy: 5/5");
    expect(out).not.toContain("Reliability");
  });

  it("says Updated rather than Submitted when the review already existed (200)", async () => {
    mockFetch(() => jsonResponse({ id: "r1", outcome: "success", created_at: "now" }, 200));
    const c = await connect(KEYED_CFG);
    const out = text(await c.callTool({ name: "submit_review", arguments: review }));
    expect(out).toContain('✓ Review Updated for "code-reviewer"');
  });

  it("returns a friendly message (not an error) for an unknown slug", async () => {
    mockFetch(() => jsonResponse({ detail: "not found" }, 404));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "submit_review", arguments: { ...review, slug: "nope" } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('Asset "nope" not found. Check the slug.');
  });

  it("errors on any other non-ok status", async () => {
    mockFetch(() => new Response("boom", { status: 500 }));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "submit_review", arguments: review });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Review submit failed: 500");
  });

  it("rejects an out-of-range score before calling the API", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "submit_review", arguments: { ...review, value: 9 } });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an unknown outcome", async () => {
    mockFetch(() => jsonResponse({}));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "submit_review", arguments: { ...review, outcome: "meh" } });
    expect(res.isError).toBe(true);
  });
});

describe("resources", () => {
  it("renders an asset resource as markdown", async () => {
    mockFetch(() => jsonResponse(asset()));
    const c = await connect();
    const res = await c.readResource({ uri: "spark://assets/code-reviewer" });
    expect(res.contents[0].mimeType).toBe("text/markdown");
    expect(String(res.contents[0].text)).toContain("# Code Reviewer");
  });

  it("renders a catalog resource and falls back when the type is empty", async () => {
    mockFetch(() => jsonResponse(page([])));
    const c = await connect();
    const res = await c.readResource({ uri: "spark://catalog/agent" });
    expect(res.contents[0].text).toBe("No assets found for this type.");
  });
});
