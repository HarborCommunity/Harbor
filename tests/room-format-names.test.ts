import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// player-utils pulls in the player bridges, so run just this function from the real source.
function loadFormatNames(): (names: string[], language?: string) => string {
  const source = readFileSync("src/views/player/player-utils.ts", "utf8");
  const start = source.indexOf("export function formatNames(");
  const end = source.indexOf("\n}\n", start) + 3;
  const js = ts.transpileModule(source.slice(start, end).replace("export ", ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${js}; return formatNames;`)();
}

test("room name lists read naturally in the viewer's language", () => {
  const formatNames = loadFormatNames();
  assert.equal(formatNames([]), "");
  assert.equal(formatNames(["Sam"], "de"), "Sam");
  assert.equal(formatNames(["Sam", "Alex"]), "Sam and Alex");
  assert.equal(formatNames(["Sam", "Alex"], "de"), "Sam und Alex");
  assert.equal(formatNames(["Sam", "Alex", "Kai"], "es"), "Sam, Alex y Kai");
  assert.equal(formatNames(["Sam", "Alex"], "not a language!"), "Sam and Alex");
});
