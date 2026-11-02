import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../src/lib/openapi.js";

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument("https://orble.test");
  const restock = doc.paths["/api/restock"];

  it("documents GET and POST on /api/restock", () => {
    expect(Object.keys(restock)).toEqual(["get", "post"]);
    expect(doc.servers).toEqual([{ url: "https://orble.test" }]);
  });

  it("lists the GET query parameters the handler reads", () => {
    const names = restock.get.parameters.map((p) => p.name);
    expect(names).toEqual(["key", "machine", "date", "isClearout"]);
  });

  it("describes every response slot field", () => {
    const slot = doc.components.schemas.RestockSlot.properties;
    for (const [name, field] of Object.entries(slot)) {
      expect(
        field.description || field.example,
        `${name} needs a description`,
      ).toBeTruthy();
    }
  });

  it("splits the POST body into the kitchen and machine forms", () => {
    const body = doc.components.schemas.RestockSubmit;
    expect(body.oneOf.map((branch) => branch.title)).toEqual([
      "SplitSubmit",
      "MachineSubmit",
    ]);
    expect(body.oneOf[0].properties.event.const).toBe("Split");
    expect(body.oneOf[1].properties.event.enum).toEqual([
      "Load",
      "Topoff",
      "Clearout",
    ]);
  });
});
