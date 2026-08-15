import { describe, expect, it } from "vitest";
import { compareData } from "./diff-engine";
import {
  decodeTextBuffer,
  detectFormat,
  parseData,
  serializeData,
} from "./format-codecs";
import { generateJsonSchema, validateJsonSchema } from "./schema-engine";
import { getAtPath, parsePath, setAtPath } from "./structured-data";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  parseTemplate,
  saveTemplate,
  serializeTemplate,
} from "./template-store";
import {
  extractJsonPath,
  extractXPath,
  runPipeline,
} from "./transform-engine";
import type { PipelineStep, StorageLike, StructuredData } from "./types";

describe("format detection and structured paths", () => {
  it("detects JSON, CSV, XML and YAML with ranked evidence", () => {
    expect(detectFormat('{"active":true}').format).toBe("json");
    expect(detectFormat("id,name\n1,Ada").format).toBe("csv");
    expect(detectFormat("<root><id>1</id></root>").format).toBe("xml");
    expect(detectFormat("customer:\n  active: true").format).toBe("yaml");
    expect(detectFormat("not json", "records.xml").format).toBe("xml");
  });

  it("supports dotted, indexed, quoted and escaped paths without prototype pollution", () => {
    let data: StructuredData = {};
    data = setAtPath(data, 'customer.address["city.name"]', "Tokyo");
    data = setAtPath(data, "items[0].sku", "A-1");
    expect(getAtPath(data, 'customer.address["city.name"]').value).toBe("Tokyo");
    expect(getAtPath(data, "items[0].sku").value).toBe("A-1");
    expect(parsePath("key\\.with\\.dots")).toEqual(["key.with.dots"]);
    expect(() => setAtPath({}, "__proto__.polluted", true)).toThrow(/Unsafe key/u);
  });
});

describe("parse and serialize", () => {
  it("reports JSON line, column and reason", () => {
    const result = parseData('{\n  "name": "Ada",\n  "active": tru\n}', { format: "json" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ source: "syntax", code: "INVALID_JSON", line: 3 });
    expect(result.errors[0].column).toBeGreaterThan(1);
    expect(result.errors[0].reason.length).toBeGreaterThan(0);
  });

  it("parses strict YAML and reports duplicate-key coordinates", () => {
    const valid = parseData("user:\n  name: Ada\n  active: true\n", { format: "yaml" });
    expect(valid.data).toEqual({ user: { name: "Ada", active: true } });
    const invalid = parseData("name: Ada\nname: Grace\n", { format: "yaml" });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors[0].code).toContain("DUPLICATE_KEY");
    expect(invalid.errors[0].line).toBe(2);
  });

  it("parses XML attributes, repeated children and reports syntax coordinates", () => {
    const xml = '<orders version="1"><order id="A"><tag>x</tag><tag>y</tag></order></orders>';
    const valid = parseData(xml, { format: "xml" });
    expect(valid.data).toEqual({ orders: { "@version": "1", order: { "@id": "A", tag: ["x", "y"] } } });
    const invalid = parseData("<root>\n  <item>1</root>", { format: "xml" });
    expect(invalid.errors[0]).toMatchObject({ line: 2, source: "syntax" });
    expect(invalid.errors[0].column).toBeGreaterThan(1);
  });

  it("rejects XML DOCTYPE instead of expanding entities", () => {
    const result = parseData('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>', { format: "xml" });
    expect(result.errors[0].code).toBe("XML_DOCTYPE_UNSUPPORTED");
  });

  it("round-trips XML predefined entities while keeping the document well formed", () => {
    const parsed = parseData("<root><message>A &amp; B &lt; C</message><quote>&quot;ok&quot;</quote></root>", { format: "xml" });
    expect(parsed.data).toEqual({ root: { message: "A & B < C", quote: '"ok"' } });
    const serialized = serializeData(parsed.data!, { format: "xml", minify: true });
    expect(serialized.text).toContain("A &amp; B &lt; C");
    expect(parseData(serialized.text, { format: "xml" }).data).toEqual(parsed.data);
  });

  it("parses quoted CSV delimiters, escaped quotes and embedded newlines", () => {
    const source = 'id,name,note\r\n1,"Ada, A.","first\r\nsecond"\r\n2,"Grace ""G""",ok';
    const result = parseData(source, { format: "csv" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      { id: "1", name: "Ada, A.", note: "first\nsecond" },
      { id: "2", name: 'Grace "G"', note: "ok" },
    ]);
    expect(result.metadata).toMatchObject({ delimiter: ",", rowCount: 2, columnCount: 3 });
  });

  it("reports an unclosed CSV quote at the opening line and column", () => {
    const result = parseData('id,note\n1,"not closed', { format: "csv" });
    expect(result.errors[0]).toMatchObject({ code: "CSV_UNCLOSED_QUOTE", line: 2, column: 3 });
  });

  it("round-trips JSON, YAML and XML and supports pretty/minified output", () => {
    const data: StructuredData = { customers: [{ id: 1, active: true }, { id: 2, active: false }] };
    for (const format of ["json", "yaml"] as const) {
      const pretty = serializeData(data, { format, indent: 4 });
      const minified = serializeData(data, { format, minify: true });
      expect(pretty.ok).toBe(true);
      expect(parseData(pretty.text, { format }).data).toEqual(data);
      expect(parseData(minified.text, { format }).data).toEqual(data);
    }
    const xmlData: StructuredData = { orders: { "@source": "api", order: [{ id: "A" }, { id: "B" }] } };
    const xml = serializeData(xmlData, { format: "xml", indent: 4 });
    expect(xml.text).toContain('<?xml version="1.0"');
    expect(parseData(xml.text, { format: "xml" }).data).toEqual(xmlData);
  });

  it("serializes nested data to dot-notation or JSON-string CSV", () => {
    const data: StructuredData = [{ customer: { name: "Ada", address: { city: "Tokyo" } }, tags: ["vip", "new"] }];
    const dotted = serializeData(data, { format: "csv", csv: { nestedMode: "dot-notation" } });
    expect(dotted.text).toContain("customer.name");
    expect(dotted.text).toContain("tags.0");
    const jsonString = serializeData(data, { format: "csv", csv: { nestedMode: "json-string" } });
    expect(jsonString.text).toContain('"[""vip"",""new""]"');
  });

  it("decodes Shift-JIS using the automatic fallback", async () => {
    const codes = (await import("encoding-japanese")).default.convert(
      (await import("encoding-japanese")).default.stringToCode("id,name\n1,東京"),
      { from: "UNICODE", to: "SJIS", type: "array" },
    );
    const decoded = await decodeTextBuffer(Uint8Array.from(codes));
    expect(decoded).toMatchObject({ encoding: "shift-jis", text: "id,name\n1,東京" });
    expect(decoded.warnings[0].code).toBe("SHIFT_JIS_FALLBACK");
  });
});

describe("transformation pipeline", () => {
  const input: StructuredData = [
    { customer_name: "Ada", customer: { address: { city: "Tokyo" } }, status: "active", amount: "12,500", enabled: "yes", note: "" },
    { customer_name: "Grace", customer: { address: { city: "Osaka" } }, status: "inactive", amount: "9000", enabled: "no" },
  ];

  it("executes nested mapping, filter, types, defaults and selection in order", () => {
    const steps: PipelineStep[] = [
      { id: "map", label: "Key mapping", operation: { type: "map", preserveUnmapped: true, mappings: [
        { sourcePath: "customer_name", targetPath: "customerName", required: true },
        { sourcePath: "customer.address.city", targetPath: "address.cityName", required: true },
      ] } },
      { id: "filter", label: "Active and high value", operation: { type: "filter", logic: "and", conditions: [
        { path: "status", operator: "equals", value: "active" },
        { path: "amount", operator: "greater-than", value: 10_000 },
      ] } },
      { id: "types", label: "Convert", operation: { type: "convert-type", conversions: [
        { path: "amount", targetType: "number" },
        { path: "enabled", targetType: "boolean" },
      ] } },
      { id: "defaults", label: "Defaults", operation: { type: "default-value", rules: [
        { path: "note", value: "(none)", when: "empty" },
      ] } },
      { id: "select", label: "Fields", operation: { type: "select", paths: ["customerName", "address.cityName", "amount", "enabled", "note"] } },
    ];
    const result = runPipeline(input, steps);
    expect(result.ok).toBe(true);
    expect(result.appliedStepIds).toEqual(["map", "filter", "types", "defaults", "select"]);
    expect(result.data).toEqual([{ customerName: "Ada", address: { cityName: "Tokyo" }, amount: 12500, enabled: true, note: "(none)" }]);
    expect(result.stats).toMatchObject({ inputRecords: 2, outputRecords: 1 });
  });

  it("reports mapping and conversion failures with step, record and path", () => {
    const result = runPipeline(input, [
      { id: "map", label: "Map", operation: { type: "map", mappings: [{ sourcePath: "missing", targetPath: "x", required: true }] } },
      { id: "convert", label: "Convert", operation: { type: "convert-type", conversions: [{ path: "amount", targetType: "boolean", onError: "null" }] } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MAPPING_SOURCE_MISSING", stepId: "map", recordIndex: 0, path: "missing" }),
      expect.objectContaining({ code: "TYPE_CONVERSION_FAILED", stepId: "convert", recordIndex: 0, path: "amount" }),
    ]));
  });

  it("flattens nested objects and arrays", () => {
    const result = runPipeline([{ customer: { address: { city: "Tokyo" } }, tags: ["a", "b"] }], [
      { id: "flat", label: "Flatten", operation: { type: "flatten", notation: "dot", arrays: "indices" } },
    ]);
    expect(result.data).toEqual([{ "customer.address.city": "Tokyo", "tags.0": "a", "tags.1": "b" }]);
  });

  it("maps, filters, selects and converts literal dot keys produced by flatten", () => {
    const result = runPipeline([
      { customer: { address: { city: "Tokyo" } }, status: "active", amount: "12,500" },
      { customer: { address: { city: "Osaka" } }, status: "inactive", amount: "9,000" },
    ], [
      { id: "flat", label: "Flatten", operation: { type: "flatten", notation: "dot", arrays: "indices" } },
      { id: "map", label: "Map", operation: { type: "map", preserveUnmapped: true, mappings: [
        { sourcePath: "customer.address.city", targetPath: "address.cityName", required: true },
      ] } },
      { id: "filter", label: "Filter", operation: { type: "filter", conditions: [
        { path: "status", operator: "equals", value: "active" },
      ] } },
      { id: "types", label: "Types", operation: { type: "convert-type", conversions: [
        { path: "amount", targetType: "number" },
      ] } },
      { id: "select", label: "Select", operation: { type: "select", paths: ["address.cityName", "amount"] } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ address: { cityName: "Tokyo" }, amount: 12500 }]);
    expect(JSON.stringify(result.data)).not.toContain("customer.address.city");
  });

  it("prefers a real nested path when nested and literal-dot keys both exist", () => {
    const result = runPipeline([{ customer: { name: "Nested" }, "customer.name": "Literal" }], [
      { id: "select", label: "Select", operation: { type: "select", paths: ["customer.name"] } },
    ]);
    expect(result.data).toEqual([{ customer: { name: "Nested" } }]);
  });

  it("supports pragmatic JSONPath and XPath extraction including wildcard", () => {
    const json: StructuredData = { customers: [{ name: "Ada" }, { name: "Grace" }] };
    expect(extractJsonPath(json, "$.customers[*].name")).toEqual({ found: true, value: ["Ada", "Grace"] });
    expect(extractJsonPath(json, "$.customers[1].name")).toEqual({ found: true, value: "Grace" });
    const xmlObject: StructuredData = { orders: { order: [{ "@id": "A", name: "One" }, { "@id": "B", name: "Two" }] } };
    expect(extractXPath(xmlObject, "/orders/order[2]/@id")).toEqual({ found: true, value: "B" });
    expect(extractXPath(xmlObject, "//name")).toEqual({ found: true, value: ["One", "Two"] });
  });

  it("keeps the last successful result and stops after a malformed step", () => {
    const result = runPipeline(input, [
      { id: "select", label: "Select", operation: { type: "select", paths: ["customer_name"] } },
      { id: "broken", label: "Broken", operation: { type: "default-value", collectionPath: "missing", rules: [] } },
      { id: "never", label: "Never", operation: { type: "flatten" } },
    ]);
    expect(result.appliedStepIds).toEqual(["select"]);
    expect(result.errors[0]).toMatchObject({ code: "STEP_FAILED", stepId: "broken" });
    expect(result.data).toEqual([{ customer_name: "Ada" }, { customer_name: "Grace" }]);
  });
});

describe("diff, schema and templates", () => {
  it("classifies added, removed and changed paths and caps transferred detail", () => {
    const result = compareData(
      { id: 1, old: true, profile: { name: "Ada" } },
      { id: 2, added: true, profile: { name: "Grace" } },
      { maxEntries: 2 },
    );
    expect(result).toMatchObject({ added: 1, removed: 1, changed: 2, totalChanges: 4, truncated: true, identical: false });
    expect(result.entries).toHaveLength(2);
    expect(compareData([1], [1]).identical).toBe(true);
  });

  it("generates a merged Draft-07 schema from array samples", () => {
    const schema = generateJsonSchema([
      { id: 1, name: "Ada", joined: "2026-08-13", optional: true },
      { id: 2, name: "Grace", joined: "2026-08-14" },
    ], { title: "Customers", additionalProperties: false });
    expect(schema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "Customers",
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "joined"],
        properties: { id: { type: "integer" }, joined: { type: "string", format: "date" } },
      },
    });
  });

  it("validates data and maps Ajv errors to UI diagnostics", () => {
    const schema = generateJsonSchema({ id: 1, email: "a@example.com" }, { additionalProperties: false });
    if (schema.properties?.email) schema.properties.email.pattern = "^[^@]+@[^@]+$";
    const valid = validateJsonSchema({ id: 2, email: "b@example.com" }, schema);
    expect(valid.valid).toBe(true);
    const invalid = validateJsonSchema({ id: "wrong", email: "broken", extra: true }, schema);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_TYPE", path: '$["id"]' }),
      expect.objectContaining({ code: "SCHEMA_PATTERN", path: '$["email"]' }),
      expect.objectContaining({ code: "SCHEMA_ADDITIONALPROPERTIES" }),
    ]));
  });

  it("round-trips a versioned template and persists it in local storage", () => {
    const template = createTemplate({
      id: "api-a-to-b",
      name: "API A → System B",
      inputFormat: "json",
      output: { format: "csv", csv: { nestedMode: "dot-notation" } },
      steps: [{ id: "map", label: "Map", operation: { type: "map", mappings: [{ sourcePath: "customer_name", targetPath: "customerName" }] } }],
      now: "2026-08-13T00:00:00.000Z",
    });
    expect(parseTemplate(serializeTemplate(template))).toEqual(template);
    const memory = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
    expect(saveTemplate(storage, template)).toEqual([template]);
    expect(listTemplates(storage)).toEqual([template]);
    expect(deleteTemplate(storage, template.id)).toEqual([]);
    expect(listTemplates(storage)).toEqual([]);
  });

  it("rejects unknown template versions and operation types", () => {
    expect(() => parseTemplate('{"version":2}')).toThrow(/version/u);
    const template = createTemplate({ name: "Valid", output: { format: "json" }, steps: [], now: "2026-08-13T00:00:00Z" });
    expect(() => parseTemplate(JSON.stringify({ ...template, steps: [{ id: "x", label: "x", operation: { type: "eval" } }] }))).toThrow(/unsupported operation/u);
  });
});
