import assert from "node:assert/strict";
import test from "node:test";

import { runProfileCli } from "./cli.js";

test("rejects an unknown CLI command without starting an interactive prompt", async () => {
  await assert.rejects(
    () => runProfileCli(["unknown"]),
    /Используйте profiles:list/,
  );
});
