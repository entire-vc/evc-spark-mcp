import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validatePlugin(root) {
  root = resolve(root);
  const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const plugin = readJson(".cursor-plugin/plugin.json");
  const server = readJson("server.json");
  assert.equal(plugin.name, "spark");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.version, server.version, "Plugin version must match server.json");
  for (const field of ["description", "homepage", "repository", "license"]) {
    assert.ok(typeof plugin[field] === "string" && plugin[field].trim(), `Missing ${field}`);
  }
  assert.equal(plugin.license, "MIT");
  assert.ok(plugin.author?.name);
  assert.ok(Array.isArray(plugin.keywords) && plugin.keywords.length);

  const component = (path, directory) => {
    assert.ok(typeof path === "string" && path.startsWith("./") && !isAbsolute(path), "Component path must be relative");
    const target = resolve(root, path);
    assert.ok(!relative(root, target).startsWith(".."), "Component path must stay inside the plugin");
    assert.equal(statSync(target).isDirectory(), directory, `Wrong component type: ${path}`);
    return target;
  };
  const skills = component(plugin.skills, true);
  component(plugin.mcpServers, false);
  const skill = readFileSync(resolve(skills, "use-spark/SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: use-spark\ndescription: .+\n---\n/);
  const mcp = readJson(plugin.mcpServers);
  readJson(".mcp.json");
  assert.deepEqual(
    readFileSync(resolve(root, ".mcp.json")),
    readFileSync(resolve(root, "mcp.json")),
    ".mcp.json must match mcp.json byte for byte",
  );
  const remote = server.remotes.find((remote) => remote.type === "streamable-http");
  assert.equal(mcp.mcpServers.spark.url, "https://spark.entire.vc/mcp/");
  assert.equal(mcp.mcpServers.spark.url, remote.url);
  assert.deepEqual(mcp.mcpServers.spark.headers, { "X-API-Key": "${env:SPARK_API_KEY}" });
  assert.ok(remote.headers.some((header) => header.name === "X-API-Key" && header.isRequired === false));
  return plugin;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plugin = validatePlugin(process.argv[2] ?? ".");
  console.log(`Cursor plugin ${plugin.name} ${plugin.version}: OK`);
}
