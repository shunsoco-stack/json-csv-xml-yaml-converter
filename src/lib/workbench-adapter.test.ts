import { describe, expect, it } from "vitest";
import { buildWorkbenchPipeline, runWorkbench } from "./workbench-adapter";
import type { JsonSchema } from "./types";

describe("workbench adapter", () => {
  it("expands a combined GUI mapping into map, default and type steps", () => {
    const steps = buildWorkbenchPipeline([
      {
        id: "customer-map",
        label: "Customer mapping",
        kind: "mapping",
        preserveUnmapped: false,
        fields: [
          { source: "customer_name", target: "customerName", targetType: "string" },
          { source: "customer.address.city", target: "address.cityName", required: true },
          { source: "amount", target: "amount", targetType: "number", defaultValue: 0, defaultWhen: "empty" },
          { source: "ignored", target: "ignored", enabled: false },
        ],
      },
    ]);
    expect(steps.map((step) => step.id)).toEqual([
      "customer-map",
      "customer-map:defaults",
      "customer-map:types",
    ]);
    expect(steps[0].operation).toMatchObject({
      type: "map",
      preserveUnmapped: false,
      mappings: [
        { sourcePath: "customer_name", targetPath: "customerName" },
        { sourcePath: "customer.address.city", targetPath: "address.cityName", required: true },
        { sourcePath: "amount", targetPath: "amount", defaultValue: 0 },
      ],
    });
  });

  it("builds ordered extraction, filter, flatten, default, type and selection steps", () => {
    const steps = buildWorkbenchPipeline([
      { kind: "extract", language: "jsonpath", query: "$.orders" },
      { kind: "filter", rules: [{ path: "status", operator: "equals", value: "active" }] },
      { kind: "flatten", notation: "dot", arrays: "json-string" },
      { kind: "default", rules: [{ path: "memo", value: "", when: "missing" }] },
      { kind: "type", rules: [{ path: "amount", type: "number" }] },
      { kind: "select", fields: ["id", { path: "amount" }, { path: "disabled", enabled: false }] },
    ]);
    expect(steps.map((step) => step.operation.type)).toEqual([
      "extract",
      "filter",
      "flatten",
      "default-value",
      "convert-type",
      "select",
    ]);
    expect(steps.at(-1)?.operation).toEqual({ type: "select", collectionPath: undefined, paths: ["id", "amount"] });
  });

  it("runs parse, nested mapping, filter, conversion, defaults, diff, schema generation and CSV serialization", () => {
    const result = runWorkbench({
      input: JSON.stringify({
        orders: [
          { order_id: "A-1", customer_name: "Ada", customer: { address: { city: "Tokyo" } }, status: "active", amount: "12,500", note: "" },
          { order_id: "B-2", customer_name: "Grace", customer: { address: { city: "Osaka" } }, status: "inactive", amount: "8,000" },
        ],
      }),
      parse: { format: "auto", fileName: "orders.json" },
      output: { format: "csv", csv: { nestedMode: "dot-notation", lineEnding: "\n" } },
      generateSchema: { target: "output", title: "Export rows" },
      stages: [
        { id: "extract", kind: "extract", language: "jsonpath", query: "$.orders" },
        { id: "active", kind: "filter", rules: [
          { path: "status", operator: "equals", value: "active" },
          { path: "amount", operator: "greater-than", value: 10_000 },
        ] },
        { id: "map", kind: "mapping", preserveUnmapped: false, fields: [
          { source: "order_id", target: "orderId" },
          { source: "customer_name", target: "customerName" },
          { source: "customer.address.city", target: "address.cityName" },
          { source: "amount", target: "amount", targetType: "number" },
          { source: "note", target: "note", defaultValue: "(none)", defaultWhen: "empty" },
        ] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.phase).toBe("complete");
    expect(result.parse.detectedFormat).toBe("json");
    expect(result.afterData).toEqual([{
      orderId: "A-1",
      customerName: "Ada",
      address: { cityName: "Tokyo" },
      amount: 12500,
      note: "(none)",
    }]);
    expect(result.output).toContain("orderId,customerName,address.cityName,amount,note");
    expect(result.output).toContain("A-1,Ada,Tokyo,12500,(none)");
    expect(result.diff?.identical).toBe(false);
    expect(result.generatedSchema).toMatchObject({ title: "Export rows", type: "array" });
    expect(result.diagnostics).toEqual([]);
  });

  it("returns parser diagnostics and does not run downstream work for invalid input", () => {
    const result = runWorkbench({
      input: '{\n  "broken": tru\n}',
      parse: { format: "json" },
      output: { format: "yaml" },
      stages: [{ kind: "flatten" }],
    });
    expect(result).toMatchObject({
      ok: false,
      phase: "parse",
      beforeData: null,
      afterData: null,
      transform: null,
      serialization: null,
      output: "",
    });
    expect(result.diagnostics[0]).toMatchObject({ code: "INVALID_JSON", line: 2, source: "syntax" });
  });

  it("validates input or output schemas and can block the workflow", () => {
    const schema: JsonSchema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      required: ["id"],
      properties: { id: { type: "integer" } },
      additionalProperties: false,
    };
    const blocked = runWorkbench({
      input: '{"id":"wrong"}',
      parse: { format: "json" },
      output: { format: "json" },
      schema: { schema, target: "input", blockOnError: true },
    });
    expect(blocked).toMatchObject({ ok: false, phase: "schema", transform: null, serialization: null });
    expect(blocked.schemaValidation?.valid).toBe(false);
    expect(blocked.diagnostics[0].code).toBe("SCHEMA_TYPE");

    const reporting = runWorkbench({
      input: '{"id":"wrong"}',
      parse: { format: "json" },
      output: { format: "json" },
      schema: { schema, target: "output" },
    });
    expect(reporting.phase).toBe("complete");
    expect(reporting.output).toContain('"id": "wrong"');
    expect(reporting.ok).toBe(false);
    expect(reporting.schemaValidation?.valid).toBe(false);
  });

  it("turns malformed UI configuration into a stable diagnostic", () => {
    const duplicate = runWorkbench({
      input: "[]",
      parse: { format: "json" },
      output: { format: "json" },
      stages: [
        { id: "same", kind: "flatten" },
        { id: "same", kind: "select", fields: ["id"] },
      ],
    });
    expect(duplicate.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "WORKBENCH_CONFIG_INVALID", reason: expect.stringContaining("duplicated") }),
    ]));
    expect(duplicate.transform).toBeNull();

    expect(() => buildWorkbenchPipeline([
      { kind: "mapping", fields: [{ source: "", target: "name" }] },
    ])).toThrow(/source/u);
  });
});
