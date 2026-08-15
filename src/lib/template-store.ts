import type {
  CreateTemplateInput,
  DataFormat,
  StorageLike,
  TransformOperation,
  TransformTemplate,
} from "./types";

export const TEMPLATE_STORAGE_KEY = "data-shift.transform-templates.v1";
const FORMATS = new Set<DataFormat>(["json", "csv", "xml", "yaml"]);
const OPERATION_TYPES = new Set<TransformOperation["type"]>([
  "flatten",
  "map",
  "filter",
  "select",
  "convert-type",
  "default-value",
  "extract",
]);

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
}

function assertTemplate(candidate: unknown): asserts candidate is TransformTemplate {
  if (!isRecord(candidate)) throw new Error("A template must be a JSON object.");
  if (candidate.version !== 1) throw new Error("Unsupported template version. Expected version 1.");
  assertString(candidate.id, "Template id");
  assertString(candidate.name, "Template name");
  if (candidate.description !== undefined && typeof candidate.description !== "string") {
    throw new Error("Template description must be text.");
  }
  if (candidate.inputFormat !== "auto" && !FORMATS.has(candidate.inputFormat as DataFormat)) {
    throw new Error("Template inputFormat is invalid.");
  }
  if (!isRecord(candidate.output) || !FORMATS.has(candidate.output.format as DataFormat)) {
    throw new Error("Template output format is invalid.");
  }
  if (!Array.isArray(candidate.steps)) throw new Error("Template steps must be an array.");
  const ids = new Set<string>();
  candidate.steps.forEach((step, index) => {
    if (!isRecord(step)) throw new Error(`Template step ${index + 1} must be an object.`);
    assertString(step.id, `Template step ${index + 1} id`);
    assertString(step.label, `Template step ${index + 1} label`);
    if (ids.has(step.id)) throw new Error(`Template step id is duplicated: ${step.id}`);
    ids.add(step.id);
    if (!isRecord(step.operation) || !OPERATION_TYPES.has(step.operation.type as TransformOperation["type"])) {
      throw new Error(`Template step ${index + 1} has an unsupported operation.`);
    }
  });
  assertString(candidate.createdAt, "Template createdAt");
  assertString(candidate.updatedAt, "Template updatedAt");
  if (!Number.isFinite(Date.parse(candidate.createdAt)) || !Number.isFinite(Date.parse(candidate.updatedAt))) {
    throw new Error("Template timestamps must be ISO-compatible dates.");
  }
}

export function createTemplate(input: CreateTemplateInput): TransformTemplate {
  assertString(input.name, "Template name");
  const timestamp = input.now ?? new Date().toISOString();
  const template: TransformTemplate = {
    version: 1,
    id: input.id?.trim() || createId(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    inputFormat: input.inputFormat ?? "auto",
    output: input.output,
    steps: input.steps,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  // Round-trip validation also guarantees that functions/undefined values do
  // not silently enter a reusable flow.
  return parseTemplate(serializeTemplate(template));
}

export function serializeTemplate(template: TransformTemplate): string {
  assertTemplate(template);
  return JSON.stringify(template, null, 2);
}

export function parseTemplate(serialized: string): TransformTemplate {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid JSON.";
    throw new Error(`Template JSON is invalid: ${reason}`);
  }
  assertTemplate(candidate);
  // JSON data is cloned so callers cannot mutate the parse object through a
  // reference held by a storage adapter.
  return candidate;
}

function parseTemplateList(serialized: string | null): TransformTemplate[] {
  if (!serialized) return [];
  let list: unknown;
  try {
    list = JSON.parse(serialized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid JSON.";
    throw new Error(`Saved template data is invalid: ${reason}`);
  }
  if (!Array.isArray(list)) throw new Error("Saved template data must be an array.");
  return list.map((item) => {
    assertTemplate(item);
    return item;
  });
}

export function listTemplates(
  storage: StorageLike,
  key = TEMPLATE_STORAGE_KEY,
): TransformTemplate[] {
  return parseTemplateList(storage.getItem(key))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function saveTemplate(
  storage: StorageLike,
  template: TransformTemplate,
  key = TEMPLATE_STORAGE_KEY,
): TransformTemplate[] {
  assertTemplate(template);
  const existing = listTemplates(storage, key);
  const updated = [template, ...existing.filter((item) => item.id !== template.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  storage.setItem(key, JSON.stringify(updated));
  return updated;
}

export function deleteTemplate(
  storage: StorageLike,
  templateId: string,
  key = TEMPLATE_STORAGE_KEY,
): TransformTemplate[] {
  const updated = listTemplates(storage, key).filter((item) => item.id !== templateId);
  if (updated.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(updated));
  return updated;
}

export function updateTemplateTimestamp(
  template: TransformTemplate,
  updatedAt = new Date().toISOString(),
): TransformTemplate {
  return parseTemplate(JSON.stringify({ ...template, updatedAt }));
}
