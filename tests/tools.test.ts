/**
 * Tool-handler tests over a real MCP client<->server pair.
 *
 * The SDK, the McpServer and zod validation all run for real; only
 * `global.fetch` (the Spark HTTP API) is mocked — that is the one true
 * external boundary of this package.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";

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
      "report_outcome",
      "search_assets",
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
    // `/mcp/assets` reads `type`; sending only `asset_type` left the filter ignored.
    expect(url.searchParams.get("type")).toBe("mcp_connector");
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

// Contract fixtures: real responses of the Spark API routes, captured from the
// backend (evc-spark `mcp_access.py`) against Postgres — not hand-written. The mocks
// these tests used before modelled `Asset` whole, which is how every call from 1.1.0
// on crashed against the real `{asset, meta}` wrapper without a single red test.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const DETAIL = fixture("mcp-asset-detail.json");
const CONTENT = fixture("mcp-asset-content.json");
const CHAIN_DETAIL = fixture("mcp-chain-detail.json");
const CHAIN_CONTENT = fixture("mcp-chain-content.json");

describe("get_asset / get_asset_content", () => {
  it("unwraps the real /mcp/assets/{slug} detail and prints outcomes and a description", async () => {
    const spy = mockFetch(() => jsonResponse(DETAIL));
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset", arguments: { slug: "contract-clean-code" } }));
    expect(calledUrl(spy).pathname).toBe("/api/v1/mcp/assets/contract-clean-code");
    expect(out).toContain("# Clean Code");
    expect(out).toContain("**Outcomes:** no reports yet");
    // description_md is empty for this skill: the catalog description is shown instead.
    expect(out).toContain("## Description\n\nRefactor code for readability and maintainability.");
    expect(out).not.toContain("undefined");
  });

  it("prints a chain's step titles from the real detail", async () => {
    mockFetch(() => jsonResponse(CHAIN_DETAIL));
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset", arguments: { slug: "contract-blog-chain" } }));
    expect(out).toContain("### Step 1: Outline");
    expect(out).toContain("### Step 2: Draft");
    expect(out).not.toContain("undefined");
  });

  it("honours SPARK_MCP_MODE=false by using the plain, unwrapped /assets detail", async () => {
    const spy = mockFetch(() => jsonResponse(DETAIL.asset));
    const c = await connect({ ...TEST_CFG, assetsPath: "/assets" });
    const out = text(await c.callTool({ name: "get_asset", arguments: { slug: "x" } }));
    expect(calledUrl(spy).pathname).toBe("/api/v1/assets/x");
    expect(out).toContain("# Clean Code");
  });

  it("takes content through the content route and ends it with the receipt", async () => {
    const spy = mockFetch(() => jsonResponse(CONTENT));
    const c = await connect(KEYED_CFG);
    const out = text(await c.callTool({ name: "get_asset_content", arguments: { slug: "contract-clean-code" } }));

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe("https://spark.test/api/v1/mcp/assets/contract-clean-code/content");
    expect(init).toMatchObject({ method: "POST", headers: { "X-API-Key": "sk-test-123" } });
    // The host client's own clientInfo reaches the server as the harness.
    expect(JSON.parse(String(init!.body))).toMatchObject({ client_name: "test-client", client_version: "1.0.0" });
    expect(out).toBe(`${CONTENT.content}\n\n${CONTENT.receipt}`);
    expect(out).toMatch(/\n\napplication_id: [0-9A-Z]{26} — when you have applied this, call report_outcome\(/);
  });

  it("returns chain content in step order as the server rendered it", async () => {
    mockFetch(() => jsonResponse(CHAIN_CONTENT));
    const c = await connect();
    const out = text(await c.callTool({ name: "get_asset_content", arguments: { slug: "contract-blog-chain" } }));
    expect(out.startsWith("## Step 1: Outline\n\nWrite an outline.\n\n---\n\n## Step 2: Draft")).toBe(true);
  });

  it("sends the search whose results held the asset", async () => {
    const spy = mockFetch((url) =>
      url.includes("/content")
        ? jsonResponse(CONTENT)
        : jsonResponse(page([listItem({ slug: "contract-clean-code" })]))
    );
    const c = await connect();
    await c.callTool({ name: "search_assets", arguments: { query: "clean code" } });
    await c.callTool({ name: "search_assets", arguments: { query: "unrelated" } });
    // the second search returned the same mock page, so it is the one that "led to" it
    await c.callTool({ name: "get_asset_content", arguments: { slug: "contract-clean-code" } });
    expect(JSON.parse(String(spy.mock.calls[2][1]!.body)).search_query).toBe("unrelated");
  });

  it("sends no search when no search showed the asset", async () => {
    const spy = mockFetch(() => jsonResponse(CONTENT));
    const c = await connect();
    await c.callTool({ name: "get_asset_content", arguments: { slug: "contract-clean-code" } });
    expect(JSON.parse(String(spy.mock.calls[0][1]!.body)).search_query).toBeUndefined();
  });

  it("explains a paid asset that was not purchased (402)", async () => {
    mockFetch(() => jsonResponse({ detail: { error: "purchase_required" } }, 402));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "get_asset_content", arguments: { slug: "paid" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("paid asset and your account has not purchased it");
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

describe("report_outcome", () => {
  const APPROVED_NOTICE =
    "Fields `task`, `note`, `changed_what`, `failed_at`, `expected`, `got` are shown to the " +
    "asset's author. Do not include client data, private paths, keys, emails or URLs with " +
    "tokens. Your identity is never shown to the author.";
  const report = {
    application_id: "01M2JFTQ7ZYPXWF7J36X4MGX6G",
    result: "broke",
    task: "convert a PDF to markdown",
    failed_at: "step 2: pdftotext missing",
  };

  it("carries the approved privacy notice verbatim and the same required fields as the hosted server", async () => {
    mockFetch(() => jsonResponse({}));
    const c = await connect();
    const { tools } = await c.listTools();
    const tool = tools.find((t) => t.name === "report_outcome")!;
    expect(tool.description).toContain(APPROVED_NOTICE);
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(["application_id", "result", "task"]);
    expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual([
      "application_id",
      "changed_what",
      "expected",
      "failed_at",
      "got",
      "model",
      "note",
      "result",
      "task",
    ]);
  });

  it("POSTs to the application's outcome endpoint with the API key and prints the server's line", async () => {
    const spy = mockFetch(() =>
      jsonResponse({ message: "Outcome recorded: broke for application_id 01M2JFTQ7ZYPXWF7J36X4MGX6G" }, 201)
    );
    const c = await connect(KEYED_CFG);
    const out = text(await c.callTool({ name: "report_outcome", arguments: report }));

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(
      "https://spark.test/api/v1/mcp/applications/01M2JFTQ7ZYPXWF7J36X4MGX6G/outcome"
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": "sk-test-123" },
    });
    expect(JSON.parse(String(init!.body))).toEqual({
      result: "broke",
      task: "convert a PDF to markdown",
      failed_at: "step 2: pdftotext missing",
    });
    expect(out).toBe("Outcome recorded: broke for application_id 01M2JFTQ7ZYPXWF7J36X4MGX6G");
  });

  it("omits the API key header for an anonymous caller", async () => {
    const spy = mockFetch(() => jsonResponse({ message: "ok" }, 201));
    const c = await connect(TEST_CFG);
    await c.callTool({ name: "report_outcome", arguments: report });
    expect(spy.mock.calls[0][1]!.headers).not.toHaveProperty("X-API-Key");
  });

  it("passes the server's named refusal through as a tool error", async () => {
    mockFetch(() =>
      jsonResponse({ detail: { error: "receipt_not_found", message: "no content fetch with this application_id" } }, 422)
    );
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "report_outcome", arguments: report });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe("receipt_not_found: no content fetch with this application_id");
  });

  it("errors on any other non-ok status", async () => {
    mockFetch(() => new Response("boom", { status: 500 }));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "report_outcome", arguments: report });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Outcome report failed: 500");
  });

  it("rejects an unknown result before calling the API", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    const c = await connect(KEYED_CFG);
    const res = await c.callTool({ name: "report_outcome", arguments: { ...report, result: "partial" } });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("resources", () => {
  it("renders an asset resource as markdown", async () => {
    mockFetch(() => jsonResponse({ asset: asset(), meta: { trial: true } }));
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
