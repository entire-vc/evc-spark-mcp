import { describe, expect, it } from "vitest";

import {
  assetUrl,
  authHeaders,
  configFromEnv,
  formatAssetFull,
  formatAssetSummary,
  formatEndpoints,
  sparkApi,
  trialFooter,
} from "../src/lib.js";
import { KEYED_CFG, TEST_CFG, asset, jsonResponse, listItem, mockFetch } from "./helpers.js";

describe("configFromEnv", () => {
  it("defaults to the public API and the /mcp/assets namespace", () => {
    const cfg = configFromEnv({} as NodeJS.ProcessEnv);
    expect(cfg.apiUrl).toBe("https://spark.entire.vc/api/v1");
    expect(cfg.siteUrl).toBe("https://spark.entire.vc");
    expect(cfg.assetsPath).toBe("/mcp/assets");
    expect(cfg.apiKey).toBeUndefined();
  });

  it("falls back to /assets when SPARK_MCP_MODE=false", () => {
    const cfg = configFromEnv({ SPARK_MCP_MODE: "false" } as NodeJS.ProcessEnv);
    expect(cfg.assetsPath).toBe("/assets");
  });

  it("keeps the MCP namespace for any other SPARK_MCP_MODE value", () => {
    const cfg = configFromEnv({ SPARK_MCP_MODE: "true" } as NodeJS.ProcessEnv);
    expect(cfg.assetsPath).toBe("/mcp/assets");
  });

  it("reads the API key and URL overrides from env", () => {
    const cfg = configFromEnv({
      SPARK_API_KEY: "sk-abc",
      SPARK_API_URL: "http://localhost:8002/api/v1",
      SPARK_SITE_URL: "http://localhost:5173",
    } as NodeJS.ProcessEnv);
    expect(cfg.apiKey).toBe("sk-abc");
    expect(cfg.apiUrl).toBe("http://localhost:8002/api/v1");
    expect(cfg.siteUrl).toBe("http://localhost:5173");
  });
});

describe("authHeaders", () => {
  it("sends no API key header in anonymous trial mode", () => {
    expect(authHeaders(TEST_CFG)).toEqual({ Accept: "application/json" });
  });

  it("sends X-API-Key when a key is configured", () => {
    expect(authHeaders(KEYED_CFG)).toEqual({
      Accept: "application/json",
      "X-API-Key": "sk-test-123",
    });
  });
});

describe("sparkApi", () => {
  it("GETs apiUrl + path and returns the parsed body", async () => {
    const spy = mockFetch(() => jsonResponse({ ok: true }));
    await expect(sparkApi(TEST_CFG, "/mcp/assets?q=x")).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBe("https://spark.test/api/v1/mcp/assets?q=x");
  });

  it("forwards the auth headers", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await sparkApi(KEYED_CFG, "/x");
    expect(spy.mock.calls[0][1]).toMatchObject({
      headers: { "X-API-Key": "sk-test-123" },
    });
  });

  it("turns 401 into an actionable 'key invalid' message with the signup URL", async () => {
    mockFetch(() => jsonResponse({ signup_url: "https://spark.test/create" }, 401));
    await expect(sparkApi(TEST_CFG, "/x")).rejects.toThrow(
      "Spark API key invalid. Get your key: https://spark.test/create"
    );
  });

  it("falls back to the default signup URL when 401 carries no body", async () => {
    mockFetch(() => new Response("nope", { status: 401 }));
    await expect(sparkApi(TEST_CFG, "/x")).rejects.toThrow(
      "Get your key: https://spark.entire.vc/create"
    );
  });

  it("turns 429 into a 'Daily limit reached' message carrying reset_at", async () => {
    mockFetch(() =>
      jsonResponse({ reset_at: "2026-07-11T00:00:00Z", topup_url: "https://spark.test/topup" }, 429)
    );
    await expect(sparkApi(TEST_CFG, "/x")).rejects.toThrow(
      "Daily limit reached (100 assets/day). Resets at 2026-07-11T00:00:00Z. Top up: https://spark.test/topup"
    );
  });

  it("surfaces the response body on a generic non-ok status", async () => {
    mockFetch(() => new Response("boom", { status: 500 }));
    await expect(sparkApi(TEST_CFG, "/x")).rejects.toThrow("Spark API 500: boom");
  });
});

describe("assetUrl", () => {
  it.each([
    ["agent", "agents"],
    ["skill", "skills"],
    ["prompt", "prompts"],
    ["prompt_chain", "prompt-chains"],
    ["mcp_connector", "mcps"],
    ["bundle", "bundles"],
  ])("maps type %s to the /%s route", (type, slugPath) => {
    expect(assetUrl(TEST_CFG, { type, slug: "s" })).toBe(`https://spark.test/${slugPath}/s`);
  });

  it("falls back to /assets for an unknown type", () => {
    expect(assetUrl(TEST_CFG, { type: "wat", slug: "s" })).toBe("https://spark.test/assets/s");
  });
});

describe("formatEndpoints", () => {
  it("returns nothing when the asset has no endpoints block", () => {
    expect(formatEndpoints(undefined, "  ")).toEqual([]);
  });

  it("returns nothing when there is neither a source url nor a gate", () => {
    expect(formatEndpoints({ original: { url: null, auth: "none", kind: "self_host" } }, "  ")).toEqual(
      []
    );
  });

  it("renders a self-host original", () => {
    const lines = formatEndpoints(
      { original: { url: "https://github.com/x", auth: "none", kind: "self_host" } },
      "  "
    );
    expect(lines).toEqual(["Endpoints:", "  original (self-host): https://github.com/x"]);
  });

  it("labels a hosted original as hosted", () => {
    const lines = formatEndpoints(
      { original: { url: "https://api.x.dev", auth: "oauth", kind: "hosted" } },
      "- "
    );
    expect(lines[1]).toBe("- original (hosted): https://api.x.dev");
  });

  it("renders both original and gate endpoints when the asset is in MCP Gate", () => {
    const lines = formatEndpoints(
      {
        original: { url: "https://github.com/x", auth: "none", kind: "self_host" },
        gate: {
          url: "https://gate.entire.vc/mcp/x",
          auth: "api_key",
          signup_url: "https://spark.test/create",
          billed: true,
        },
      },
      "  "
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(
      "  gate (billed, via Entire VC): https://gate.entire.vc/mcp/x — API key: https://spark.test/create"
    );
  });

  it("renders a gate-only asset without an original line", () => {
    const lines = formatEndpoints(
      {
        original: { url: null, auth: "none", kind: "self_host" },
        gate: {
          url: "https://gate.entire.vc/mcp/x",
          auth: "api_key",
          signup_url: "https://spark.test/create",
          billed: true,
        },
      },
      "  "
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("gate (billed, via Entire VC)");
  });
});

describe("formatAssetSummary", () => {
  it("omits the badge bracket when the asset is neither featured nor verified", () => {
    const out = formatAssetSummary(TEST_CFG, listItem());
    expect(out.split("\n")[0]).toBe("**Code Reviewer**");
  });

  it("renders both badges when featured and verified", () => {
    const out = formatAssetSummary(TEST_CFG, listItem({ is_featured: true, is_verified: true }));
    expect(out.split("\n")[0]).toBe("**Code Reviewer** [Featured, Verified]");
  });

  it("renders a single badge alone", () => {
    const out = formatAssetSummary(TEST_CFG, listItem({ is_verified: true }));
    expect(out.split("\n")[0]).toBe("**Code Reviewer** [Verified]");
  });

  it("shows N/A when combo_score is absent and the score when present", () => {
    expect(formatAssetSummary(TEST_CFG, listItem())).toContain("Score: N/A");
    expect(formatAssetSummary(TEST_CFG, listItem({ combo_score: 0.8765 }))).toContain("Score: 0.88");
  });

  it("appends the agent rating count only when there are agent ratings", () => {
    expect(formatAssetSummary(TEST_CFG, listItem())).toContain("(8 human)");
    expect(formatAssetSummary(TEST_CFG, listItem({ agent_rating_count: 3 }))).toContain(
      "(8 human + 3 agent)"
    );
    expect(formatAssetSummary(TEST_CFG, listItem({ agent_rating_count: 0 }))).toContain("(8 human)");
  });

  it("prices free vs paid assets", () => {
    expect(formatAssetSummary(TEST_CFG, listItem())).toContain("Price: Free");
    expect(
      formatAssetSummary(TEST_CFG, listItem({ pricing_type: "paid_credits", price_credits: 50 }))
    ).toContain("Price: 50 EVC");
  });

  it("drops empty tag lines and includes the permalink", () => {
    const out = formatAssetSummary(TEST_CFG, listItem());
    expect(out).not.toContain("AI Models:");
    expect(out).not.toContain("Domains:");
    expect(out).toContain("URL: https://spark.test/agents/code-reviewer");
  });

  it("lists AI models and domain child names", () => {
    const out = formatAssetSummary(
      TEST_CFG,
      listItem({
        ai_tags: ["claude", "gpt"],
        domain_tags: [{ parent_name: "Tech", child_name: "Development", child_slug: "dev" }],
      })
    );
    expect(out).toContain("AI Models: claude, gpt");
    expect(out).toContain("Domains: Development");
  });

  it("appends the endpoint block for a dual-endpoint asset", () => {
    const out = formatAssetSummary(
      TEST_CFG,
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
      })
    );
    expect(out).toContain("Endpoints:");
    expect(out).toContain("  original (self-host): https://github.com/x");
    expect(out).toContain("  gate (billed, via Entire VC): https://gate.entire.vc/mcp/x");
  });
});

describe("formatAssetFull", () => {
  it("renders the header block with the permalink", () => {
    const out = formatAssetFull(TEST_CFG, asset());
    expect(out).toContain("# Code Reviewer");
    expect(out).toContain("**Type:** agent");
    expect(out).toContain("**Rating:** 4.5/5 (8 ratings)");
    expect(out).toContain("**URL:** https://spark.test/agents/code-reviewer");
    expect(out).toContain("## Description");
  });

  it("renders an Endpoints section without the inline 'Endpoints:' header line", () => {
    const out = formatAssetFull(
      TEST_CFG,
      asset({
        endpoints: {
          original: { url: "https://github.com/x", auth: "none", kind: "hosted" },
          gate: {
            url: "https://gate.entire.vc/mcp/x",
            auth: "api_key",
            signup_url: "https://spark.test/create",
            billed: true,
          },
        },
      })
    );
    expect(out).toContain("## Endpoints");
    expect(out).toContain("- original (hosted): https://github.com/x");
    expect(out).toContain("- gate (billed, via Entire VC): https://gate.entire.vc/mcp/x");
    expect(out).not.toContain("\nEndpoints:\n");
  });

  it("omits the Endpoints section entirely when the asset has none", () => {
    expect(formatAssetFull(TEST_CFG, asset())).not.toContain("## Endpoints");
  });

  it("includes inline content, external source, files and bundle items when present", () => {
    const out = formatAssetFull(
      TEST_CFG,
      asset({
        inline_content: "You are a reviewer.",
        external_source_name: "VibeBaza",
        external_source_url: "https://github.com/vb",
        files: [{ filename: "prompt.md", size_bytes: 2048 }],
        bundle_items: [
          { asset_title: "Linter", asset_slug: "linter", asset_type: "skill", role: "primary" },
        ],
      })
    );
    expect(out).toContain("## Content\n\nYou are a reviewer.");
    expect(out).toContain("**Source:** VibeBaza (https://github.com/vb)");
    expect(out).toContain("- prompt.md (2.0 KB)");
    expect(out).toContain("- **Linter** (skill) — primary");
  });

  it("sorts prompt chain steps by order", () => {
    const out = formatAssetFull(
      TEST_CFG,
      asset({
        type: "prompt_chain",
        chain_steps: [
          { title: "Second", content: "b", order: 2 },
          { title: "First", content: "a", order: 1 },
        ],
      })
    );
    expect(out.indexOf("Step 1: First")).toBeLessThan(out.indexOf("Step 2: Second"));
  });
});

describe("trialFooter", () => {
  it("is empty for authenticated callers", () => {
    expect(trialFooter(10, false)).toBe("DELIBERATE-FAILURE-TO-PROVE-CI-GATE");
  });

  it("warns and shows the result count in trial mode", () => {
    expect(trialFooter(5, true)).toContain("Trial mode — showing 5/5 results");
    expect(trialFooter(5, true)).toContain("https://spark.entire.vc/create");
  });
});
