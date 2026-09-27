import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedSource, isVacancySource } from "./source-filter.js";

test("accepts groups and channels but rejects private dialogs", () => {
  assert.equal(isVacancySource({ isGroup: true, isChannel: false }), true);
  assert.equal(isVacancySource({ isGroup: undefined, isChannel: true }), true);
  assert.equal(isVacancySource({ isGroup: false, isChannel: false }), false);
});

test("applies source allowlist and denylist by stable chat ID", () => {
	assert.equal(isAllowedSource("-1001", { mode: "all", chatIds: [] }), true);
	assert.equal(isAllowedSource("-1001", { mode: "allowlist", chatIds: ["-1001"] }), true);
	assert.equal(isAllowedSource("-1002", { mode: "allowlist", chatIds: ["-1001"] }), false);
	assert.equal(isAllowedSource("-1001", { mode: "denylist", chatIds: ["-1001"] }), false);
});
