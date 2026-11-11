import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../src/lib/openapi.js";

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument("https://orble.test");

  it("documents every restock route with its method", () => {
    expect(Object.keys(doc.paths["/api/restock-data"])).toEqual(["get"]);
    expect(Object.keys(doc.paths["/api/restock-submit"])).toEqual(["post"]);
    expect(doc.servers).toEqual([{ url: "https://orble.test" }]);
  });

  it("lists the GET query parameters the handler reads", () => {
    const names = doc.paths["/api/restock-data"].get.parameters.map(
      (p) => p.name,
    );
    expect(names).toEqual(["key", "machine", "date", "mode"]);
  });

  it("describes every response field", () => {
    const slot = doc.components.schemas.RestockSlot.properties;
    for (const [name, field] of Object.entries(slot)) {
      expect(
        field.description || field.example,
        `${name} needs a description`,
      ).toBeTruthy();
    }
  });
});
