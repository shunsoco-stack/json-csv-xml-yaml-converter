import { compareData } from "./diff-engine";
import { parseData, serializeData } from "./format-codecs";
import { generateJsonSchema, validateJsonSchema } from "./schema-engine";
import { runPipeline } from "./transform-engine";
import type {
  ConversionFailureMode,
  DataDiagnostic,
  DefaultValueRule,
  DiffResult,
  FilterCondition,
  FilterOperator,
  JsonSchema,
  MappingRule,
  ParseOptions,
  ParseResult,
  PipelineStep,
  SchemaGenerationOptions,
  SchemaValidationResult,
  SerializeOptions,
  SerializeResult,
  StructuredData,
  TransformResult,
  TypeTarget,
} from "./types";

interface WorkbenchStageBase {
  id?: string;
  label?: string;
  enabled?: boolean;
}

export interface WorkbenchMappingField {
  id?: string;
  enabled?: boolean;
  source: string;
  target: string;
  required?: boolean;
  /** An explicit `null` is a valid default. Omit the property for no default. */
  defaultValue?: StructuredData;
  defaultWhen?: DefaultValueRule["when"];
  targetType?: TypeTarget;
  onTypeError?: ConversionFailureMode;
  dateOutput?: "date" | "date-time";
}

/**
 * UI-friendly combined mapping stage. A field may also declare a default and
 * output type; the adapter expands those to deterministic engine steps after
 * key mapping.
 */
export interface WorkbenchMappingStage extends WorkbenchStageBase {
  kind: "mapping";
  collectionPath?: string;
  fields: WorkbenchMappingField[];
  preserveUnmapped?: boolean;
}

export interface WorkbenchFilterRule {
  id?: string;
  enabled?: boolean;
  path: string;
  operator: FilterOperator;
  value?: StructuredData;
  caseSensitive?: boolean;
}

export interface WorkbenchFilterStage extends WorkbenchStageBase {
  kind: "filter";
  collectionPath?: string;
  rules: WorkbenchFilterRule[];
  logic?: "and" | "or";
}

export interface WorkbenchSelectField {
  path: string;
  enabled?: boolean;
}

export interface WorkbenchSelectStage extends WorkbenchStageBase {
  kind: "select";
  collectionPath?: string;
  fields: Array<string | WorkbenchSelectField>;
}

export interface WorkbenchTypeRule {
  id?: string;
  enabled?: boolean;
  path: string;
  type: TypeTarget;
  onError?: ConversionFailureMode;
  dateOutput?: "date" | "date-time";
}

export interface WorkbenchTypeStage extends WorkbenchStageBase {
  kind: "type";
  collectionPath?: string;
  rules: WorkbenchTypeRule[];
}

export interface WorkbenchDefaultRule {
  id?: string;
  enabled?: boolean;
  path: string;
  value: StructuredData;
  when?: DefaultValueRule["when"];
}

export interface WorkbenchDefaultStage extends WorkbenchStageBase {
  kind: "default";
  collectionPath?: string;
  rules: WorkbenchDefaultRule[];
}

export interface WorkbenchFlattenStage extends WorkbenchStageBase {
  kind: "flatten";
  collectionPath?: string;
  notation?: "dot" | "underscore";
  arrays?: "indices" | "json-string";
}

export interface WorkbenchExtractStage extends WorkbenchStageBase {
  kind: "extract";
  language: "jsonpath" | "xpath";
  query: string;
}

export type WorkbenchStage =
  | WorkbenchMappingStage
  | WorkbenchFilterStage
  | WorkbenchSelectStage
  | WorkbenchTypeStage
  | WorkbenchDefaultStage
  | WorkbenchFlattenStage
  | WorkbenchExtractStage;

export interface WorkbenchSchemaConfig {
  schema: JsonSchema;
  target?: "input" | "output";
  /** Stops the remaining workflow when schema validation fails. Defaults to false. */
  blockOnError?: boolean;
}

export interface WorkbenchSchemaGenerationConfig extends SchemaGenerationOptions {
  target?: "input" | "output";
}

export interface WorkbenchRequest {
  input: string;
  parse?: ParseOptions;
  output: SerializeOptions;
  stages?: WorkbenchStage[];
  schema?: WorkbenchSchemaConfig;
  generateSchema?: boolean | WorkbenchSchemaGenerationConfig;
  diffMaxEntries?: number;
}

export type WorkbenchPhase = "parse" | "schema" | "transform" | "serialize" | "complete";

export interface WorkbenchResult {
  ok: boolean;
  phase: WorkbenchPhase;
  parse: ParseResult;
  steps: PipelineStep[];
  beforeData: StructuredData | null;
  afterData: StructuredData | null;
  transform: TransformResult | null;
  serialization: SerializeResult | null;
  diff: DiffResult | null;
  schemaValidation: SchemaValidationResult | null;
  generatedSchema: JsonSchema | null;
  diagnostics: DataDiagnostic[];
  output: string;
}

const DEFAULT_LABELS: Record<WorkbenchStage["kind"], string> = {
  extract: "Extract",
  flatten: "Flatten",
  mapping: "Key Mapping",
  filter: "Filter",
  type: "Type Conversion",
  default: "Default Values",
  select: "Field Selection",
};

function hasOwn(object: object, property: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

function stepId(stage: WorkbenchStage, index: number): string {
  return stage.id?.trim() || `workbench-${stage.kind}-${index + 1}`;
}

function stepLabel(stage: WorkbenchStage): string {
  return stage.label?.trim() || DEFAULT_LABELS[stage.kind];
}

function enabledMappingFields(stage: WorkbenchMappingStage): WorkbenchMappingField[] {
  return stage.fields.filter((field) => field.enabled !== false);
}

function mappingSteps(stage: WorkbenchMappingStage, id: string, label: string): PipelineStep[] {
  const fields = enabledMappingFields(stage);
  if (fields.length === 0) return [];
  const mappings: MappingRule[] = fields.map((field, fieldIndex) => {
    const mapping: MappingRule = {
      id: field.id,
      sourcePath: nonEmpty(field.source, `${label} source ${fieldIndex + 1}`),
      targetPath: nonEmpty(field.target, `${label} target ${fieldIndex + 1}`),
      required: field.required,
    };
    if (hasOwn(field, "defaultValue")) mapping.defaultValue = field.defaultValue ?? null;
    return mapping;
  });
  const steps: PipelineStep[] = [{
    id,
    label,
    operation: {
      type: "map",
      collectionPath: stage.collectionPath,
      mappings,
      preserveUnmapped: stage.preserveUnmapped ?? true,
    },
  }];

  const defaults = fields.flatMap<DefaultValueRule>((field) =>
    hasOwn(field, "defaultValue")
      ? [{
          id: field.id,
          path: field.target.trim(),
          value: field.defaultValue ?? null,
          when: field.defaultWhen ?? "missing",
        }]
      : []);
  if (defaults.length > 0) {
    steps.push({
      id: `${id}:defaults`,
      label: `${label} — Defaults`,
      operation: { type: "default-value", collectionPath: stage.collectionPath, rules: defaults },
    });
  }

  const conversions = fields.flatMap((field) => field.targetType
    ? [{
        id: field.id,
        path: field.target.trim(),
        targetType: field.targetType,
        onError: field.onTypeError,
        dateOutput: field.dateOutput,
      }]
    : []);
  if (conversions.length > 0) {
    steps.push({
      id: `${id}:types`,
      label: `${label} — Types`,
      operation: { type: "convert-type", collectionPath: stage.collectionPath, conversions },
    });
  }
  return steps;
}

/** Converts ordered GUI stages to the serializable engine pipeline contract. */
export function buildWorkbenchPipeline(stages: readonly WorkbenchStage[] = []): PipelineStep[] {
  const steps: PipelineStep[] = [];
  const usedIds = new Set<string>();

  const append = (step: PipelineStep) => {
    if (usedIds.has(step.id)) throw new Error(`Workbench step id is duplicated: ${step.id}`);
    usedIds.add(step.id);
    steps.push(step);
  };

  stages.forEach((stage, index) => {
    if (stage.enabled === false) return;
    const id = stepId(stage, index);
    const label = stepLabel(stage);
    if (stage.kind === "mapping") {
      mappingSteps(stage, id, label).forEach(append);
      return;
    }
    if (stage.kind === "filter") {
      const conditions: FilterCondition[] = stage.rules
        .filter((rule) => rule.enabled !== false)
        .map((rule, ruleIndex) => ({
          id: rule.id,
          path: nonEmpty(rule.path, `${label} path ${ruleIndex + 1}`),
          operator: rule.operator,
          ...(hasOwn(rule, "value") ? { value: rule.value ?? null } : {}),
          caseSensitive: rule.caseSensitive,
        }));
      if (conditions.length > 0) append({
        id,
        label,
        operation: { type: "filter", collectionPath: stage.collectionPath, conditions, logic: stage.logic ?? "and" },
      });
      return;
    }
    if (stage.kind === "select") {
      const paths = stage.fields.flatMap((field) => {
        if (typeof field === "string") return [nonEmpty(field, `${label} path`)];
        return field.enabled === false ? [] : [nonEmpty(field.path, `${label} path`)];
      });
      if (paths.length > 0) append({
        id,
        label,
        operation: { type: "select", collectionPath: stage.collectionPath, paths },
      });
      return;
    }
    if (stage.kind === "type") {
      const conversions = stage.rules
        .filter((rule) => rule.enabled !== false)
        .map((rule, ruleIndex) => ({
          id: rule.id,
          path: nonEmpty(rule.path, `${label} path ${ruleIndex + 1}`),
          targetType: rule.type,
          onError: rule.onError,
          dateOutput: rule.dateOutput,
        }));
      if (conversions.length > 0) append({
        id,
        label,
        operation: { type: "convert-type", collectionPath: stage.collectionPath, conversions },
      });
      return;
    }
    if (stage.kind === "default") {
      const rules = stage.rules
        .filter((rule) => rule.enabled !== false)
        .map((rule, ruleIndex) => ({
          id: rule.id,
          path: nonEmpty(rule.path, `${label} path ${ruleIndex + 1}`),
          value: rule.value,
          when: rule.when,
        }));
      if (rules.length > 0) append({
        id,
        label,
        operation: { type: "default-value", collectionPath: stage.collectionPath, rules },
      });
      return;
    }
    if (stage.kind === "flatten") {
      append({
        id,
        label,
        operation: {
          type: "flatten",
          collectionPath: stage.collectionPath,
          notation: stage.notation ?? "dot",
          arrays: stage.arrays ?? "indices",
        },
      });
      return;
    }
    append({
      id,
      label,
      operation: {
        type: "extract",
        language: stage.language,
        query: nonEmpty(stage.query, `${label} query`),
      },
    });
  });
  return steps;
}

function configDiagnostic(reason: string): DataDiagnostic {
  return {
    severity: "error",
    source: "system",
    code: "WORKBENCH_CONFIG_INVALID",
    message: reason,
    reason,
  };
}

function schemaOptions(config: WorkbenchRequest["generateSchema"]): SchemaGenerationOptions {
  if (!config || config === true) return {};
  return {
    title: config.title,
    inferFormats: config.inferFormats,
    additionalProperties: config.additionalProperties,
  };
}

function schemaTarget(config: WorkbenchRequest["generateSchema"]): "input" | "output" {
  return typeof config === "object" ? config.target ?? "input" : "input";
}

function resultShell(parse: ParseResult, steps: PipelineStep[]): WorkbenchResult {
  return {
    ok: false,
    phase: "parse",
    parse,
    steps,
    beforeData: parse.data,
    afterData: null,
    transform: null,
    serialization: null,
    diff: null,
    schemaValidation: null,
    generatedSchema: null,
    diagnostics: [...parse.errors, ...parse.warnings],
    output: "",
  };
}

/**
 * Pure workbench controller: parse → optional input schema → transform →
 * optional output schema → diff → serialize. It performs no storage, network,
 * clipboard or download side effects, so the same function is Worker-safe.
 */
export function runWorkbench(request: WorkbenchRequest): WorkbenchResult {
  const parse = parseData(request.input, request.parse);
  let steps: PipelineStep[];
  try {
    steps = buildWorkbenchPipeline(request.stages);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The workbench configuration is invalid.";
    const result = resultShell(parse, []);
    result.diagnostics.push(configDiagnostic(reason));
    return result;
  }
  const result = resultShell(parse, steps);
  if (!parse.ok || parse.data === null) return result;

  const beforeData = parse.data;
  let schemaValidation: SchemaValidationResult | null = null;
  if (request.schema && (request.schema.target ?? "input") === "input") {
    schemaValidation = validateJsonSchema(beforeData, request.schema.schema);
    result.schemaValidation = schemaValidation;
    result.diagnostics.push(...schemaValidation.errors);
    if (!schemaValidation.valid && request.schema.blockOnError) {
      result.phase = "schema";
      return result;
    }
  }

  const transform = runPipeline(beforeData, steps);
  result.transform = transform;
  result.afterData = transform.data;
  result.diagnostics.push(...transform.errors, ...transform.warnings);
  result.phase = "transform";

  if (request.schema && (request.schema.target ?? "input") === "output") {
    schemaValidation = validateJsonSchema(transform.data, request.schema.schema);
    result.schemaValidation = schemaValidation;
    result.diagnostics.push(...schemaValidation.errors);
    if (!schemaValidation.valid && request.schema.blockOnError) {
      result.phase = "schema";
      result.diff = compareData(beforeData, transform.data, { maxEntries: request.diffMaxEntries });
      return result;
    }
  }

  if (request.generateSchema) {
    const target = schemaTarget(request.generateSchema) === "output" ? transform.data : beforeData;
    result.generatedSchema = generateJsonSchema(target, schemaOptions(request.generateSchema));
  }

  result.diff = compareData(beforeData, transform.data, { maxEntries: request.diffMaxEntries });
  const serialization = serializeData(transform.data, request.output);
  result.serialization = serialization;
  result.output = serialization.text;
  result.diagnostics.push(...serialization.errors, ...serialization.warnings);
  result.phase = serialization.ok ? "complete" : "serialize";
  result.ok = parse.ok && transform.ok && serialization.ok && (schemaValidation?.valid ?? true);
  return result;
}

export const createWorkbenchPreview = runWorkbench;
