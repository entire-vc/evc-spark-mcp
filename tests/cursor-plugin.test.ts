import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validatePlugin } from "../scripts/validate-cursor-plugin.mjs";

const root = resolve(import.meta.dirname, "..");
const copies: string[] = [];
function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), "spark-cursor-test-"));
  copies.push(dir);
  for (const path of [".cursor-plugin", "mcp.json", ".mcp.json", "server.json", "skills"]) {
    cpSync(resolve(root, path), resolve(dir, path), { recursive: true });
  }
  return dir;
}
function changeManifest(dir: string, change: (plugin: Record<string, unknown>) => void) {
  const file = resolve(dir, ".cursor-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(file, "utf8"));
  change(plugin);
  writeFileSync(file, JSON.stringify(plugin));
}
afterEach(() => copies.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("Cursor plugin distribution", () => {
  it("parses the shipped manifests and resolves their components", () => {
    expect(validatePlugin(root).name).toBe("spark");
  });
  it("rejects an injected version mismatch (negative control)", () => {
    const dir = fixture();
    changeManifest(dir, (plugin) => { plugin.version = "0.0.0"; });
    expect(() => validatePlugin(dir)).toThrow("Plugin version must match server.json");
  });
  it.each(["/tmp/skills", "./../skills", "./missing-skills"])("rejects an invalid component path: %s", (path) => {
    const dir = fixture();
    changeManifest(dir, (plugin) => { plugin.skills = path; });
    expect(() => validatePlugin(dir)).toThrow();
  });
  it("rejects a malformed MCP config", () => {
    const dir = fixture();
    writeFileSync(resolve(dir, "mcp.json"), "{");
    expect(() => validatePlugin(dir)).toThrow();
  });
  it("rejects a malformed auto-detected MCP config", () => {
    const dir = fixture();
    writeFileSync(resolve(dir, ".mcp.json"), "{");
    expect(() => validatePlugin(dir)).toThrow();
  });
  it("rejects an injected auto-detection config mismatch (negative control)", () => {
    const dir = fixture();
    const path = resolve(dir, ".mcp.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.mcpServers.spark.url = "https://example.com/mcp/";
    writeFileSync(path, JSON.stringify(config));
    expect(() => validatePlugin(dir)).toThrow(".mcp.json must match mcp.json byte for byte");
  });
  it("rejects an embedded credential", () => {
    const dir = fixture();
    const path = resolve(dir, "mcp.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.mcpServers.spark.headers["X-API-Key"] = "not-an-environment-reference";
    writeFileSync(path, JSON.stringify(config));
    expect(() => validatePlugin(dir)).toThrow();
  });
});
