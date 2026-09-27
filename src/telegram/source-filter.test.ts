import assert from "node:assert/strict";
import test from "node:test";

import { isVacancySource } from "./source-filter.js";

test("accepts groups and channels but rejects private dialogs", () => {
  assert.equal(isVacancySource({ isGroup: true, isChannel: false }), true);
  assert.equal(isVacancySource({ isGroup: undefined, isChannel: true }), true);
  assert.equal(isVacancySource({ isGroup: false, isChannel: false }), false);
});
