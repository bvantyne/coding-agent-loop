import { assert, describe, it } from "vitest";

import { CHUNK_TOKEN_LIMITS, chunkTypeScriptFile } from "./astChunker.ts";

function buildLargeMethod(name: string, repeat = 80): string {
  return [
    `${name}() {`,
    ...Array.from({ length: repeat }, (_, index) => `  const value${index} = "${"x".repeat(24)}";`),
    "  return 1;",
    "}",
  ].join("\n");
}

describe("chunkTypeScriptFile", () => {
  it("chunks an exported function with only relevant imports plus side-effect imports", () => {
    const chunks = chunkTypeScriptFile({
      filePath: "src/greet.ts",
      content: [
        'import { readFile } from "node:fs/promises";',
        'import { join } from "node:path";',
        'import "./setup";',
        "",
        "export function greet(name: string) {",
        '  return join("/tmp", name);',
        "}",
      ].join("\n"),
    });

    assert.lengthOf(chunks, 1);
    const [chunk] = chunks;
    assert.exists(chunk);
    assert.equal(chunk?.chunkType, "function");
    assert.deepEqual(chunk?.imports, ["node:path", "./setup"]);
    assert.deepEqual(chunk?.exports, ["greet"]);
    assert.equal(chunk?.startLine, 5);
    assert.equal(chunk?.endLine, 7);
    assert.include(chunk?.content ?? "", "// file: src/greet.ts");
    assert.include(chunk?.content ?? "", 'import { join } from "node:path";');
    assert.notInclude(chunk?.content ?? "", 'import { readFile } from "node:fs/promises";');
  });

  it("splits oversized classes at method boundaries", () => {
    const chunks = chunkTypeScriptFile({
      filePath: "src/BigThing.ts",
      content: [
        "export class BigThing {",
        buildLargeMethod("first"),
        "",
        buildLargeMethod("second"),
        "",
        buildLargeMethod("third"),
        "}",
      ].join("\n"),
    });

    assert.isAtLeast(chunks.length, 2);
    assert.isTrue(chunks.every((chunk) => chunk.chunkType === "class"));
    assert.isTrue(chunks.every((chunk) => chunk.exports.includes("BigThing")));
    assert.isTrue(chunks.every((chunk) => chunk.content.includes("export class BigThing")));
    assert.isTrue(chunks.every((chunk) => chunk.tokenCount <= CHUNK_TOKEN_LIMITS.max));
  });

  it("classifies service, layer, and schema-backed const definitions distinctly", () => {
    const chunks = chunkTypeScriptFile({
      filePath: "src/services/demo.ts",
      content: [
        'import { Effect, Layer, ServiceMap } from "effect";',
        'import { Schema } from "@effect/schema";',
        "",
        'export class DemoService extends ServiceMap.Service<DemoService, { readonly ping: () => string }>()("demo") {}',
        "",
        'export const DemoLayer = Layer.effect(DemoService, Effect.succeed({ ping: () => "pong" }));',
        "",
        "export const DemoModel = Schema.Struct({ name: Schema.String, age: Schema.Number });",
      ].join("\n"),
    });

    assert.deepEqual(
      chunks.map((chunk) => [chunk.chunkType, chunk.exports[0]]),
      [
        ["service", "DemoService"],
        ["layer", "DemoLayer"],
        ["const", "DemoModel"],
      ],
    );
  });

  it("treats TSX components as function chunks", () => {
    const chunks = chunkTypeScriptFile({
      filePath: "src/Widget.tsx",
      content: [
        'import { useState } from "react";',
        'import "./Widget.css";',
        "",
        "export const Widget = () => {",
        "  const [count] = useState(0);",
        "  return <div>{count}</div>;",
        "};",
      ].join("\n"),
    });

    assert.lengthOf(chunks, 1);
    const [chunk] = chunks;
    assert.equal(chunk?.chunkType, "function");
    assert.deepEqual(chunk?.imports, ["react", "./Widget.css"]);
    assert.deepEqual(chunk?.exports, ["Widget"]);
  });

  it("keeps re-export barrels cohesive with export and import metadata", () => {
    const chunks = chunkTypeScriptFile({
      filePath: "src/index.ts",
      content: ['export * from "./a";', 'export { b as bee } from "./b";'].join("\n"),
    });

    assert.lengthOf(chunks, 1);
    const [chunk] = chunks;
    assert.equal(chunk?.chunkType, "other");
    assert.deepEqual(chunk?.imports, ["./a", "./b"]);
    assert.sameMembers([...(chunk?.exports ?? [])], ["*", "bee"]);
  });

  it("produces deterministic ids and stable line ranges", () => {
    const input = {
      filePath: "src/stable.ts",
      content: ["export const alpha = 1;", "export const beta = 2;"].join("\n"),
    } as const;

    const first = chunkTypeScriptFile(input);
    const second = chunkTypeScriptFile(input);

    assert.deepEqual(
      first.map((chunk) => ({ id: chunk.id, startLine: chunk.startLine, endLine: chunk.endLine })),
      second.map((chunk) => ({ id: chunk.id, startLine: chunk.startLine, endLine: chunk.endLine })),
    );
  });
});
