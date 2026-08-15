export type DataFormat = "json" | "csv" | "xml" | "yaml";

export type JsonPrimitive = string | number | boolean | null;
export type StructuredData =
  | JsonPrimitive
  | StructuredData[]
  | { [key: string]: StructuredData };

export type DataObject = { [key: string]: StructuredData };

export type DiagnosticSeverity = "error" | "warning";
export type DiagnosticSource =
  | "detection"
  | "syntax"
  | "encoding"
  | "mapping"
  | "filter"
  | "type-conversion"
  | "schema"
  | "template"
  | "system";

/** A serializable error shape that can cross the Web Worker boundary. */
export interface DataDiagnostic {
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  code: string;
  message: string;
  reason: string;
  line?: number;
  column?: number;
  path?: string;
  stepId?: string;
  recordIndex?: number;
}

export interface FormatCandidate {
  format: DataFormat;
  confidence: number;
  reason: string;
}

export interface FormatDetection {
  format: DataFormat;
  confidence: number;
  reason: string;
  candidates: FormatCandidate[];
}

export type CsvDelimiter = "," | "\t" | ";" | "|";
export type TextEncoding = "utf-8" | "shift-jis";

export interface CsvParseOptions {
  header?: boolean;
  delimiter?: CsvDelimiter | "auto";
  trimHeaders?: boolean;
  skipEmptyLines?: boolean;
  expandDottedHeaders?: boolean;
}

export interface XmlParseOptions {
  attributePrefix?: string;
  textNodeName?: string;
  trimValues?: boolean;
}

export interface ParseOptions {
  format?: DataFormat | "auto";
  fileName?: string;
  encoding?: TextEncoding | "auto";
  csv?: CsvParseOptions;
  xml?: XmlParseOptions;
}

export interface ParseMetadata {
  characterCount: number;
  rowCount?: number;
  columnCount?: number;
  delimiter?: CsvDelimiter;
  encoding?: TextEncoding;
  rootName?: string;
}

export interface ParseResult {
  ok: boolean;
  detectedFormat: DataFormat;
  detection: FormatDetection;
  data: StructuredData | null;
  errors: DataDiagnostic[];
  warnings: DataDiagnostic[];
  metadata: ParseMetadata;
}

export type CsvNestedMode = "flatten" | "dot-notation" | "json-string";

export interface CsvSerializeOptions {
  header?: boolean;
  delimiter?: CsvDelimiter;
  lineEnding?: "\n" | "\r\n";
  nestedMode?: CsvNestedMode;
  includeBom?: boolean;
  encoding?: TextEncoding;
}

export interface XmlSerializeOptions {
  rootName?: string;
  declaration?: boolean;
  attributePrefix?: string;
  textNodeName?: string;
}

export interface SerializeOptions {
  format: DataFormat;
  indent?: 2 | 4;
  minify?: boolean;
  csv?: CsvSerializeOptions;
  xml?: XmlSerializeOptions;
}

export interface SerializeResult {
  ok: boolean;
  text: string;
  errors: DataDiagnostic[];
  warnings: DataDiagnostic[];
  mimeType: string;
  extension: DataFormat;
}

export type PathSegment = string | number;

export type TypeTarget = "string" | "number" | "boolean" | "date" | "null";
export type ConversionFailureMode = "keep" | "null";

export interface MappingRule {
  id?: string;
  sourcePath: string;
  targetPath: string;
  required?: boolean;
  defaultValue?: StructuredData;
}

export interface TypeConversionRule {
  id?: string;
  path: string;
  targetType: TypeTarget;
  onError?: ConversionFailureMode;
  dateOutput?: "date" | "date-time";
}

export type FilterOperator =
  | "equals"
  | "not-equals"
  | "contains"
  | "not-contains"
  | "starts-with"
  | "ends-with"
  | "greater-than"
  | "greater-than-or-equal"
  | "less-than"
  | "less-than-or-equal"
  | "exists"
  | "not-exists"
  | "is-empty"
  | "is-not-empty";

export interface FilterCondition {
  id?: string;
  path: string;
  operator: FilterOperator;
  value?: StructuredData;
  caseSensitive?: boolean;
}

export interface DefaultValueRule {
  id?: string;
  path: string;
  value: StructuredData;
  when?: "missing" | "nullish" | "empty";
}

export interface FlattenOperation {
  type: "flatten";
  collectionPath?: string;
  notation?: "dot" | "underscore";
  arrays?: "indices" | "json-string";
}

export interface MapOperation {
  type: "map";
  collectionPath?: string;
  mappings: MappingRule[];
  preserveUnmapped?: boolean;
}

export interface FilterOperation {
  type: "filter";
  collectionPath?: string;
  conditions: FilterCondition[];
  logic?: "and" | "or";
}

export interface SelectOperation {
  type: "select";
  collectionPath?: string;
  paths: string[];
}

export interface ConvertTypeOperation {
  type: "convert-type";
  collectionPath?: string;
  conversions: TypeConversionRule[];
}

export interface DefaultValueOperation {
  type: "default-value";
  collectionPath?: string;
  rules: DefaultValueRule[];
}

export interface ExtractOperation {
  type: "extract";
  language: "jsonpath" | "xpath";
  query: string;
}

export type TransformOperation =
  | FlattenOperation
  | MapOperation
  | FilterOperation
  | SelectOperation
  | ConvertTypeOperation
  | DefaultValueOperation
  | ExtractOperation;

export interface PipelineStep {
  id: string;
  label: string;
  enabled?: boolean;
  operation: TransformOperation;
}

export interface TransformStats {
  inputRecords: number;
  outputRecords: number;
  durationMs: number;
}

export interface TransformResult {
  ok: boolean;
  data: StructuredData;
  errors: DataDiagnostic[];
  warnings: DataDiagnostic[];
  appliedStepIds: string[];
  stats: TransformStats;
}

export type DiffKind = "added" | "removed" | "changed";

export interface DiffEntry {
  kind: DiffKind;
  path: string;
  before?: StructuredData;
  after?: StructuredData;
}

export interface DiffResult {
  entries: DiffEntry[];
  added: number;
  removed: number;
  changed: number;
  totalChanges: number;
  truncated: boolean;
  identical: boolean;
}

/** Deliberately small JSON Schema Draft-07 model; custom keywords remain allowed. */
export interface JsonSchema {
  [keyword: string]: unknown;
  $schema?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  format?: string;
  pattern?: string;
  title?: string;
}

export interface SchemaGenerationOptions {
  title?: string;
  inferFormats?: boolean;
  additionalProperties?: boolean;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: DataDiagnostic[];
}

export interface TransformTemplate {
  version: 1;
  id: string;
  name: string;
  description?: string;
  inputFormat: DataFormat | "auto";
  output: SerializeOptions;
  steps: PipelineStep[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  id?: string;
  name: string;
  description?: string;
  inputFormat?: DataFormat | "auto";
  output: SerializeOptions;
  steps: PipelineStep[];
  now?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
