import Ajv from "ajv";
import { isDataObject } from "./structured-data";
import type {
  DataDiagnostic,
  JsonSchema,
  SchemaGenerationOptions,
  SchemaValidationResult,
  StructuredData,
} from "./types";

interface AjvLikeError {
  instancePath?: string;
  dataPath?: string;
  schemaPath?: string;
  keyword?: string;
  message?: string;
  params?: Record<string, unknown>;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function schemaTypes(schema: JsonSchema): string[] {
  if (!schema.type) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function mergeSchemas(left: JsonSchema, right: JsonSchema): JsonSchema {
  const leftTypes = schemaTypes(left);
  const rightTypes = schemaTypes(right);
  if (leftTypes.length === 0) return right;
  if (rightTypes.length === 0) return left;
  const mergedTypes = unique([...leftTypes, ...rightTypes]);
  if (mergedTypes.includes("integer") && mergedTypes.includes("number")) {
    mergedTypes.splice(mergedTypes.indexOf("integer"), 1);
  }

  if (mergedTypes.length === 1 && mergedTypes[0] === "object") {
    const leftProperties = left.properties ?? {};
    const rightProperties = right.properties ?? {};
    const properties: Record<string, JsonSchema> = {};
    for (const key of unique([...Object.keys(leftProperties), ...Object.keys(rightProperties)])) {
      const leftProperty = leftProperties[key];
      const rightProperty = rightProperties[key];
      properties[key] = leftProperty && rightProperty
        ? mergeSchemas(leftProperty, rightProperty)
        : (leftProperty ?? rightProperty);
    }
    const rightRequired = new Set(right.required ?? []);
    const required = (left.required ?? []).filter((key) => rightRequired.has(key));
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: left.additionalProperties ?? right.additionalProperties ?? true,
    };
  }

  if (mergedTypes.length === 1 && mergedTypes[0] === "array") {
    const items = left.items && right.items ? mergeSchemas(left.items, right.items) : (left.items ?? right.items ?? {});
    return { type: "array", items };
  }

  const type = mergedTypes.length === 1 ? mergedTypes[0] : mergedTypes.sort();
  const sameFormat = left.format && left.format === right.format ? left.format : undefined;
  return { type, ...(sameFormat ? { format: sameFormat } : {}) };
}

function validDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function inferValue(value: StructuredData, options: SchemaGenerationOptions): JsonSchema {
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "string") {
    if (options.inferFormats ?? true) {
      if (validDate(value)) return { type: "string", format: "date" };
      if (/^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))) {
        return { type: "string", format: "date-time" };
      }
    }
    return { type: "string" };
  }
  if (Array.isArray(value)) {
    const items = value.length === 0 ? {} : value.slice(1).reduce(
      (schema, entry) => mergeSchemas(schema, inferValue(entry, options)),
      inferValue(value[0], options),
    );
    return { type: "array", items };
  }
  const properties: Record<string, JsonSchema> = {};
  for (const [key, entry] of Object.entries(value)) properties[key] = inferValue(entry, options);
  const required = Object.keys(value);
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: options.additionalProperties ?? true,
  };
}

export function generateJsonSchema(
  sample: StructuredData,
  options: SchemaGenerationOptions = {},
): JsonSchema {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...(options.title ? { title: options.title } : {}),
    ...inferValue(sample, options),
  };
}

function pointerToPath(pointer: string): string {
  if (!pointer) return "$";
  if (pointer.startsWith(".")) return `$${pointer}`;
  const segments = pointer.split("/").slice(1).map((segment) =>
    segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
  return segments.reduce((path, segment) => /^(?:0|[1-9]\d*)$/u.test(segment)
    ? `${path}[${segment}]`
    : `${path}[${JSON.stringify(segment)}]`, "$" as string);
}

function schemaDiagnostic(error: AjvLikeError): DataDiagnostic {
  const path = pointerToPath(error.instancePath ?? error.dataPath ?? "");
  let reason = error.message ? `${path} ${error.message}` : `${path} does not match the schema.`;
  if (error.keyword === "required" && typeof error.params?.missingProperty === "string") {
    reason = `${path} is missing required property ${JSON.stringify(error.params.missingProperty)}.`;
  }
  return {
    severity: "error",
    source: "schema",
    code: `SCHEMA_${(error.keyword ?? "INVALID").toLocaleUpperCase("en-US").replace(/-/gu, "_")}`,
    message: reason,
    reason,
    path,
  };
}

export function validateJsonSchema(
  data: StructuredData,
  schema: JsonSchema,
): SchemaValidationResult {
  try {
    // The constructor/options are supported by Ajv 6 and Ajv 8, which keeps the
    // engine compatible with the workspace dependency during incremental setup.
    const ajv = new Ajv({ allErrors: true, strict: false, verbose: false } as ConstructorParameters<typeof Ajv>[0]);
    ajv.addFormat("date", { type: "string", validate: validDate });
    ajv.addFormat("date-time", {
      type: "string",
      validate: (value: string) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)),
    });
    const validate = ajv.compile(schema);
    const valid = Boolean(validate(data));
    return {
      valid,
      errors: valid ? [] : ((validate.errors ?? []) as AjvLikeError[]).map(schemaDiagnostic),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The JSON Schema could not be compiled.";
    return {
      valid: false,
      errors: [{
        severity: "error",
        source: "schema",
        code: "SCHEMA_COMPILE_FAILED",
        message: reason,
        reason,
      }],
    };
  }
}

/** Useful for table/schema UIs without exposing Ajv internals. */
export function objectSchemaProperties(schema: JsonSchema): Record<string, JsonSchema> {
  return schema.type === "object" && isDataObject(schema.properties as unknown)
    ? schema.properties ?? {}
    : {};
}
