import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const loadJson = async (relativePath) => JSON.parse(
  await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"),
);

test("release versions stay aligned", async () => {
  const [app, pkg] = await Promise.all([loadJson("app.json"), loadJson("package.json")]);
  assert.equal(app.version, "1.0.10");
  assert.equal(pkg.version, app.version);
});

test("permission dialog can save every declared Agent session submode", async () => {
  const manifest = await loadJson("manifest.json");
  assert.deepEqual(manifest.ui.host_api.agent.session, {
    auto: true,
    fixed: { client_ids: [] },
  });
  assert.deepEqual(manifest.ui.host_api.agent.tools, []);
});

test("the transcript helper remains bundled at the reviewed minimum version", async () => {
  const [app, manifest] = await Promise.all([loadJson("app.json"), loadJson("manifest.json")]);
  assert.equal(app.bundled_executas["youtube-transcript"].path, "./executas/my-first-anna-app");
  assert.deepEqual(manifest.required_executas, [{
    tool_id: "bundled:youtube-transcript",
    min_version: "1.0.4",
    version: "latest",
  }]);
  assert.deepEqual(manifest.ui.host_api.tools, ["required:bundled:youtube-transcript"]);
});
