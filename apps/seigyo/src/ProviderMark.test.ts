import { describe, expect, it } from "vitest";
import { getHostingProductKind } from "./ProviderMark";

describe("getHostingProductKind", () => {
  it.each([
    ["Workers", "edge"],
    ["Web Service", "service"],
    ["Payments", "payments"],
    ["PostgreSQL", "database"],
    ["Background Worker", "worker"],
  ] as const)("maps %s to the neutral %s glyph", (product, expected) => {
    expect(getHostingProductKind(product)).toBe(expected);
  });

  it("uses the web-service glyph for an unknown product", () => {
    expect(getHostingProductKind("Unknown platform product")).toBe("service");
  });
});
