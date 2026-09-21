import { describe, expect, it } from "vitest";
import { contextPrefixTokens, estimateTextTokens } from "./context-prefix.js";

describe("context prefix token estimate", () => {
  it("uses the runtime's four-characters-per-token heuristic", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcde")).toBe(2);
  });

  it("adds the system prompt and the serialized tool schemas", () => {
    const prompt = "p".repeat(400);
    const tools = [{ name: "Read", parameters: { type: "object" } }];
    const schemaTokens = Math.ceil(JSON.stringify(tools).length / 4);

    expect(contextPrefixTokens(prompt, tools)).toBe(100 + schemaTokens);
    expect(contextPrefixTokens(prompt, undefined)).toBe(100);
    expect(contextPrefixTokens(undefined, tools)).toBe(schemaTokens);
    expect(contextPrefixTokens(undefined, [])).toBe(0);
  });

  it("falls back to a sentinel when a schema cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(contextPrefixTokens(undefined, [circular])).toBe(
      estimateTextTokens("[unserializable]"),
    );
  });
});
