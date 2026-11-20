"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  Code2,
  Copy,
  Database,
  Download,
  FileCode2,
  FileInput,
  FileUp,
  Filter,
  GitCompareArrows,
  GripVertical,
  Layers3,
  ListFilter,
  LockKeyhole,
  Minimize2,
  PanelLeft,
  Play,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  TreePine,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import {
  compareData as compareStructuredData,
  decodeTextBuffer,
  detectFormat as detectStructuredFormat,
  encodeSerializedText,
  generateJsonSchema,
  parseData,
  runPipeline,
  serializeData,
  validateJsonSchema,
  type CsvDelimiter,
  type CsvNestedMode,
  type DataDiagnostic,
  type DataFormat,
  type FilterOperator,
  type JsonSchema,
  type PipelineStep as EnginePipelineStep,
  type StructuredData,
  type TextEncoding,
} from "@/lib";
import { DataWorkerClient, createRequestId } from "@/lib/worker-client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type UIEvent,
} from "react";

type InputFormat = "auto" | DataFormat;
type InputMethod = "paste" | "upload" | "sample";
type PreviewTab = "tree" | "table" | "diff" | "validation";
type MobileArea = "source" | "studio" | "flow";
type MappingType = "string" | "number" | "boolean" | "date" | "null";
type FlowKind = "validate" | "extract" | "flatten" | "mapping" | "filter" | "convert" | "select";

interface FilterRule {
  id: string;
  path: string;
  operator: FilterOperator;
  value: string;
  caseSensitive: boolean;
}

interface ExtractionSettings {
  enabled: boolean;
  language: "jsonpath" | "xpath";
  query: string;
}

interface CsvSettings {
  delimiter: CsvDelimiter;
  header: boolean;
  inputEncoding: TextEncoding | "auto";
  outputEncoding: TextEncoding;
  nestedMode: CsvNestedMode;
}

interface MappingRule {
  id: string;
  enabled: boolean;
  source: string;
  target: string;
  type: MappingType;
  defaultValue: string;
}

interface FlowStep {
  id: string;
  kind: FlowKind;
  title: string;
  detail: string;
  enabled: boolean;
}

interface SyntaxIssue {
  line: number;
  column: number;
  reason: string;
  category: "syntax" | "mapping" | "conversion";
}

interface PreviewResult {
  output: string;
  beforeRecords: Record<string, unknown>[];
  afterRecords: Record<string, unknown>[];
  beforeData: StructuredData;
  afterData: StructuredData;
  issues: SyntaxIssue[];
  diagnostics: DataDiagnostic[];
}

interface StoredTemplate {
  id: string;
  name: string;
  description: string;
  outputFormat: DataFormat;
  mappings: MappingRule[];
  steps: FlowStep[];
  filters?: FilterRule[];
  filterLogic?: "and" | "or";
  extraction?: ExtractionSettings;
  csvSettings?: CsvSettings;
  indent?: 2 | 4;
  minify?: boolean;
  schema?: string;
  sampleId?: "ec" | "legacy";
  builtIn?: boolean;
}

const FORMAT_LABELS: Record<DataFormat, string> = {
  json: "JSON",
  csv: "CSV",
  xml: "XML",
  yaml: "YAML",
};

const EC_SAMPLE = `{
  "orders": [
    {
      "order_id": "EC-2026-0813-001",
      "customer_name": "佐藤 花子",
      "customer": { "address": { "city": "渋谷区" } },
      "status": "active",
      "amount": "12800",
      "ordered_at": "2026-08-13T09:15:00+09:00"
    },
    {
      "order_id": "EC-2026-0813-002",
      "customer_name": "鈴木 一郎",
      "customer": { "address": { "city": "横浜市" } },
      "status": "pending",
      "amount": "8400",
      "ordered_at": "2026-08-13T10:40:00+09:00"
    },
    {
      "order_id": "EC-2026-0813-003",
      "customer_name": "高橋 美咲",
      "customer": { "address": { "city": "世田谷区" } },
      "status": "active",
      "amount": "24600",
      "ordered_at": "2026-08-13T11:05:00+09:00"
    }
  ]
}`;

const LEGACY_XML_SAMPLE = `<customers generated="2026-08-13">
  <customer>
    <customer_id>C-001</customer_id>
    <customer_name>佐藤 花子</customer_name>
    <status>active</status>
  </customer>
  <customer>
    <customer_id>C-002</customer_id>
    <customer_name>鈴木 一郎</customer_name>
    <status>inactive</status>
  </customer>
</customers>`;

const INITIAL_MAPPINGS: MappingRule[] = [
  { id: "map-order", enabled: true, source: "order_id", target: "orderId", type: "string", defaultValue: "" },
  { id: "map-name", enabled: true, source: "customer_name", target: "customerName", type: "string", defaultValue: "" },
  { id: "map-city", enabled: true, source: "customer.address.city", target: "address.cityName", type: "string", defaultValue: "不明" },
  { id: "map-status", enabled: true, source: "status", target: "status", type: "string", defaultValue: "active" },
  { id: "map-amount", enabled: true, source: "amount", target: "amount", type: "number", defaultValue: "0" },
  { id: "map-date", enabled: true, source: "ordered_at", target: "orderedAt", type: "date", defaultValue: "" },
];

const INITIAL_STEPS: FlowStep[] = [
  { id: "step-validate", kind: "validate", title: "構文・Schema検証", detail: "Line / Columnまで特定", enabled: true },
  { id: "step-extract", kind: "extract", title: "JSONPathで抽出", detail: "$.orders[*]", enabled: true },
  { id: "step-flatten", kind: "flatten", title: "Nested dataをFlatten", detail: "Dot notationで展開", enabled: true },
  { id: "step-mapping", kind: "mapping", title: "Key Mapping", detail: "6 fieldsを出力先へ割り当て", enabled: true },
  { id: "step-filter", kind: "filter", title: "有効注文だけ抽出", detail: "status = active", enabled: true },
  { id: "step-convert", kind: "convert", title: "Type Conversion", detail: "amount → number / 日付を統一", enabled: true },
  { id: "step-select", kind: "select", title: "Field Selection", detail: "選択済みのFieldだけ出力", enabled: true },
];

const INITIAL_FILTERS: FilterRule[] = [
  { id: "filter-status", path: "status", operator: "equals", value: "active", caseSensitive: false },
];

const INITIAL_CSV_SETTINGS: CsvSettings = {
  delimiter: ",",
  header: true,
  inputEncoding: "auto",
  outputEncoding: "utf-8",
  nestedMode: "dot-notation",
};

const BUILT_IN_TEMPLATES: StoredTemplate[] = [
  {
    id: "template-ec",
    name: "EC API → 基幹CSV",
    description: "受注JSONをFlatten・Mapping・FilterしてCSVへ",
    outputFormat: "csv",
    mappings: INITIAL_MAPPINGS,
    steps: INITIAL_STEPS,
    sampleId: "ec",
    builtIn: true,
  },
  {
    id: "template-legacy",
    name: "Legacy XML → JSON",
    description: "旧顧客XMLを移行確認用JSONへ",
    outputFormat: "json",
    mappings: [
      { id: "legacy-id", enabled: true, source: "customer_id", target: "customerId", type: "string", defaultValue: "" },
      { id: "legacy-name", enabled: true, source: "customer_name", target: "customerName", type: "string", defaultValue: "" },
      { id: "legacy-status", enabled: true, source: "status", target: "status", type: "string", defaultValue: "unknown" },
    ],
    steps: INITIAL_STEPS.map((step) => step.kind === "extract"
      ? { ...step, title: "XPathで顧客を抽出", detail: "//customer" }
      : step).filter((step) => step.kind !== "flatten"),
    sampleId: "legacy",
    builtIn: true,
  },
];

const STORAGE_KEY = "data-shift-transform-templates";
const EMPTY_PREVIEW: PreviewResult = {
  output: "",
  beforeRecords: [],
  afterRecords: [],
  beforeData: null,
  afterData: null,
  issues: [],
  diagnostics: [],
};

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function countTextLines(value: string) {
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenRecord(record: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value)) Object.assign(result, flattenRecord(value, path));
    else result[path] = value;
  }
  return result;
}

function runLocalPreview(
  source: string,
  inputFormat: DataFormat,
  outputFormat: DataFormat,
  mappings: MappingRule[],
  steps: FlowStep[],
  indent: 2 | 4,
  minified: boolean,
  filters: FilterRule[] = INITIAL_FILTERS,
  filterLogic: "and" | "or" = "and",
  extraction: ExtractionSettings = { enabled: true, language: "jsonpath", query: "$.orders[*]" },
  csv: CsvSettings = INITIAL_CSV_SETTINGS,
): PreviewResult {
  const parseResult = parseData(source, {
    format: inputFormat,
    encoding: csv.inputEncoding,
    csv: { header: csv.header, delimiter: csv.delimiter, trimHeaders: true, skipEmptyLines: true, expandDottedHeaders: true },
  });
  const beforeData = parseResult.data ?? null;
  const engineSteps = buildEngineSteps(mappings, steps, filters, filterLogic, extraction);
  const transformed = parseResult.ok && parseResult.data !== null
    ? runPipeline(parseResult.data, engineSteps)
    : { ok: false, data: beforeData, errors: [], warnings: [], appliedStepIds: [], stats: { inputRecords: 0, outputRecords: 0, durationMs: 0 } };
  const serialized = parseResult.ok
    ? serializeData(transformed.data, {
        format: outputFormat,
        indent,
        minify: minified,
        csv: {
          header: csv.header,
          delimiter: csv.delimiter,
          nestedMode: csv.nestedMode,
          encoding: csv.outputEncoding,
          includeBom: csv.outputEncoding === "utf-8",
          lineEnding: "\r\n",
        },
        xml: { rootName: "data", declaration: true, attributePrefix: "@", textNodeName: "#text" },
      })
    : { ok: false, text: "", errors: [], warnings: [], mimeType: "text/plain", extension: outputFormat };
  const diagnostics = [
    ...parseResult.errors,
    ...parseResult.warnings,
    ...transformed.errors,
    ...transformed.warnings,
    ...serialized.errors,
    ...serialized.warnings,
  ];
  return {
    output: serialized.ok ? serialized.text : "",
    beforeRecords: recordsForView(beforeData),
    afterRecords: recordsForView(transformed.data),
    beforeData,
    afterData: transformed.data,
    diagnostics,
    issues: diagnostics.filter((item) => item.severity === "error").map(diagnosticToIssue),
  };
}

function diagnosticToIssue(diagnostic: DataDiagnostic): SyntaxIssue {
  return {
    line: diagnostic.line ?? (diagnostic.recordIndex === undefined ? 1 : diagnostic.recordIndex + 1),
    column: diagnostic.column ?? 1,
    reason: diagnostic.reason,
    category: diagnostic.source === "mapping" || diagnostic.source === "filter"
      ? "mapping"
      : diagnostic.source === "type-conversion" ? "conversion" : "syntax",
  };
}

function recordsForView(data: StructuredData): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord) as Record<string, unknown>[];
  if (isRecord(data)) {
    const nestedArray = Object.values(data).find(Array.isArray);
    if (Array.isArray(nestedArray)) return nestedArray.filter(isRecord) as Record<string, unknown>[];
    const nestedObject = Object.values(data).find((value) => isRecord(value) && Object.values(value).some(Array.isArray));
    if (isRecord(nestedObject)) {
      const deepArray = Object.values(nestedObject).find(Array.isArray);
      if (Array.isArray(deepArray)) return deepArray.filter(isRecord) as Record<string, unknown>[];
    }
    return [data];
  }
  return [];
}

function filterValue(value: string): StructuredData {
  const trimmed = value.trim();
  if (trimmed === '""' || trimmed === "''") return "";
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return value;
}

function buildEngineSteps(
  mappings: MappingRule[],
  steps: FlowStep[],
  filters: FilterRule[],
  filterLogic: "and" | "or",
  extraction: ExtractionSettings,
): EnginePipelineStep[] {
  const selectedMappings = mappings.filter((mapping) => mapping.enabled && mapping.source.trim() && mapping.target.trim());
  return steps.flatMap<EnginePipelineStep>((step) => {
    if (!step.enabled || step.kind === "validate") return [];
    if (step.kind === "extract") {
      if (!extraction.enabled || !extraction.query.trim()) return [];
      return [{ id: step.id, label: step.title, enabled: true, operation: { type: "extract", language: extraction.language, query: extraction.query.trim() } }];
    }
    if (step.kind === "flatten") return [{ id: step.id, label: step.title, enabled: true, operation: { type: "flatten", notation: "dot", arrays: "json-string" } }];
    if (step.kind === "mapping") return [{
      id: step.id,
      label: step.title,
      enabled: true,
      operation: {
        type: "map",
        preserveUnmapped: false,
        mappings: selectedMappings.map((mapping) => ({
          id: mapping.id,
          sourcePath: mapping.source,
          targetPath: mapping.target,
          required: mapping.defaultValue === "",
          ...(mapping.defaultValue !== "" ? { defaultValue: filterValue(mapping.defaultValue) } : {}),
        })),
      },
    }];
    if (step.kind === "filter") return filters.length ? [{
      id: step.id,
      label: step.title,
      enabled: true,
      operation: {
        type: "filter",
        logic: filterLogic,
        conditions: filters.map((rule) => ({
          id: rule.id,
          path: rule.path,
          operator: rule.operator,
          value: filterValue(rule.value),
          caseSensitive: rule.caseSensitive,
        })),
      },
    }] : [];
    if (step.kind === "convert") return [{
      id: step.id,
      label: step.title,
      enabled: true,
      operation: {
        type: "convert-type",
        conversions: selectedMappings.map((mapping) => ({ id: mapping.id, path: mapping.target, targetType: mapping.type, onError: "null", dateOutput: "date-time" })),
      },
    }];
    return [{ id: step.id, label: step.title, enabled: true, operation: { type: "select", paths: selectedMappings.map((mapping) => mapping.target) } }];
  });
}

function formatSource(source: string, format: DataFormat, indent: 2 | 4, minify: boolean, csv: CsvSettings) {
  const parsed = parseData(source, {
    format,
    encoding: csv.inputEncoding,
    csv: { header: csv.header, delimiter: csv.delimiter, trimHeaders: true, skipEmptyLines: true, expandDottedHeaders: true },
  });
  if (!parsed.ok || parsed.data === null) throw new Error(parsed.errors[0]?.reason ?? `${FORMAT_LABELS[format]}をParseできません。`);
  const serialized = serializeData(parsed.data, {
    format,
    indent,
    minify,
    csv: { header: csv.header, delimiter: csv.delimiter, nestedMode: csv.nestedMode, encoding: csv.outputEncoding, includeBom: false, lineEnding: "\r\n" },
    xml: { declaration: true, attributePrefix: "@", textNodeName: "#text" },
  });
  if (!serialized.ok) throw new Error(serialized.errors[0]?.reason ?? `${FORMAT_LABELS[format]}をSerializeできません。`);
  return serialized.text;
}

function valuePreview(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return `“${value}”`;
  if (typeof value === "object") return Array.isArray(value) ? `Array(${value.length})` : `{${Object.keys(value as object).length}}`;
  return String(value);
}

function collectPaths(records: Record<string, unknown>[]) {
  return [...new Set(records.flatMap((record) => Object.keys(flattenRecord(record))))];
}

function buildDiff(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  return compareStructuredData(before as StructuredData, after as StructuredData, { maxEntries: 2_000 }).entries.map((entry) => ({
    path: entry.path,
    beforeValue: entry.before,
    afterValue: entry.after,
    status: entry.kind,
  }));
}

function flowIcon(kind: FlowKind) {
  const props = { size: 15, "aria-hidden": true } as const;
  if (kind === "validate") return <ShieldCheck {...props} />;
  if (kind === "extract") return <Database {...props} />;
  if (kind === "flatten") return <Layers3 {...props} />;
  if (kind === "mapping") return <ArrowRightLeft {...props} />;
  if (kind === "filter") return <Filter {...props} />;
  if (kind === "convert") return <Settings2 {...props} />;
  return <ListFilter {...props} />;
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Braces size={21} />
      <ArrowRight size={15} />
    </span>
  );
}

function CodePane({
  label,
  value,
  format,
  readOnly = false,
  issue,
  onChange,
  actions,
}: {
  label: string;
  value: string;
  format: DataFormat;
  readOnly?: boolean;
  issue?: SyntaxIssue;
  onChange?: (value: string) => void;
  actions?: ReactNode;
}) {
  const gutterRef = useRef<HTMLPreElement>(null);
  const lineCount = countTextLines(value);
  const visibleGutterLines = Math.min(lineCount, 5_000);
  const editorValue = readOnly && value.length > 500_000
    ? `${value.slice(0, 500_000)}\n\n… Previewは500,000文字まで表示しています。Copy / Downloadには完全な変換結果を使用します。`
    : value;
  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  return (
    <article className={`code-pane ${issue ? "has-error" : ""}`}>
      <header className="code-pane-header">
        <div>
          <span className="code-pane-icon"><Code2 size={15} /></span>
          <div><small>{label}</small><strong>{FORMAT_LABELS[format]}</strong></div>
        </div>
        <div className="code-pane-actions">{actions}</div>
      </header>
      <div className="code-editor-wrap">
        <pre ref={gutterRef} className="line-gutter" aria-hidden="true">
          {Array.from({ length: visibleGutterLines }, (_, index) => index + 1).join("\n")}{lineCount > visibleGutterLines ? `\n…\n${lineCount}` : ""}
        </pre>
        <textarea
          className="code-editor"
          aria-label={`${label} ${FORMAT_LABELS[format]} editor`}
          value={editorValue}
          readOnly={readOnly}
          spellCheck={false}
          wrap="off"
          onScroll={handleScroll}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        />
      </div>
      <footer className="code-pane-footer">
        <span>{lineCount.toLocaleString("ja-JP")} lines</span>
        <span>{new Blob([value]).size.toLocaleString("ja-JP")} bytes</span>
        {issue ? <strong><CircleAlert size={12} /> Line {issue.line}, Column {issue.column}</strong> : <em><Check size={12} /> Ready</em>}
      </footer>
    </article>
  );
}

function TreeNode({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const expandable = Array.isArray(value) || isRecord(value);
  const totalEntries = Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 0;
  const visibleEntries = Array.isArray(value)
    ? value.slice(0, 200).map((item, index) => [String(index), item] as const)
    : isRecord(value) ? Object.entries(value).slice(0, 200) : [];

  return (
    <div className="tree-node">
      <button
        type="button"
        className="tree-row"
        style={{ paddingInlineStart: `${10 + depth * 18}px` }}
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen((current) => !current)}
      >
        <span className="tree-chevron">{expandable ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}</span>
        <strong>{name}</strong>
        <span className={`tree-value type-${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`}>
          {expandable ? Array.isArray(value) ? `[ ${value.length} items ]` : `{ ${totalEntries} keys }` : valuePreview(value)}
        </span>
      </button>
      {expandable && open ? <div role="group">{visibleEntries.map(([key, child]) => <TreeNode key={key} name={key} value={child} depth={depth + 1} />)}{totalEntries > visibleEntries.length ? <div className="tree-overflow" style={{ paddingInlineStart: `${34 + depth * 18}px` }}>ほか {totalEntries - visibleEntries.length} 件はTable Viewで仮想表示できます</div> : null}</div> : null}
    </div>
  );
}

function TreeView({ records }: { records: Record<string, unknown>[] }) {
  return (
    <div className="tree-view" role="tree" aria-label="変換後データツリー">
      <TreeNode name="root" value={records} />
    </div>
  );
}

function TableView({ records }: { records: Record<string, unknown>[] }) {
  const flattened = useMemo(() => records.map((record) => flattenRecord(record)), [records]);
  const headers = useMemo(() => [...new Set(flattened.flatMap((record) => Object.keys(record)))], [flattened]);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 35;
  const viewportHeight = 278;
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const endIndex = Math.min(flattened.length, startIndex + visibleCount + 8);
  const visibleRows = flattened.slice(startIndex, endIndex);
  return (
    <div className="table-scroller" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <table className="data-table">
        <thead><tr><th>#</th>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {flattened.length ? <>
            {startIndex > 0 ? <tr className="virtual-spacer" aria-hidden="true"><td colSpan={headers.length + 1} style={{ height: startIndex * rowHeight }} /></tr> : null}
            {visibleRows.map((record, visibleIndex) => {
              const rowIndex = startIndex + visibleIndex;
              return <tr key={rowIndex}><th>{rowIndex + 1}</th>{headers.map((header) => <td key={header} title={String(record[header] ?? "")}>{valuePreview(record[header])}</td>)}</tr>;
            })}
            {endIndex < flattened.length ? <tr className="virtual-spacer" aria-hidden="true"><td colSpan={headers.length + 1} style={{ height: (flattened.length - endIndex) * rowHeight }} /></tr> : null}
          </> : <tr><td colSpan={Math.max(1, headers.length + 1)} className="empty-cell">表示できる配列データがありません。</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function DiffView({ before, after }: { before: Record<string, unknown>[]; after: Record<string, unknown>[] }) {
  const diff = buildDiff(before, after);
  const counts = {
    added: diff.filter((item) => item.status === "added").length,
    removed: diff.filter((item) => item.status === "removed").length,
    changed: diff.filter((item) => item.status === "changed").length,
  };
  return (
    <div className="diff-view">
      <div className="diff-summary">
        <span className="added"><Plus size={13} />Added {counts.added}</span>
        <span className="removed"><Minimize2 size={13} />Removed {counts.removed}</span>
        <span className="changed"><ArrowRightLeft size={13} />Changed {counts.changed}</span>
      </div>
      <div className="diff-list">
        {diff.slice(0, 80).map((item) => (
          <article key={`${item.path}-${item.status}`} className={`diff-row ${item.status}`}>
            <span className="diff-status">{item.status === "added" ? "+" : item.status === "removed" ? "−" : "~"}</span>
            <strong>{item.path}</strong>
            <span>{item.status === "added" ? "—" : valuePreview(item.beforeValue)}</span>
            <ArrowRight size={13} />
            <span>{item.status === "removed" ? "—" : valuePreview(item.afterValue)}</span>
          </article>
        ))}
        {!diff.length ? <div className="empty-view"><CheckCircle2 size={26} /><strong>構造差分はありません</strong></div> : null}
      </div>
    </div>
  );
}

function ValidationView({
  issues,
  records,
  schema,
  schemaStatus,
  onSchemaChange,
  onGenerateSchema,
  onValidateSchema,
}: {
  issues: SyntaxIssue[];
  records: Record<string, unknown>[];
  schema: string;
  schemaStatus: "idle" | "valid" | "invalid";
  onSchemaChange: (value: string) => void;
  onGenerateSchema: () => void;
  onValidateSchema: () => void;
}) {
  const syntaxCount = issues.filter((issue) => issue.category === "syntax").length;
  const mappingCount = issues.filter((issue) => issue.category === "mapping").length;
  const conversionCount = issues.filter((issue) => issue.category === "conversion").length;
  return (
    <div className="validation-view">
      <div className="validation-metrics">
        <article className={issues.length ? "metric-card bad" : "metric-card good"}><strong>{issues.length ? "要確認" : "Valid"}</strong><span>Validation status</span></article>
        <article className="metric-card"><strong>{syntaxCount}</strong><span>Syntax errors</span></article>
        <article className="metric-card"><strong>{mappingCount}</strong><span>Mapping failures</span></article>
        <article className="metric-card"><strong>{conversionCount}</strong><span>Type conversion</span></article>
      </div>
      <div className="validation-content">
        <section className="issue-panel">
          <header><div><small>ISSUE INSPECTOR</small><strong>Line / Column / Reason</strong></div><span>{issues.length}件</span></header>
          {issues.length ? <ol>{issues.map((issue, index) => (
            <li key={`${issue.category}-${index}`}>
              <span className={`issue-kind ${issue.category}`}>{issue.category === "syntax" ? "Syntax" : issue.category === "mapping" ? "Mapping" : "Type"}</span>
              <strong>Line {issue.line}</strong><strong>Column {issue.column}</strong><p>{issue.reason}</p>
            </li>
          ))}</ol> : <div className="validation-empty"><ShieldCheck size={30} /><strong>構文と変換ルールを通過しました</strong><span>{records.length}件の出力候補をブラウザ内で確認済みです。</span></div>}
        </section>
        <section className="schema-panel">
          <header><div><small>JSON SCHEMA</small><strong>生成・編集・実データ検証</strong></div><div className="schema-actions"><span className={`schema-status ${schemaStatus}`}>{schemaStatus === "valid" ? "Valid" : schemaStatus === "invalid" ? "Invalid" : "未検証"}</span><button type="button" className="mini-button" onClick={onGenerateSchema}><Sparkles size={13} />生成</button><button type="button" className="mini-button" onClick={onValidateSchema} disabled={!schema.trim()}><Play size={12} />検証</button></div></header>
          {schema ? <textarea className="schema-editor" aria-label="JSON Schema editor" value={schema} spellCheck={false} onChange={(event) => onSchemaChange(event.target.value)} /> : <div className="schema-empty"><Braces size={25} /><p>通常ロジックで型と必須Fieldを推定します。生成後に編集してValidationへ利用できます。</p></div>}
        </section>
      </div>
    </div>
  );
}

function MappingSheet({
  mappings,
  sourcePaths,
  onChange,
  onClose,
  onApply,
}: {
  mappings: MappingRule[];
  sourcePaths: string[];
  onChange: (mappings: MappingRule[]) => void;
  onClose: () => void;
  onApply: () => void;
}) {
  const update = (id: string, patch: Partial<MappingRule>) => onChange(mappings.map((mapping) => mapping.id === id ? { ...mapping, ...patch } : mapping));
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="mapping-sheet" role="dialog" aria-modal="true" aria-labelledby="mapping-heading" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          <div><span className="sheet-icon"><ArrowRightLeft size={18} /></span><div><small>KEY MAPPING</small><h2 id="mapping-heading">入力Pathを出力Fieldへ割り当て</h2></div></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Mappingを閉じる"><X size={18} /></button>
        </header>
        <div className="mapping-intro">
          <div><strong>Nested Mapping対応</strong><span>Dot notationで階層を指定できます。Checkを外したFieldは出力されません。</span></div>
          <span className="mapping-count">{mappings.filter((mapping) => mapping.enabled).length} / {mappings.length} fields</span>
        </div>
        <datalist id="source-path-list">{sourcePaths.map((path) => <option value={path} key={path} />)}</datalist>
        <div className="mapping-table-wrap">
          <div className="mapping-head"><span>出力</span><span>入力Path</span><i /><span>出力Path</span><span>Type</span><span>Default</span><i /></div>
          <div className="mapping-list">
            {mappings.map((mapping) => (
              <div className={`mapping-row ${mapping.enabled ? "" : "is-disabled"}`} key={mapping.id}>
                <label className="field-toggle"><input type="checkbox" checked={mapping.enabled} onChange={(event) => update(mapping.id, { enabled: event.target.checked })} /><span><Check size={12} /></span><em className="visually-hidden">出力する</em></label>
                <input aria-label="入力Path" list="source-path-list" value={mapping.source} onChange={(event) => update(mapping.id, { source: event.target.value })} placeholder="customer.address.city" />
                <span className="mapping-arrow"><ArrowRight size={15} /></span>
                <input aria-label="出力Path" value={mapping.target} onChange={(event) => update(mapping.id, { target: event.target.value })} placeholder="address.cityName" />
                <select aria-label="出力Type" value={mapping.type} onChange={(event) => update(mapping.id, { type: event.target.value as MappingType })}>
                  <option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="date">date</option><option value="null">null</option>
                </select>
                <input aria-label="Default value" value={mapping.defaultValue} onChange={(event) => update(mapping.id, { defaultValue: event.target.value })} placeholder={'未設定 / null / "" / 0'} title={'空文字をDefaultにする場合は "" と入力'} />
                <button type="button" className="icon-button compact danger" aria-label={`${mapping.source}を削除`} onClick={() => onChange(mappings.filter((item) => item.id !== mapping.id))}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="add-mapping-button" onClick={() => onChange([...mappings, { id: uniqueId("mapping"), enabled: true, source: "", target: "", type: "string", defaultValue: "" }])}><Plus size={15} />Mappingを追加</button>
        <footer className="sheet-footer">
          <p><LockKeyhole size={13} />Mapping設定とSample値は外部サーバーへ送信しません。本番ページ末尾の広告配信（忍者AdMax）は、これらのデータとは無関係です。</p>
          <div><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button type="button" className="button primary" onClick={onApply}><Check size={15} />Mappingを適用</button></div>
        </footer>
      </section>
    </div>
  );
}

function PipelineSettingsSheet({
  initialSection,
  filters,
  filterLogic,
  extraction,
  csv,
  sourcePaths,
  onFiltersChange,
  onFilterLogicChange,
  onExtractionChange,
  onCsvChange,
  onClose,
}: {
  initialSection: "filter" | "extract" | "csv";
  filters: FilterRule[];
  filterLogic: "and" | "or";
  extraction: ExtractionSettings;
  csv: CsvSettings;
  sourcePaths: string[];
  onFiltersChange: (rules: FilterRule[]) => void;
  onFilterLogicChange: (logic: "and" | "or") => void;
  onExtractionChange: (settings: ExtractionSettings) => void;
  onCsvChange: (settings: CsvSettings) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState(initialSection);
  const updateFilter = (id: string, patch: Partial<FilterRule>) => onFiltersChange(filters.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  const operators: Array<{ value: FilterOperator; label: string }> = [
    { value: "equals", label: "= 等しい" }, { value: "not-equals", label: "≠ 等しくない" },
    { value: "contains", label: "含む" }, { value: "not-contains", label: "含まない" },
    { value: "greater-than", label: "> より大きい" }, { value: "greater-than-or-equal", label: "≥ 以上" },
    { value: "less-than", label: "< より小さい" }, { value: "less-than-or-equal", label: "≤ 以下" },
    { value: "starts-with", label: "で始まる" }, { value: "ends-with", label: "で終わる" },
    { value: "exists", label: "存在する" }, { value: "not-exists", label: "存在しない" },
    { value: "is-empty", label: "空である" }, { value: "is-not-empty", label: "空でない" },
  ];
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-heading" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sheet-header"><div><span className="sheet-icon"><Settings2 size={18} /></span><div><small>PIPELINE SETTINGS</small><h2 id="settings-heading">抽出・Filter・CSV設定</h2></div></div><button type="button" className="icon-button" onClick={onClose} aria-label="設定を閉じる"><X size={18} /></button></header>
        <nav className="settings-tabs" aria-label="設定カテゴリ">
          <button type="button" className={section === "extract" ? "is-active" : ""} onClick={() => setSection("extract")}><Database size={14} />JSONPath / XPath</button>
          <button type="button" className={section === "filter" ? "is-active" : ""} onClick={() => setSection("filter")}><Filter size={14} />Filter条件</button>
          <button type="button" className={section === "csv" ? "is-active" : ""} onClick={() => setSection("csv")}><Table2 size={14} />CSV入出力</button>
        </nav>
        <div className="settings-body">
          {section === "extract" ? <section className="setting-section">
            <div className="setting-title"><div><small>DATA EXTRACTION</small><h3>必要なCollectionだけを先に抽出</h3><p>JSONPath / XPathの安全なSubsetをブラウザ内で評価します。</p></div><label className="switch"><input type="checkbox" checked={extraction.enabled} onChange={(event) => onExtractionChange({ ...extraction, enabled: event.target.checked })} /><span /><em>{extraction.enabled ? "有効" : "無効"}</em></label></div>
            <div className="extract-builder">
              <label className="form-field"><span>Query language</span><select value={extraction.language} onChange={(event) => onExtractionChange({ ...extraction, language: event.target.value as "jsonpath" | "xpath", query: event.target.value === "xpath" ? "//customer" : "$.orders[*]" })}><option value="jsonpath">JSONPath</option><option value="xpath">XPath</option></select></label>
              <label className="form-field grow"><span>Extraction query</span><input value={extraction.query} onChange={(event) => onExtractionChange({ ...extraction, query: event.target.value })} placeholder={extraction.language === "jsonpath" ? "$.orders[*]" : "//customer"} /></label>
            </div>
            <div className="syntax-help"><Code2 size={15} /><p><strong>{extraction.language === "jsonpath" ? "対応: $.key / [0] / [*] / ['key']" : "対応: /a/b[1] / //b / @id / text() / *"}</strong><span>一致しない場合はValidationへ「EXTRACTION_NO_MATCH」を表示します。</span></p></div>
          </section> : null}

          {section === "filter" ? <section className="setting-section">
            <div className="setting-title"><div><small>FILTER BUILDER</small><h3>Path・Operator・ValueでDataを抽出</h3><p>例: status = active、amount &gt; 10000</p></div><div className="logic-control"><button type="button" className={filterLogic === "and" ? "is-active" : ""} onClick={() => onFilterLogicChange("and")}>AND</button><button type="button" className={filterLogic === "or" ? "is-active" : ""} onClick={() => onFilterLogicChange("or")}>OR</button></div></div>
            <datalist id="filter-path-list">{sourcePaths.map((path) => <option value={path} key={path} />)}</datalist>
            <div className="filter-list">
              <div className="filter-head"><span>#</span><span>Field path</span><span>Operator</span><span>Value</span><span>Case</span><i /></div>
              {filters.map((rule, index) => <div className="filter-row" key={rule.id}>
                <span>{index + 1}</span>
                <input aria-label="Filter field path" list="filter-path-list" value={rule.path} onChange={(event) => updateFilter(rule.id, { path: event.target.value })} placeholder="status" />
                <select aria-label="Filter operator" value={rule.operator} onChange={(event) => updateFilter(rule.id, { operator: event.target.value as FilterOperator })}>{operators.map((operator) => <option value={operator.value} key={operator.value}>{operator.label}</option>)}</select>
                <input aria-label="Filter value" value={rule.value} disabled={["exists", "not-exists", "is-empty", "is-not-empty"].includes(rule.operator)} onChange={(event) => updateFilter(rule.id, { value: event.target.value })} placeholder={'active / 10000 / null / ""'} title={'空文字との比較は "" と入力'} />
                <label className="case-toggle"><input type="checkbox" checked={rule.caseSensitive} onChange={(event) => updateFilter(rule.id, { caseSensitive: event.target.checked })} /><span>Aa</span></label>
                <button type="button" className="icon-button compact danger" onClick={() => onFiltersChange(filters.filter((item) => item.id !== rule.id))} aria-label="Filterを削除"><Trash2 size={13} /></button>
              </div>)}
            </div>
            <button type="button" className="inline-add-button" onClick={() => onFiltersChange([...filters, { id: uniqueId("filter"), path: "", operator: "equals", value: "", caseSensitive: false }])}><Plus size={14} />条件を追加</button>
          </section> : null}

          {section === "csv" ? <section className="setting-section">
            <div className="setting-title"><div><small>CSV OPTIONS</small><h3>Header・Delimiter・Encoding・Nested data</h3><p>Input parseとExportを別々の文字Codeで扱えます。</p></div><span className="local-option"><LockKeyhole size={13} />Local codec</span></div>
            <div className="csv-settings-grid">
              <label className="form-field"><span>Delimiter</span><select value={csv.delimiter} onChange={(event) => onCsvChange({ ...csv, delimiter: event.target.value as CsvDelimiter })}><option value=",">Comma (,)</option><option value="\t">Tab</option><option value=";">Semicolon (;)</option><option value="|">Pipe (|)</option></select></label>
              <label className="form-field"><span>Header</span><select value={csv.header ? "yes" : "no"} onChange={(event) => onCsvChange({ ...csv, header: event.target.value === "yes" })}><option value="yes">1行目をHeaderとして使用</option><option value="no">Headerなし（column1…）</option></select></label>
              <label className="form-field"><span>Input Encoding</span><select value={csv.inputEncoding} onChange={(event) => onCsvChange({ ...csv, inputEncoding: event.target.value as TextEncoding | "auto" })}><option value="auto">Auto detect</option><option value="utf-8">UTF-8</option><option value="shift-jis">Shift-JIS</option></select></label>
              <label className="form-field"><span>Output Encoding</span><select value={csv.outputEncoding} onChange={(event) => onCsvChange({ ...csv, outputEncoding: event.target.value as TextEncoding })}><option value="utf-8">UTF-8 + BOM</option><option value="shift-jis">Shift-JIS</option></select></label>
              <label className="form-field wide"><span>Nested data mode</span><select value={csv.nestedMode} onChange={(event) => onCsvChange({ ...csv, nestedMode: event.target.value as CsvNestedMode })}><option value="dot-notation">Dot notation — address.city</option><option value="flatten">Flatten — address_city</option><option value="json-string">JSON String — nested objectを1セルへ</option></select></label>
            </div>
            <div className="syntax-help"><Table2 size={15} /><p><strong>引用符、セル内改行、重複Header、列数差を検証</strong><span>Shift-JISで表現できない文字がある場合はDownloadを停止します。</span></p></div>
          </section> : null}
        </div>
        <footer className="sheet-footer"><p><LockKeyhole size={13} />設定変更は即座にLocal Previewへ反映</p><div><button type="button" className="button primary" onClick={onClose}><Check size={15} />設定を適用</button></div></footer>
      </section>
    </div>
  );
}

function TemplateSheet({ onClose, onSave }: { onClose: () => void; onSave: (name: string, description: string) => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave(String(data.get("name") ?? ""), String(data.get("description") ?? ""));
  };
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="template-sheet" role="dialog" aria-modal="true" aria-labelledby="template-heading" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header className="sheet-header"><div><span className="sheet-icon"><Save size={18} /></span><div><small>REUSABLE TEMPLATE</small><h2 id="template-heading">変換設定をTemplateとして保存</h2></div></div><button type="button" className="icon-button" onClick={onClose} aria-label="閉じる"><X size={18} /></button></header>
        <div className="template-sheet-body">
          <div className="template-callout"><Play size={18} /><div><strong>次回はPaste → Template → Transformだけ</strong><span>Mapping、Filter、Type、出力Formatをブラウザへ保存します。</span></div></div>
          <label className="form-field"><span>Template名</span><input name="name" defaultValue="API A → System B" required autoFocus /></label>
          <label className="form-field"><span>説明</span><textarea name="description" rows={3} defaultValue="定例のシステム間データ連携用" /></label>
        </div>
        <footer className="sheet-footer"><p><LockKeyhole size={13} />localStorageに設定だけを保存</p><div><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button type="submit" className="button primary"><Save size={15} />保存</button></div></footer>
      </form>
    </div>
  );
}

export function TransformWorkbench() {
  const [input, setInput] = useState(EC_SAMPLE);
  const [inputMethod, setInputMethod] = useState<InputMethod>("sample");
  const [inputFormat, setInputFormat] = useState<InputFormat>("auto");
  const [outputFormat, setOutputFormat] = useState<DataFormat>("csv");
  const [indent, setIndent] = useState<2 | 4>(2);
  const [outputMinified, setOutputMinified] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("tree");
  const [mobileArea, setMobileArea] = useState<MobileArea>("studio");
  const [mappings, setMappings] = useState<MappingRule[]>(INITIAL_MAPPINGS);
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>(INITIAL_STEPS);
  const [filters, setFilters] = useState<FilterRule[]>(INITIAL_FILTERS);
  const [filterLogic, setFilterLogic] = useState<"and" | "or">("and");
  const [extraction, setExtraction] = useState<ExtractionSettings>({ enabled: true, language: "jsonpath", query: "$.orders[*]" });
  const [csvSettings, setCsvSettings] = useState<CsvSettings>(INITIAL_CSV_SETTINGS);
  const [templates, setTemplates] = useState<StoredTemplate[]>(BUILT_IN_TEMPLATES);
  const [showMapping, setShowMapping] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showSettings, setShowSettings] = useState<"filter" | "extract" | "csv" | null>(null);
  const [showStepMenu, setShowStepMenu] = useState(false);
  const [schema, setSchema] = useState("");
  const [schemaIssues, setSchemaIssues] = useState<SyntaxIssue[]>([]);
  const [schemaStatus, setSchemaStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState("ec-orders.json");
  const [toast, setToast] = useState<string>();
  const [workerPreview, setWorkerPreview] = useState<{ key: string; result: PreviewResult }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<DataWorkerClient | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as StoredTemplate[];
          setTemplates([...BUILT_IN_TEMPLATES, ...parsed]);
        }
      } catch {
        // A blocked or corrupt localStorage should not prevent local conversion.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => workerRef.current?.dispose(), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const detectedFormat = useMemo(() => detectStructuredFormat(input, fileName).format, [fileName, input]);
  const effectiveInputFormat = inputFormat === "auto" ? detectedFormat : inputFormat;
  const estimatedRecords = useMemo(() => {
    if (effectiveInputFormat === "csv") return Math.max(0, input.split(/\r?\n/).length - (csvSettings.header ? 1 : 0));
    const objectBoundaries = input.match(/}\s*,\s*{/g)?.length ?? 0;
    return objectBoundaries + 1;
  }, [csvSettings.header, effectiveInputFormat, input]);
  const useWorker = new Blob([input]).size > 200_000 || estimatedRecords > 5_000;
  const previewKey = useMemo(() => JSON.stringify({ input, effectiveInputFormat, outputFormat, mappings, flowSteps, indent, outputMinified, filters, filterLogic, extraction, csvSettings }), [csvSettings, effectiveInputFormat, extraction, filterLogic, filters, flowSteps, indent, input, mappings, outputFormat, outputMinified]);
  const localPreview = useMemo(
    () => useWorker ? EMPTY_PREVIEW : runLocalPreview(input, effectiveInputFormat, outputFormat, mappings, flowSteps, indent, outputMinified, filters, filterLogic, extraction, csvSettings),
    [csvSettings, effectiveInputFormat, extraction, filterLogic, filters, flowSteps, indent, input, mappings, outputFormat, outputMinified, useWorker],
  );
  const preview = useWorker && workerPreview?.key === previewKey ? workerPreview.result : localPreview;

  useEffect(() => {
    if (!useWorker) return;
    let cancelled = false;
    const client = workerRef.current ?? new DataWorkerClient();
    workerRef.current = client;
    const engineSteps = buildEngineSteps(mappings, flowSteps, filters, filterLogic, extraction);
    const parseOptions = {
      format: effectiveInputFormat,
      fileName,
      encoding: csvSettings.inputEncoding,
      csv: { header: csvSettings.header, delimiter: csvSettings.delimiter, trimHeaders: true, skipEmptyLines: true, expandDottedHeaders: true },
    } as const;
    const serializeOptions = {
      format: outputFormat,
      indent,
      minify: outputMinified,
      csv: { header: csvSettings.header, delimiter: csvSettings.delimiter, nestedMode: csvSettings.nestedMode, encoding: csvSettings.outputEncoding, includeBom: csvSettings.outputEncoding === "utf-8", lineEnding: "\r\n" as const },
      xml: { rootName: "data", declaration: true, attributePrefix: "@", textNodeName: "#text" },
    } as const;
    void (async () => {
      setIsProcessing(true);
      try {
        const parsedResponse = await client.request({ id: createRequestId("parse-text"), kind: "parse-text", source: input, options: parseOptions });
        if (parsedResponse.kind !== "parse-text" || cancelled) return;
        const parsed = parsedResponse.result;
        if (!parsed.ok || parsed.data === null) {
          const diagnostics = [...parsed.errors, ...parsed.warnings];
          setWorkerPreview({ key: previewKey, result: { ...EMPTY_PREVIEW, beforeData: parsed.data ?? null, afterData: parsed.data ?? null, diagnostics, issues: diagnostics.filter((item) => item.severity === "error").map(diagnosticToIssue) } });
          return;
        }
        const transformedResponse = await client.request({ id: createRequestId("transform"), kind: "transform", data: parsed.data, steps: engineSteps });
        if (transformedResponse.kind !== "transform" || cancelled) return;
        const transformed = transformedResponse.result;
        const serializedResponse = await client.request({ id: createRequestId("serialize"), kind: "serialize", data: transformed.data, options: serializeOptions });
        if (serializedResponse.kind !== "serialize" || cancelled) return;
        const serialized = serializedResponse.result;
        const diagnostics = [...parsed.errors, ...parsed.warnings, ...transformed.errors, ...transformed.warnings, ...serialized.errors, ...serialized.warnings];
        setWorkerPreview({
          key: previewKey,
          result: {
            output: serialized.ok ? serialized.text : "",
            beforeRecords: recordsForView(parsed.data),
            afterRecords: recordsForView(transformed.data),
            beforeData: parsed.data,
            afterData: transformed.data,
            diagnostics,
            issues: diagnostics.filter((item) => item.severity === "error").map(diagnosticToIssue),
          },
        });
      } catch (error) {
        if (!cancelled) {
          try {
            const fallback = runLocalPreview(input, effectiveInputFormat, outputFormat, mappings, flowSteps, indent, outputMinified, filters, filterLogic, extraction, csvSettings);
            const workerWarning: DataDiagnostic = {
              severity: "warning",
              source: "system",
              code: "WORKER_FALLBACK",
              message: "Web Workerを再起動できなかったため、今回だけMain threadで処理しました。",
              reason: error instanceof Error ? error.message : "Web Worker処理に失敗しました。",
            };
            setWorkerPreview({ key: previewKey, result: { ...fallback, diagnostics: [...fallback.diagnostics, workerWarning] } });
          } catch (fallbackError) {
            setWorkerPreview({ key: previewKey, result: { ...EMPTY_PREVIEW, issues: [{ line: 1, column: 1, reason: fallbackError instanceof Error ? fallbackError.message : "Local fallback処理に失敗しました。", category: "syntax" }] } });
          }
        }
      } finally {
        if (!cancelled) setIsProcessing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [csvSettings, effectiveInputFormat, extraction, fileName, filterLogic, filters, flowSteps, indent, input, mappings, outputFormat, outputMinified, previewKey, useWorker]);
  const sourcePaths = useMemo(() => collectPaths(preview.beforeRecords), [preview.beforeRecords]);
  const allIssues = useMemo(() => [...preview.issues, ...schemaIssues], [preview.issues, schemaIssues]);
  const firstIssue = allIssues[0];

  const loadSample = (id: "ec" | "legacy") => {
    if (id === "ec") {
      setInput(EC_SAMPLE);
      setFileName("ec-api-orders.json");
      setInputFormat("auto");
      setOutputFormat("csv");
      setMappings(INITIAL_MAPPINGS.map((mapping) => ({ ...mapping })));
      setFlowSteps(INITIAL_STEPS.map((step) => ({ ...step })));
      setFilters(INITIAL_FILTERS.map((rule) => ({ ...rule })));
      setExtraction({ enabled: true, language: "jsonpath", query: "$.orders[*]" });
    } else {
      setInput(LEGACY_XML_SAMPLE);
      setFileName("legacy-customers.xml");
      setInputFormat("auto");
      setOutputFormat("json");
      setMappings(BUILT_IN_TEMPLATES[1].mappings.map((mapping) => ({ ...mapping })));
      setFlowSteps(BUILT_IN_TEMPLATES[1].steps.map((step) => ({ ...step })));
      setFilters([]);
      setExtraction({ enabled: true, language: "xpath", query: "//customer" });
    }
    setInputMethod("sample");
    setSchema("");
    setSchemaIssues([]);
    setSchemaStatus("idle");
    setMobileArea("studio");
    setToast(id === "ec" ? "EC API Demoを読み込みました。" : "Legacy XML Demoを読み込みました。");
  };

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      const decoded = await decodeTextBuffer(await file.arrayBuffer(), csvSettings.inputEncoding);
      setInput(decoded.text);
      setFileName(file.name);
      setInputMethod("upload");
      setInputFormat("auto");
      setSchema("");
      setSchemaIssues([]);
      setSchemaStatus("idle");
      setMobileArea("studio");
      setToast(`${file.name}をブラウザ内で読み込みました。`);
    } catch {
      setToast("File Encodingを確認できませんでした。UTF-8形式をお試しください。");
    } finally {
      setIsProcessing(false);
      event.target.value = "";
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToast(`${label}をClipboardへコピーしました。`);
    } catch {
      setToast("Clipboardへコピーできませんでした。");
    }
  };

  const downloadOutput = async () => {
    if (!preview.output) {
      setToast("Validation Errorを修正してからDownloadしてください。");
      return;
    }
    const serialized = serializeData(preview.afterData, {
      format: outputFormat,
      indent,
      minify: outputMinified,
      csv: { header: csvSettings.header, delimiter: csvSettings.delimiter, nestedMode: csvSettings.nestedMode, encoding: csvSettings.outputEncoding, includeBom: csvSettings.outputEncoding === "utf-8", lineEnding: "\r\n" },
      xml: { rootName: "data", declaration: true, attributePrefix: "@", textNodeName: "#text" },
    });
    try {
      const bytes = await encodeSerializedText(serialized, outputFormat === "csv" ? csvSettings.outputEncoding : "utf-8", outputFormat === "csv" && csvSettings.outputEncoding === "utf-8");
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([buffer], { type: serialized.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transformed-data.${outputFormat === "yaml" ? "yaml" : outputFormat}`;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast(`${FORMAT_LABELS[outputFormat]}をDownloadしました。`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Download用の文字Code変換に失敗しました。");
    }
  };

  const applyTemplate = (template: StoredTemplate) => {
    if (template.sampleId) loadSample(template.sampleId);
    setMappings(template.mappings.map((mapping) => ({ ...mapping })));
    setFlowSteps(template.steps.map((step) => ({ ...step })));
    setOutputFormat(template.outputFormat);
    setFilters((template.filters ?? (template.sampleId === "ec" ? INITIAL_FILTERS : [])).map((rule) => ({ ...rule })));
    setFilterLogic(template.filterLogic ?? "and");
    if (template.extraction) setExtraction({ ...template.extraction });
    setCsvSettings({ ...INITIAL_CSV_SETTINGS, ...(template.csvSettings ?? {}) });
    setIndent(template.indent ?? 2);
    setOutputMinified(template.minify ?? false);
    setSchema(template.schema ?? "");
    setSchemaIssues([]);
    setSchemaStatus("idle");
    setToast(`「${template.name}」を適用しました。`);
  };

  const saveTemplate = (name: string, description: string) => {
    const stored: StoredTemplate = {
      id: uniqueId("template"),
      name,
      description,
      outputFormat,
      mappings: mappings.map((mapping) => ({ ...mapping })),
      steps: flowSteps.map((step) => ({ ...step })),
      filters: filters.map((rule) => ({ ...rule })),
      filterLogic,
      extraction: { ...extraction },
      csvSettings: { ...csvSettings },
      indent,
      minify: outputMinified,
      schema,
    };
    const custom = [...templates.filter((template) => !template.builtIn), stored];
    setTemplates([...BUILT_IN_TEMPLATES, ...custom]);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); } catch { /* UI remains usable without persistence. */ }
    setShowTemplate(false);
    setToast(`Template「${name}」をブラウザへ保存しました。`);
  };

  const deleteTemplate = (id: string) => {
    const custom = templates.filter((template) => !template.builtIn && template.id !== id);
    setTemplates([...BUILT_IN_TEMPLATES, ...custom]);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); } catch { /* Ignore blocked storage. */ }
    setToast("Templateを削除しました。");
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= flowSteps.length) return;
    setFlowSteps((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const toggleStep = (id: string) => setFlowSteps((current) => current.map((step) => step.id === id ? { ...step, enabled: !step.enabled } : step));
  const updateMappingSummary = () => setFlowSteps((current) => current.map((step) => step.kind === "mapping" ? { ...step, detail: `${mappings.filter((mapping) => mapping.enabled).length} fieldsを出力先へ割り当て` } : step));

  const addFlowStep = (kind: FlowKind) => {
    const presets: Record<FlowKind, Omit<FlowStep, "id">> = {
      validate: { kind, title: "JSON Schema Validation", detail: "Schemaルールを追加", enabled: true },
      extract: { kind, title: "JSONPath / XPath", detail: "Collectionを先に抽出", enabled: true },
      flatten: { kind, title: "Flatten", detail: "Nested dataをDot notationへ", enabled: true },
      mapping: { kind, title: "Key Mapping", detail: "GUIでPathを割り当て", enabled: true },
      filter: { kind, title: "Filter", detail: "条件を指定して抽出", enabled: true },
      convert: { kind, title: "Type Conversion", detail: "string / number / date", enabled: true },
      select: { kind, title: "Field Selection", detail: "出力Fieldだけ選択", enabled: true },
    };
    setFlowSteps((current) => [...current, { ...presets[kind], id: uniqueId("step") }]);
    setShowStepMenu(false);
  };

  const generateSchemaFromOutput = () => {
    const generated = generateJsonSchema(preview.afterData, { title: "Transformed data", inferFormats: true, additionalProperties: false });
    setSchema(JSON.stringify(generated, null, 2));
    setSchemaIssues([]);
    setSchemaStatus("idle");
    setPreviewTab("validation");
    setToast("SampleからJSON Schema候補を生成しました。");
  };

  const validateSchemaNow = () => {
    try {
      const parsed = JSON.parse(schema) as JsonSchema;
      const result = validateJsonSchema(preview.afterData, parsed);
      const issues = result.errors.map(diagnosticToIssue);
      setSchemaIssues(issues);
      setSchemaStatus(result.valid ? "valid" : "invalid");
      setToast(result.valid ? "JSON Schema Validationを通過しました。" : `${issues.length}件のSchema Errorがあります。`);
    } catch (error) {
      setSchemaIssues([{ line: 1, column: 1, reason: error instanceof Error ? `Schema JSON: ${error.message}` : "Schema JSONをParseできません。", category: "syntax" }]);
      setSchemaStatus("invalid");
      setToast("JSON Schema自体の構文を確認してください。");
    }
  };

  const openStepSettings = (kind: FlowKind) => {
    if (kind === "mapping") setShowMapping(true);
    else if (kind === "filter") setShowSettings("filter");
    else if (kind === "extract") setShowSettings("extract");
    else if (kind === "validate") setPreviewTab("validation");
    else setToast("このStepの設定はPipelineへ反映されています。");
  };

  return (
    <div className="workbench-shell">
      <header className="app-header">
        <div className="brand-lockup"><BrandMark /><div><strong>JSON・CSV・XML・YAML変換ツール</strong><span>業務効率化 / データ変換・開発支援</span></div></div>
        <div className="header-context">
          <span className="detected-pill"><Sparkles size={13} />AUTO DETECT <strong>{FORMAT_LABELS[detectedFormat]}</strong></span>
          <span className="local-pill"><LockKeyhole size={13} />ブラウザ内処理</span>
        </div>
        <div className="header-actions">
          <button type="button" className="button secondary header-action" onClick={() => setShowTemplate(true)}><Save size={15} /><span>Template保存</span></button>
          <button type="button" className="button primary header-action" onClick={downloadOutput} disabled={!preview.output}><Download size={16} /><span>Export</span></button>
        </div>
      </header>

      <nav className="mobile-area-tabs" aria-label="作業領域">
        <button type="button" className={mobileArea === "source" ? "is-active" : ""} onClick={() => setMobileArea("source")}><PanelLeft size={15} />入力</button>
        <button type="button" className={mobileArea === "studio" ? "is-active" : ""} onClick={() => setMobileArea("studio")}><Code2 size={15} />Studio</button>
        <button type="button" className={mobileArea === "flow" ? "is-active" : ""} onClick={() => setMobileArea("flow")}><Layers3 size={15} />Flow</button>
      </nav>

      <div className={`workbench-layout mobile-show-${mobileArea}`}>
        <aside className="source-sidebar" aria-label="入力とTemplate">
          <section className="sidebar-section">
            <div className="panel-heading"><div><small>INPUT</small><h2>入力データ</h2></div><span>{fileName.split(".").at(-1)?.toUpperCase()}</span></div>
            <div className="input-methods" role="tablist" aria-label="入力方式">
              <button type="button" role="tab" aria-selected={inputMethod === "paste"} className={inputMethod === "paste" ? "is-active" : ""} onClick={() => { setInputMethod("paste"); setMobileArea("studio"); }}><ClipboardPaste size={14} />Paste</button>
              <button type="button" role="tab" aria-selected={inputMethod === "upload"} className={inputMethod === "upload" ? "is-active" : ""} onClick={() => fileInputRef.current?.click()}><FileUp size={14} />Upload</button>
              <button type="button" role="tab" aria-selected={inputMethod === "sample"} className={inputMethod === "sample" ? "is-active" : ""} onClick={() => loadSample("ec")}><Sparkles size={14} />Sample</button>
            </div>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept=".json,.csv,.xml,.yaml,.yml,text/*" onChange={loadFile} />
            <article className="source-file-card">
              <span className="source-file-icon"><FileCode2 size={18} /></span>
              <div><strong title={fileName}>{fileName}</strong><span>{new Blob([input]).size.toLocaleString("ja-JP")} bytes ・ {input.split("\n").length} lines</span></div>
              <span className={`source-validity ${firstIssue ? "bad" : "good"}`}>{firstIssue ? <CircleAlert size={13} /> : <Check size={13} />}{firstIssue ? "要確認" : "Valid"}</span>
            </article>
            <button type="button" className="upload-zone" onClick={() => fileInputRef.current?.click()}><UploadCloud size={20} /><span><strong>Fileを選択</strong><small>JSON / CSV / XML / YAML・端末内で読込</small></span></button>
          </section>

          <section className="sidebar-section">
            <div className="panel-heading"><div><small>DEMO MODE</small><h2>業務Demo</h2></div><span>2</span></div>
            <div className="demo-list">
              <button type="button" onClick={() => loadSample("ec")}><span className="demo-icon blue"><Braces size={16} /></span><span><strong>EC API JSON</strong><small>Mapping → Flatten → CSV</small></span><Play size={13} /></button>
              <button type="button" onClick={() => loadSample("legacy")}><span className="demo-icon amber"><FileCode2 size={16} /></span><span><strong>Legacy XML</strong><small>旧システム → JSON</small></span><Play size={13} /></button>
            </div>
          </section>

          <section className="sidebar-section template-section">
            <div className="panel-heading"><div><small>TEMPLATES</small><h2>変換Template</h2></div><button type="button" className="icon-button compact" aria-label="Templateを保存" onClick={() => setShowTemplate(true)}><Plus size={14} /></button></div>
            <div className="template-list">
              {templates.map((template) => (
                <article className="template-card" key={template.id}>
                  <button type="button" className="template-run" onClick={() => applyTemplate(template)}><span><Play size={12} fill="currentColor" /></span><div><strong>{template.name}</strong><small>{template.steps.length} steps ・ {FORMAT_LABELS[template.outputFormat]}</small></div></button>
                  {!template.builtIn ? <button type="button" className="icon-button compact danger" aria-label={`${template.name}を削除`} onClick={() => deleteTemplate(template.id)}><Trash2 size={13} /></button> : null}
                </article>
              ))}
            </div>
          </section>

          <div className="privacy-card"><span><LockKeyhole size={16} /></span><div><strong>Local-first</strong><p>入力、Mapping、変換結果は外部サーバーへ送信しません。本番ページ末尾の広告配信（忍者AdMax）は、これらのデータとは無関係です。</p></div><CheckCircle2 size={15} /></div>
        </aside>

        <main className="studio-area">
          <div className="studio-heading">
            <div><span className="eyebrow">TRANSFORMATION STUDIO</span><h1>入力と出力を並べて、変換を設計</h1><p>{preview.beforeRecords.length} records → {preview.afterRecords.length} records ・ {mappings.filter((mapping) => mapping.enabled).length} fields ・ Local preview</p></div>
            <button type="button" className="button primary run-button" disabled={isProcessing} onClick={() => setToast(allIssues.length ? "Validation結果を確認してください。" : `${preview.afterRecords.length}件を${FORMAT_LABELS[outputFormat]}へ変換しました。`)}>{isProcessing ? <span className="spinner" /> : <WandSparkles size={16} />}{isProcessing ? "処理中" : "変換を実行"}</button>
          </div>

          <section className="editor-stage" aria-label="Input and output editor">
            <div className="editor-grid">
              <CodePane
                label="INPUT"
                value={input}
                format={effectiveInputFormat}
                issue={firstIssue?.category === "syntax" ? firstIssue : undefined}
                onChange={(value) => { setInput(value); setInputMethod("paste"); setSchema(""); }}
                actions={<>
                  <label className="format-select"><span className="visually-hidden">入力Format</span><select value={inputFormat} onChange={(event) => setInputFormat(event.target.value as InputFormat)}><option value="auto">Auto: {FORMAT_LABELS[detectedFormat]}</option><option value="json">JSON</option><option value="csv">CSV</option><option value="xml">XML</option><option value="yaml">YAML</option></select></label>
                  <button type="button" className="mini-button" onClick={() => { try { setInput(formatSource(input, effectiveInputFormat, indent, false, csvSettings)); } catch (error) { setToast(error instanceof Error ? error.message : "構文エラーを修正してからPretty Printしてください。"); } }}><Code2 size={13} />Pretty</button>
                  <button type="button" className="mini-button icon-only-mobile" onClick={() => { try { setInput(formatSource(input, effectiveInputFormat, indent, true, csvSettings)); } catch (error) { setToast(error instanceof Error ? error.message : "構文エラーを修正してからMinifyしてください。"); } }}><Minimize2 size={13} /><span>Minify</span></button>
                  <div className="indent-control" aria-label="Indent"><button type="button" className={indent === 2 ? "is-active" : ""} onClick={() => setIndent(2)}>2</button><button type="button" className={indent === 4 ? "is-active" : ""} onClick={() => setIndent(4)}>4</button></div>
                </>}
              />
              <div className="editor-transform-arrow" aria-hidden="true"><ArrowRight size={15} /></div>
              <CodePane
                label="OUTPUT"
                value={preview.output || "Validation Errorを修正すると、ここに変換結果が表示されます。"}
                format={outputFormat}
                readOnly
                issue={firstIssue}
                actions={<>
                  <label className="format-select"><span className="visually-hidden">出力Format</span><select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as DataFormat)}><option value="json">JSON</option><option value="csv">CSV</option><option value="xml">XML</option><option value="yaml">YAML</option></select></label>
                  {outputFormat === "csv" ? <button type="button" className="mini-button icon-only" aria-label="CSV設定" onClick={() => setShowSettings("csv")}><Settings2 size={13} /></button> : null}
                  <button type="button" className={`mini-button ${outputMinified ? "is-active" : ""}`} onClick={() => setOutputMinified((current) => !current)}><Minimize2 size={13} />Minify</button>
                  <button type="button" className="mini-button icon-only" aria-label="出力をコピー" onClick={() => copyText(preview.output, "変換結果")} disabled={!preview.output}><Copy size={13} /></button>
                  <button type="button" className="mini-button icon-only" aria-label="出力をDownload" onClick={downloadOutput} disabled={!preview.output}><Download size={13} /></button>
                </>}
              />
            </div>
            <div className="editor-status-strip">
              <span><Sparkles size={12} />Format Detection: <strong>{FORMAT_LABELS[detectedFormat]}</strong>{inputFormat !== "auto" ? `（手動: ${FORMAT_LABELS[effectiveInputFormat]}）` : "（自動）"}</span>
              <button type="button" className="status-link" onClick={() => setShowSettings("csv")}><Database size={12} />CSV: Header {csvSettings.header ? "あり" : "なし"}・{csvSettings.delimiter === "\t" ? "Tab" : csvSettings.delimiter}・{csvSettings.outputEncoding.toUpperCase()}</button>
              <span className={firstIssue ? "status-bad" : "status-good"}>{firstIssue ? <CircleAlert size={12} /> : <ShieldCheck size={12} />}{firstIssue ? firstIssue.reason : "Syntax validation passed"}</span>
            </div>
          </section>

          <section className="data-preview-card" aria-label="Structured data preview">
            <header className="preview-toolbar">
              <div className="preview-tabs" role="tablist" aria-label="Data view">
                <button type="button" role="tab" aria-selected={previewTab === "tree"} className={previewTab === "tree" ? "is-active" : ""} onClick={() => setPreviewTab("tree")}><TreePine size={14} />Tree</button>
                <button type="button" role="tab" aria-selected={previewTab === "table"} className={previewTab === "table" ? "is-active" : ""} onClick={() => setPreviewTab("table")}><Table2 size={14} />Table</button>
                <button type="button" role="tab" aria-selected={previewTab === "diff"} className={previewTab === "diff" ? "is-active" : ""} onClick={() => setPreviewTab("diff")}><GitCompareArrows size={14} />Diff</button>
                <button type="button" role="tab" aria-selected={previewTab === "validation"} className={previewTab === "validation" ? "is-active" : ""} onClick={() => setPreviewTab("validation")}><ShieldCheck size={14} />Validation <em>{allIssues.length}</em></button>
              </div>
              <div className="preview-toolbar-meta"><span>{preview.afterRecords.length} records</span><span>{collectPaths(preview.afterRecords).length} fields</span><strong className={allIssues.length ? "bad" : "good"}>{allIssues.length ? "要確認" : "最新"}</strong></div>
            </header>
            <div className="preview-content">
              {previewTab === "tree" ? <TreeView records={preview.afterRecords} /> : null}
              {previewTab === "table" ? <TableView records={preview.afterRecords} /> : null}
              {previewTab === "diff" ? <DiffView before={preview.beforeRecords} after={preview.afterRecords} /> : null}
              {previewTab === "validation" ? <ValidationView issues={allIssues} records={preview.afterRecords} schema={schema} schemaStatus={schemaStatus} onSchemaChange={(value) => { setSchema(value); setSchemaStatus("idle"); setSchemaIssues([]); }} onGenerateSchema={generateSchemaFromOutput} onValidateSchema={validateSchemaNow} /> : null}
            </div>
          </section>

          <div className="local-ribbon"><LockKeyhole size={14} /><div><strong>サーバー送信なし</strong><span>Parse・Validation・Mapping・Format変換・Downloadは、このブラウザ内で完結します。</span></div><span><Check size={12} />LOCAL PROCESSING</span></div>
        </main>

        <aside className="flow-sidebar" aria-label="Transformation flow">
          <div className="panel-heading flow-heading"><div><small>TRANSFORMATION FLOW</small><h2>変換Pipeline</h2></div><span>{flowSteps.filter((step) => step.enabled).length + 2} steps</span></div>
          <div className="flow-source-node"><span className="flow-node-index"><FileInput size={14} /></span><div><small>INPUT</small><strong>{FORMAT_LABELS[effectiveInputFormat]} Input</strong><em>{fileName}</em></div><Check size={14} /></div>
          <ol className="flow-list">
            {flowSteps.map((step, index) => (
              <li key={step.id} className={step.enabled ? "" : "is-disabled"}>
                <article className={`flow-step ${step.kind === "mapping" ? "is-featured" : ""}`}>
                  <button type="button" className="step-toggle" aria-label={`${step.title}を${step.enabled ? "無効" : "有効"}にする`} aria-pressed={step.enabled} onClick={() => toggleStep(step.id)}><span>{step.enabled ? <Check size={11} /> : index + 1}</span></button>
                  <span className="step-grip"><GripVertical size={14} /></span>
                  <button type="button" className="step-main" onClick={() => openStepSettings(step.kind)}>
                    <span className="step-kind">{flowIcon(step.kind)}{step.kind.toUpperCase()}</span><strong>{step.title}</strong><small>{step.detail}</small>
                  </button>
                  <div className="step-actions"><button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="上へ移動"><ArrowUp size={12} /></button><button type="button" onClick={() => moveStep(index, 1)} disabled={index === flowSteps.length - 1} aria-label="下へ移動"><ArrowDown size={12} /></button><button type="button" className="danger" onClick={() => setFlowSteps((current) => current.filter((item) => item.id !== step.id))} aria-label="削除"><Trash2 size={12} /></button></div>
                </article>
                {step.kind === "mapping" && step.enabled ? <button type="button" className="mapping-quick-edit" onClick={() => setShowMapping(true)}><ArrowRightLeft size={12} />Nested Mappingを編集 <ChevronRight size={12} /></button> : null}
              </li>
            ))}
          </ol>
          <div className="add-step-wrap">
            <button type="button" className="add-step-button" aria-expanded={showStepMenu} onClick={() => setShowStepMenu((current) => !current)}><Plus size={15} />処理を追加</button>
            {showStepMenu ? <div className="step-menu">{(["validate", "extract", "flatten", "mapping", "filter", "convert", "select"] as FlowKind[]).map((kind) => <button type="button" key={kind} onClick={() => addFlowStep(kind)}>{flowIcon(kind)}<span>{kind === "validate" ? "Validation" : kind === "extract" ? "JSONPath / XPath" : kind === "flatten" ? "Flatten" : kind === "mapping" ? "Key Mapping" : kind === "filter" ? "Filter" : kind === "convert" ? "Type Convert" : "Field Selection"}</span><Plus size={12} /></button>)}</div> : null}
          </div>
          <button type="button" className="flow-output-node" onClick={downloadOutput} disabled={!preview.output}><span className="flow-node-index"><Download size={14} /></span><div><small>EXPORT</small><strong>{FORMAT_LABELS[outputFormat]} Output</strong><em>{preview.afterRecords.length} records</em></div><ArrowRight size={14} /></button>
          <div className="flow-health"><span className={allIssues.length ? "bad" : "good"}>{allIssues.length ? <CircleAlert size={14} /> : <ShieldCheck size={14} />}</span><div><strong>{allIssues.length ? `${allIssues.length}件を確認` : "Pipeline ready"}</strong><small>{allIssues.length ? "Validationタブで詳細を確認" : "すべてブラウザ内で実行可能"}</small></div></div>
          <button type="button" className="save-template-button" onClick={() => setShowTemplate(true)}><Save size={15} />このFlowをTemplate保存</button>
        </aside>
      </div>

      {showMapping ? <MappingSheet mappings={mappings} sourcePaths={sourcePaths} onChange={setMappings} onClose={() => setShowMapping(false)} onApply={() => { updateMappingSummary(); setShowMapping(false); setToast("MappingをPipelineへ適用しました。"); }} /> : null}
      {showSettings ? <PipelineSettingsSheet initialSection={showSettings} filters={filters} filterLogic={filterLogic} extraction={extraction} csv={csvSettings} sourcePaths={sourcePaths} onFiltersChange={setFilters} onFilterLogicChange={setFilterLogic} onExtractionChange={(settings) => { setExtraction(settings); setFlowSteps((current) => current.map((step) => step.kind === "extract" ? { ...step, title: `${settings.language === "jsonpath" ? "JSONPath" : "XPath"}で抽出`, detail: settings.query || "Query未設定" } : step)); }} onCsvChange={setCsvSettings} onClose={() => setShowSettings(null)} /> : null}
      {showTemplate ? <TemplateSheet onClose={() => setShowTemplate(false)} onSave={saveTemplate} /> : null}
      {toast ? <div className="toast" role="status"><span><CheckCircle2 size={16} /></span><p>{toast}</p><button type="button" aria-label="通知を閉じる" onClick={() => setToast(undefined)}><X size={13} /></button></div> : null}
    </div>
  );
}
