import {
  cloneData,
  countRecords,
  deleteAtPath,
  getAtPath,
  isDataObject,
  parsePath,
  setAtPath,
} from "./structured-data";
import type {
  DataDiagnostic,
  DataObject,
  DefaultValueRule,
  FilterCondition,
  MappingRule,
  PipelineStep,
  StructuredData,
  TransformOperation,
  TransformResult,
  TypeConversionRule,
} from "./types";

interface OperationResult {
  data: StructuredData;
  errors: DataDiagnostic[];
  warnings: DataDiagnostic[];
}

interface RecordPathLookup {
  exists: boolean;
  value?: StructuredData;
  exactKey: boolean;
}

/**
 * Nested paths win when both representations exist. Flattened rows, however,
 * store keys such as `customer.address.city` literally, so operations fall
 * back to an exact own-key lookup only when nested traversal has no match.
 */
function getRecordPath(record: StructuredData, path: string): RecordPathLookup {
  const nested = getAtPath(record, path);
  if (nested.exists) return { ...nested, exactKey: false };
  if (isDataObject(record) && Object.prototype.hasOwnProperty.call(record, path)) {
    return { exists: true, value: record[path], exactKey: true };
  }
  return { exists: false, exactKey: false };
}

function setRecordPath(
  record: StructuredData,
  path: string,
  value: StructuredData,
  exactKey: boolean,
): StructuredData {
  return setAtPath(record, exactKey ? [path] : path, value);
}

function deleteRecordPath(
  record: StructuredData,
  path: string,
  exactKey: boolean,
): StructuredData {
  return deleteAtPath(record, exactKey ? [path] : path);
}

function issue(
  source: DataDiagnostic["source"],
  code: string,
  reason: string,
  extras: Partial<DataDiagnostic> = {},
): DataDiagnostic {
  return {
    severity: "error",
    source,
    code,
    message: reason,
    reason,
    ...extras,
  };
}

function operationSource(operation: TransformOperation): DataDiagnostic["source"] {
  if (operation.type === "map" || operation.type === "select" || operation.type === "flatten") return "mapping";
  if (operation.type === "filter" || operation.type === "extract") return "filter";
  if (operation.type === "convert-type") return "type-conversion";
  return "mapping";
}

function recordTarget(
  data: StructuredData,
  collectionPath: string | undefined,
): { exists: boolean; target?: StructuredData } {
  if (!collectionPath || collectionPath.trim() === "" || collectionPath.trim() === "$") {
    return { exists: true, target: data };
  }
  return getAtPath(data, collectionPath);
}

function applyToRecords(
  data: StructuredData,
  collectionPath: string | undefined,
  transform: (record: StructuredData, index: number) => StructuredData,
): StructuredData {
  const lookup = recordTarget(data, collectionPath);
  if (!lookup.exists || lookup.target === undefined) {
    throw new Error(`Collection path was not found: ${collectionPath}`);
  }
  const target = lookup.target;
  const transformed = Array.isArray(target)
    ? target.map((record, index) => transform(record, index))
    : transform(target, 0);
  if (!collectionPath || collectionPath.trim() === "" || collectionPath.trim() === "$") return transformed;
  return setAtPath(data, collectionPath, transformed);
}

function flattenObject(
  value: StructuredData,
  separator: string,
  arrays: "indices" | "json-string",
  prefix = "",
  output: DataObject = {},
): DataObject {
  if (Array.isArray(value)) {
    if (arrays === "json-string") {
      output[prefix || "value"] = JSON.stringify(value);
      return output;
    }
    if (value.length === 0) output[prefix || "value"] = [];
    value.forEach((entry, index) => flattenObject(entry, separator, arrays, prefix
      ? `${prefix}${separator}${index}`
      : String(index), output));
    return output;
  }
  if (isDataObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) output[prefix || "value"] = {};
    for (const [key, entry] of entries) {
      flattenObject(entry, separator, arrays, prefix ? `${prefix}${separator}${key}` : key, output);
    }
    return output;
  }
  output[prefix || "value"] = value;
  return output;
}

function mapRecord(
  record: StructuredData,
  mappings: readonly MappingRule[],
  preserveUnmapped: boolean,
  recordIndex: number,
  stepId: string,
  errors: DataDiagnostic[],
): StructuredData {
  let output: StructuredData = preserveUnmapped ? cloneData(record) : {};
  for (const mapping of mappings) {
    const source = getRecordPath(record, mapping.sourcePath);
    if (!source.exists || source.value === undefined) {
      if (Object.prototype.hasOwnProperty.call(mapping, "defaultValue")) {
        output = setAtPath(output, mapping.targetPath, cloneData(mapping.defaultValue ?? null));
      } else if (mapping.required) {
        errors.push(issue("mapping", "MAPPING_SOURCE_MISSING", `Required source path was not found: ${mapping.sourcePath}`, {
          path: mapping.sourcePath,
          stepId,
          recordIndex,
        }));
      }
      continue;
    }
    if (preserveUnmapped && mapping.sourcePath !== mapping.targetPath) {
      output = deleteRecordPath(output, mapping.sourcePath, source.exactKey);
    }
    output = setAtPath(output, mapping.targetPath, cloneData(source.value));
  }
  return output;
}

function normalizedText(value: StructuredData, caseSensitive: boolean): string {
  const text = value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return caseSensitive ? text : text.toLocaleLowerCase("ja-JP");
}

function numeric(value: StructuredData | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim().replace(/,/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function comparablePair(
  left: StructuredData,
  right: StructuredData,
): [string | number | boolean | null, string | number | boolean | null] {
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber !== null && rightNumber !== null) return [leftNumber, rightNumber];
  if (typeof left === "boolean" && typeof right === "boolean") return [left, right];
  return [left === null ? null : normalizedText(left, true), right === null ? null : normalizedText(right, true)];
}

export function matchesFilter(record: StructuredData, condition: FilterCondition): boolean {
  const lookup = getRecordPath(record, condition.path);
  if (condition.operator === "exists") return lookup.exists;
  if (condition.operator === "not-exists") return !lookup.exists;
  if (!lookup.exists || lookup.value === undefined) return false;
  const value = lookup.value;
  if (condition.operator === "is-empty") {
    return value === null || value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (isDataObject(value) && Object.keys(value).length === 0);
  }
  if (condition.operator === "is-not-empty") {
    return !matchesFilter(record, { ...condition, operator: "is-empty" });
  }
  const expected = condition.value ?? null;
  if (["contains", "not-contains", "starts-with", "ends-with"].includes(condition.operator)) {
    const left = normalizedText(value, condition.caseSensitive ?? false);
    const right = normalizedText(expected, condition.caseSensitive ?? false);
    if (condition.operator === "contains") return left.includes(right);
    if (condition.operator === "not-contains") return !left.includes(right);
    if (condition.operator === "starts-with") return left.startsWith(right);
    return left.endsWith(right);
  }

  let [left, right] = comparablePair(value, expected);
  if (typeof left === "string" && typeof right === "string" && !(condition.caseSensitive ?? false)) {
    left = left.toLocaleLowerCase("ja-JP");
    right = right.toLocaleLowerCase("ja-JP");
  }
  if (condition.operator === "equals") return left === right;
  if (condition.operator === "not-equals") return left !== right;
  if (left === null || right === null || typeof left === "boolean" || typeof right === "boolean") return false;
  if (condition.operator === "greater-than") return left > right;
  if (condition.operator === "greater-than-or-equal") return left >= right;
  if (condition.operator === "less-than") return left < right;
  return left <= right;
}

function filterCollection(
  data: StructuredData,
  collectionPath: string | undefined,
  conditions: readonly FilterCondition[],
  logic: "and" | "or",
): StructuredData {
  const lookup = recordTarget(data, collectionPath);
  if (!lookup.exists || lookup.target === undefined) {
    throw new Error(`Collection path was not found: ${collectionPath}`);
  }
  if (!Array.isArray(lookup.target)) throw new Error("A filter collection path must point to an array.");
  const filtered = lookup.target.filter((record) => logic === "and"
    ? conditions.every((condition) => matchesFilter(record, condition))
    : conditions.some((condition) => matchesFilter(record, condition)));
  if (!collectionPath || collectionPath.trim() === "" || collectionPath.trim() === "$") return filtered;
  return setAtPath(data, collectionPath, filtered);
}

function selectedRecord(record: StructuredData, paths: readonly string[]): StructuredData {
  let selected: StructuredData = {};
  for (const path of paths) {
    const lookup = getRecordPath(record, path);
    if (lookup.exists && lookup.value !== undefined) {
      selected = setRecordPath(selected, path, cloneData(lookup.value), lookup.exactKey);
    }
  }
  return selected;
}

function dateValue(value: StructuredData, output: "date" | "date-time"): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string") {
    const simple = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/u);
    if (simple) {
      const year = Number(simple[1]);
      const month = Number(simple[2]);
      const day = Number(simple[3]);
      const utc = new Date(Date.UTC(year, month - 1, day));
      if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
      const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return output === "date" ? date : `${date}T00:00:00.000Z`;
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString();
  return output === "date" ? iso.slice(0, 10) : iso;
}

export function convertValue(value: StructuredData, rule: TypeConversionRule): { ok: boolean; value: StructuredData } {
  if (rule.targetType === "null") return { ok: true, value: null };
  if (rule.targetType === "string") {
    if (typeof value === "string") return { ok: true, value };
    return { ok: true, value: value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value) };
  }
  if (rule.targetType === "number") {
    const parsed = numeric(value);
    return parsed === null ? { ok: false, value: rule.onError === "null" ? null : value } : { ok: true, value: parsed };
  }
  if (rule.targetType === "boolean") {
    if (typeof value === "boolean") return { ok: true, value };
    if (typeof value === "number" && (value === 0 || value === 1)) return { ok: true, value: value === 1 };
    if (typeof value === "string") {
      const normalized = value.trim().toLocaleLowerCase("en-US");
      if (["true", "1", "yes", "y", "on"].includes(normalized)) return { ok: true, value: true };
      if (["false", "0", "no", "n", "off"].includes(normalized)) return { ok: true, value: false };
    }
    return { ok: false, value: rule.onError === "null" ? null : value };
  }
  const converted = dateValue(value, rule.dateOutput ?? "date");
  return converted === null
    ? { ok: false, value: rule.onError === "null" ? null : value }
    : { ok: true, value: converted };
}

function convertRecord(
  record: StructuredData,
  conversions: readonly TypeConversionRule[],
  recordIndex: number,
  stepId: string,
  errors: DataDiagnostic[],
): StructuredData {
  let output = cloneData(record);
  for (const rule of conversions) {
    const lookup = getRecordPath(output, rule.path);
    if (!lookup.exists || lookup.value === undefined) {
      errors.push(issue("type-conversion", "CONVERSION_PATH_MISSING", `Type conversion path was not found: ${rule.path}`, {
        path: rule.path,
        stepId,
        recordIndex,
      }));
      continue;
    }
    const converted = convertValue(lookup.value, rule);
    if (!converted.ok) {
      errors.push(issue("type-conversion", "TYPE_CONVERSION_FAILED", `Could not convert ${rule.path} to ${rule.targetType}.`, {
        path: rule.path,
        stepId,
        recordIndex,
      }));
    }
    output = setRecordPath(output, rule.path, converted.value, lookup.exactKey);
  }
  return output;
}

function needsDefault(value: StructuredData, rule: DefaultValueRule, exists: boolean): boolean {
  const when = rule.when ?? "missing";
  if (when === "missing") return !exists;
  if (when === "nullish") return !exists || value === null;
  return !exists || value === null || value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isDataObject(value) && Object.keys(value).length === 0);
}

function defaultsRecord(record: StructuredData, rules: readonly DefaultValueRule[]): StructuredData {
  let output = cloneData(record);
  for (const rule of rules) {
    const lookup = getRecordPath(output, rule.path);
    if (needsDefault(lookup.value ?? null, rule, lookup.exists)) {
      output = setRecordPath(output, rule.path, cloneData(rule.value), lookup.exactKey);
    }
  }
  return output;
}

interface JsonPathToken {
  kind: "property" | "index" | "wildcard";
  value?: string | number;
}

function parseJsonPath(query: string): JsonPathToken[] {
  const source = query.trim();
  if (!source.startsWith("$")) throw new Error("JSONPath must start with $.");
  const tokens: JsonPathToken[] = [];
  let index = 1;
  while (index < source.length) {
    if (source.startsWith(".*", index)) {
      tokens.push({ kind: "wildcard" });
      index += 2;
      continue;
    }
    if (source[index] === ".") {
      index += 1;
      const match = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$-]*/u);
      if (!match) throw new Error(`Invalid JSONPath property near ${source.slice(index)}.`);
      tokens.push({ kind: "property", value: match[0] });
      index += match[0].length;
      continue;
    }
    if (source[index] === "[") {
      const end = source.indexOf("]", index + 1);
      if (end < 0) throw new Error("JSONPath bracket is not closed.");
      const raw = source.slice(index + 1, end).trim();
      if (raw === "*") tokens.push({ kind: "wildcard" });
      else if (/^(?:0|[1-9]\d*)$/u.test(raw)) tokens.push({ kind: "index", value: Number(raw) });
      else if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        const key = raw.startsWith('"') ? JSON.parse(raw) as string : raw.slice(1, -1).replace(/\\([\\'])/gu, "$1");
        tokens.push({ kind: "property", value: key });
      } else throw new Error(`Unsupported JSONPath bracket: [${raw}].`);
      index = end + 1;
      continue;
    }
    throw new Error(`Unsupported JSONPath syntax near ${source.slice(index)}.`);
  }
  return tokens;
}

export function extractJsonPath(data: StructuredData, query: string): { found: boolean; value: StructuredData } {
  const tokens = parseJsonPath(query);
  let values: StructuredData[] = [data];
  let usedWildcard = false;
  for (const token of tokens) {
    const next: StructuredData[] = [];
    for (const value of values) {
      if (token.kind === "property" && isDataObject(value) &&
        Object.prototype.hasOwnProperty.call(value, String(token.value))) {
        next.push(value[String(token.value)]);
      } else if (token.kind === "index" && Array.isArray(value) && Number(token.value) < value.length) {
        next.push(value[Number(token.value)]);
      } else if (token.kind === "wildcard") {
        usedWildcard = true;
        if (Array.isArray(value)) next.push(...value);
        else if (isDataObject(value)) next.push(...Object.values(value));
      }
    }
    values = next;
  }
  if (values.length === 0) return { found: false, value: [] };
  return { found: true, value: usedWildcard || values.length > 1 ? values : values[0] };
}

interface XPathStep {
  name: string;
  index?: number;
}

function xpathStep(raw: string): XPathStep {
  const match = raw.match(/^([^\[]+?)(?:\[(\d+)\])?$/u);
  if (!match) throw new Error(`Unsupported XPath step: ${raw}`);
  const name = match[1] === "text()" ? "#text" : match[1].startsWith("@") ? match[1] : match[1];
  return { name, index: match[2] ? Number(match[2]) : undefined };
}

function childValues(value: StructuredData, step: XPathStep): StructuredData[] {
  if (Array.isArray(value)) return value.flatMap((entry) => childValues(entry, step));
  if (!isDataObject(value)) return [];
  const candidates: StructuredData[] = [];
  if (step.name === "*") {
    for (const [key, entry] of Object.entries(value)) {
      if (!key.startsWith("@") && key !== "#text") candidates.push(...(Array.isArray(entry) ? entry : [entry]));
    }
  } else if (Object.prototype.hasOwnProperty.call(value, step.name)) {
    const entry = value[step.name];
    candidates.push(...(Array.isArray(entry) ? entry : [entry]));
  }
  if (step.index === undefined) return candidates;
  return candidates[step.index - 1] === undefined ? [] : [candidates[step.index - 1]];
}

function descendantValues(value: StructuredData, step: XPathStep, output: StructuredData[] = []): StructuredData[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => descendantValues(entry, step, output));
  } else if (isDataObject(value)) {
    output.push(...childValues(value, step));
    for (const [key, entry] of Object.entries(value)) {
      if (!key.startsWith("@") && key !== "#text") descendantValues(entry, step, output);
    }
  }
  return output;
}

/** XPath subset for local XML objects: `/a/b[1]`, `//b`, `@id`, `text()`, and `*`. */
export function extractXPath(data: StructuredData, query: string): { found: boolean; value: StructuredData } {
  const source = query.trim();
  const descendant = source.startsWith("//");
  if (!descendant && !source.startsWith("/")) throw new Error("XPath must start with / or //.");
  const rawSteps = source.slice(descendant ? 2 : 1).split("/").filter(Boolean);
  if (rawSteps.length === 0) return { found: true, value: data };
  const steps = rawSteps.map(xpathStep);
  let values = descendant ? descendantValues(data, steps[0]) : childValues(data, steps[0]);
  for (const step of steps.slice(1)) values = values.flatMap((value) => childValues(value, step));
  if (values.length === 0) return { found: false, value: [] };
  return { found: true, value: values.length === 1 ? values[0] : values };
}

function applyOperation(data: StructuredData, step: PipelineStep): OperationResult {
  const operation = step.operation;
  const errors: DataDiagnostic[] = [];
  const warnings: DataDiagnostic[] = [];

  if (operation.type === "flatten") {
    const separator = operation.notation === "underscore" ? "_" : ".";
    return {
      data: applyToRecords(data, operation.collectionPath, (record) =>
        flattenObject(record, separator, operation.arrays ?? "indices")),
      errors,
      warnings,
    };
  }
  if (operation.type === "map") {
    return {
      data: applyToRecords(data, operation.collectionPath, (record, index) =>
        mapRecord(record, operation.mappings, operation.preserveUnmapped ?? true, index, step.id, errors)),
      errors,
      warnings,
    };
  }
  if (operation.type === "filter") {
    return {
      data: filterCollection(data, operation.collectionPath, operation.conditions, operation.logic ?? "and"),
      errors,
      warnings,
    };
  }
  if (operation.type === "select") {
    return {
      data: applyToRecords(data, operation.collectionPath, (record) => selectedRecord(record, operation.paths)),
      errors,
      warnings,
    };
  }
  if (operation.type === "convert-type") {
    return {
      data: applyToRecords(data, operation.collectionPath, (record, index) =>
        convertRecord(record, operation.conversions, index, step.id, errors)),
      errors,
      warnings,
    };
  }
  if (operation.type === "default-value") {
    return {
      data: applyToRecords(data, operation.collectionPath, (record) => defaultsRecord(record, operation.rules)),
      errors,
      warnings,
    };
  }
  const extracted = operation.language === "jsonpath"
    ? extractJsonPath(data, operation.query)
    : extractXPath(data, operation.query);
  if (!extracted.found) {
    errors.push(issue("filter", "EXTRACTION_NO_MATCH", `${operation.language.toUpperCase()} matched no data: ${operation.query}`, {
      path: operation.query,
      stepId: step.id,
    }));
  }
  return { data: extracted.value, errors, warnings };
}

export function runPipeline(data: StructuredData, steps: readonly PipelineStep[]): TransformResult {
  const now = typeof performance !== "undefined" && performance.now ? () => performance.now() : () => Date.now();
  const startedAt = now();
  const inputRecords = countRecords(data);
  let current = cloneData(data);
  const errors: DataDiagnostic[] = [];
  const warnings: DataDiagnostic[] = [];
  const appliedStepIds: string[] = [];

  for (const step of steps) {
    if (step.enabled === false) continue;
    try {
      // Validate path syntax before partially applying a step.
      const operation = step.operation;
      if ("collectionPath" in operation && operation.collectionPath) parsePath(operation.collectionPath);
      const result = applyOperation(current, step);
      current = result.data;
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      appliedStepIds.push(step.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The transformation step failed.";
      errors.push(issue(operationSource(step.operation), "STEP_FAILED", reason, { stepId: step.id }));
      break;
    }
  }

  return {
    ok: errors.length === 0,
    data: current,
    errors,
    warnings,
    appliedStepIds,
    stats: {
      inputRecords,
      outputRecords: countRecords(current),
      durationMs: Math.max(0, now() - startedAt),
    },
  };
}

export const executePipeline = runPipeline;
