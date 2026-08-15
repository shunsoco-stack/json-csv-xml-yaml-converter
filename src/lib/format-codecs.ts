import Encoding from "encoding-japanese";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { parseDocument, stringify as stringifyYaml } from "yaml";
import {
  getAtPath,
  isDataObject,
  normalizeStructuredData,
  setAtPath,
} from "./structured-data";
import type {
  CsvDelimiter,
  CsvNestedMode,
  DataDiagnostic,
  DataFormat,
  DataObject,
  FormatCandidate,
  FormatDetection,
  ParseOptions,
  ParseResult,
  SerializeOptions,
  SerializeResult,
  StructuredData,
  TextEncoding,
  XmlParseOptions,
} from "./types";

const CSV_DELIMITERS: readonly CsvDelimiter[] = [",", "\t", ";", "|"];
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/u;

interface CsvRecord {
  cells: string[];
  line: number;
}

interface CsvSyntaxError extends Error {
  line: number;
  column: number;
  code: string;
}

function diagnostic(
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

function warning(
  source: DataDiagnostic["source"],
  code: string,
  reason: string,
  extras: Partial<DataDiagnostic> = {},
): DataDiagnostic {
  return diagnostic(source, code, reason, { ...extras, severity: "warning" });
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lastLineStart = 0;
  for (let index = 0; index < safeOffset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      lastLineStart = index + 1;
    }
  }
  return { line, column: safeOffset - lastLineStart + 1 };
}

function jsonErrorLocation(error: unknown, source: string): { line?: number; column?: number } {
  const message = error instanceof Error ? error.message : String(error);
  const direct = message.match(/line\s+(\d+)\s+column\s+(\d+)/iu);
  if (direct) return { line: Number(direct[1]), column: Number(direct[2]) };
  const position = message.match(/(?:position|at)\s+(\d+)/iu);
  if (position) return offsetToLineColumn(source, Number(position[1]));
  if (/unexpected end/iu.test(message)) return offsetToLineColumn(source, source.length);
  const fallback = locateJsonSyntaxError(source);
  return fallback === undefined ? {} : offsetToLineColumn(source, fallback);
}

/** JSON.parse messages are implementation-specific; this scanner supplies a stable fallback offset. */
function locateJsonSyntaxError(source: string): number | undefined {
  let index = 0;
  let failure: number | undefined;
  const fail = (at = index): false => {
    failure ??= at;
    return false;
  };
  const whitespace = () => {
    while (index < source.length && /\s/u.test(source[index])) index += 1;
  };
  const string = (): boolean => {
    if (source[index] !== '"') return fail();
    index += 1;
    while (index < source.length) {
      const character = source[index++];
      if (character === '"') return true;
      if (character < " ") return fail(index - 1);
      if (character !== "\\") continue;
      if (index >= source.length) return fail(index);
      const escape = source[index++];
      if ('"\\/bfnrt'.includes(escape)) continue;
      if (escape !== "u" || !/^[0-9a-fA-F]{4}$/u.test(source.slice(index, index + 4))) return fail(index - 1);
      index += 4;
    }
    return fail(source.length);
  };
  const number = (): boolean => {
    const match = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (!match) return fail();
    index += match[0].length;
    return true;
  };
  const value = (): boolean => {
    whitespace();
    if (index >= source.length) return fail(source.length);
    if (source[index] === '"') return string();
    if (source[index] === "{") return object();
    if (source[index] === "[") return array();
    for (const literal of ["true", "false", "null"]) {
      if (source.startsWith(literal, index)) {
        index += literal.length;
        return true;
      }
    }
    return number();
  };
  const array = (): boolean => {
    index += 1;
    whitespace();
    if (source[index] === "]") {
      index += 1;
      return true;
    }
    while (index < source.length) {
      if (!value()) return false;
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return true;
      }
      if (source[index] !== ",") return fail();
      index += 1;
    }
    return fail(source.length);
  };
  const object = (): boolean => {
    index += 1;
    whitespace();
    if (source[index] === "}") {
      index += 1;
      return true;
    }
    while (index < source.length) {
      whitespace();
      if (!string()) return false;
      whitespace();
      if (source[index] !== ":") return fail();
      index += 1;
      if (!value()) return false;
      whitespace();
      if (source[index] === "}") {
        index += 1;
        return true;
      }
      if (source[index] !== ",") return fail();
      index += 1;
    }
    return fail(source.length);
  };
  if (!value()) return failure;
  whitespace();
  return index === source.length ? undefined : index;
}

function cleanParserMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+at position \d+(?: \(line \d+ column \d+\))?\s*$/iu, "").trim();
}

function createCsvSyntaxError(
  message: string,
  line: number,
  column: number,
  code: string,
): CsvSyntaxError {
  const error = new Error(message) as CsvSyntaxError;
  error.line = line;
  error.column = column;
  error.code = code;
  return error;
}

/** Strict RFC4180-style scanner that retains embedded newlines and source lines. */
function parseCsvRecords(
  source: string,
  delimiter: CsvDelimiter,
  maximumRecords = Number.POSITIVE_INFINITY,
): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let line = 1;
  let column = 1;
  let recordLine = 1;
  let inQuotes = false;
  let afterQuote = false;
  let quoteLine = 1;
  let quoteColumn = 1;
  let recordStarted = false;

  const advanceNewline = (index: number): number => {
    if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
    line += 1;
    column = 1;
    return index;
  };

  const finishRecord = () => {
    cells.push(field);
    records.push({ cells, line: recordLine });
    cells = [];
    field = "";
    recordStarted = false;
    afterQuote = false;
    recordLine = line + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
          column += 2;
        } else {
          inQuotes = false;
          afterQuote = true;
          column += 1;
        }
      } else if (character === "\r" || character === "\n") {
        field += "\n";
        index = advanceNewline(index);
      } else {
        field += character;
        column += 1;
      }
      recordStarted = true;
      continue;
    }

    if (afterQuote) {
      if (character === delimiter) {
        cells.push(field);
        field = "";
        afterQuote = false;
        recordStarted = true;
        column += 1;
        continue;
      }
      if (character === "\r" || character === "\n") {
        finishRecord();
        if (records.length >= maximumRecords) break;
        index = advanceNewline(index);
        continue;
      }
      throw createCsvSyntaxError(
        "A closing quote must be followed by a delimiter or a new line.",
        line,
        column,
        "CSV_CHAR_AFTER_QUOTE",
      );
    }

    if (character === '"') {
      if (field.length > 0) {
        throw createCsvSyntaxError(
          "A quote inside an unquoted CSV field must be escaped.",
          line,
          column,
          "CSV_UNESCAPED_QUOTE",
        );
      }
      inQuotes = true;
      quoteLine = line;
      quoteColumn = column;
      recordStarted = true;
      column += 1;
    } else if (character === delimiter) {
      cells.push(field);
      field = "";
      recordStarted = true;
      column += 1;
    } else if (character === "\r" || character === "\n") {
      finishRecord();
      if (records.length >= maximumRecords) break;
      index = advanceNewline(index);
    } else {
      field += character;
      recordStarted = true;
      column += 1;
    }
  }

  if (inQuotes) {
    throw createCsvSyntaxError(
      "The quoted CSV field is not closed.",
      quoteLine,
      quoteColumn,
      "CSV_UNCLOSED_QUOTE",
    );
  }
  if (records.length < maximumRecords && (recordStarted || cells.length > 0 || field.length > 0)) {
    cells.push(field);
    records.push({ cells, line: recordLine });
  }
  return records;
}

function isPhysicalBlank(record: CsvRecord): boolean {
  return record.cells.length === 1 && record.cells[0] === "";
}

export function detectCsvDelimiter(source: string): CsvDelimiter {
  const sample = source.replace(/^\uFEFF/u, "").slice(0, 128 * 1024);
  let best: { delimiter: CsvDelimiter; score: number } = { delimiter: ",", score: -Infinity };
  for (const delimiter of CSV_DELIMITERS) {
    let records: CsvRecord[];
    try {
      records = parseCsvRecords(sample, delimiter, 32).filter((record) => !isPhysicalBlank(record));
    } catch {
      continue;
    }
    if (records.length === 0) continue;
    const frequencies = new Map<number, number>();
    for (const record of records) {
      frequencies.set(record.cells.length, (frequencies.get(record.cells.length) ?? 0) + 1);
    }
    let modalWidth = 1;
    let modalCount = 0;
    for (const [width, count] of frequencies) {
      if (count > modalCount || (count === modalCount && width > modalWidth)) {
        modalWidth = width;
        modalCount = count;
      }
    }
    if (modalWidth < 2) continue;
    const score = modalCount * 100 + modalWidth * 10 - (records.length - modalCount) * 30;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

function extensionFormat(fileName: string | undefined): DataFormat | undefined {
  const extension = fileName?.split(".").pop()?.toLocaleLowerCase("en-US");
  if (extension === "json" || extension === "csv" || extension === "xml" ||
    extension === "yaml" || extension === "yml") {
    return extension === "yml" ? "yaml" : extension;
  }
  return undefined;
}

function looksLikeCsv(source: string): { matches: boolean; delimiter: CsvDelimiter } {
  const delimiter = detectCsvDelimiter(source);
  try {
    const rows = parseCsvRecords(source.slice(0, 128 * 1024), delimiter, 16)
      .filter((record) => !isPhysicalBlank(record));
    if (rows.length < 2) return { matches: false, delimiter };
    const widths = rows.map((row) => row.cells.length);
    const width = widths[0];
    return { matches: width > 1 && widths.filter((value) => value === width).length / widths.length >= 0.8, delimiter };
  } catch {
    return { matches: false, delimiter };
  }
}

function looksLikeYaml(source: string): boolean {
  if (!/(?:^|\n)\s*(?:---\s*$|-\s+|[^\s:#][^:\n]*:\s*)/mu.test(source)) return false;
  try {
    const document = parseDocument(source, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
      schema: "core",
    });
    return document.errors.length === 0;
  } catch {
    return false;
  }
}

export function detectFormat(source: string, fileName?: string): FormatDetection {
  const text = source.replace(/^\uFEFF/u, "");
  const trimmed = text.trim();
  const byExtension = extensionFormat(fileName);
  const scores = new Map<DataFormat, FormatCandidate>();
  const offer = (format: DataFormat, confidence: number, reason: string) => {
    const existing = scores.get(format);
    if (!existing || confidence > existing.confidence) scores.set(format, { format, confidence, reason });
  };

  if (byExtension) offer(byExtension, 0.72, `The .${fileName?.split(".").pop()} file extension suggests ${byExtension.toUpperCase()}.`);
  if (trimmed === "") offer(byExtension ?? "json", 0.2, "The input is empty, so the format cannot be determined reliably.");

  try {
    JSON.parse(trimmed);
    offer("json", /^[\[{]/u.test(trimmed) ? 0.99 : 0.7, "The input is valid JSON syntax.");
  } catch {
    // Detection collects viable formats; detailed parse errors are produced later.
  }

  if (trimmed.startsWith("<")) {
    const result = XMLValidator.validate(trimmed);
    if (result === true) offer("xml", 0.99, "The input is a well-formed XML document.");
    else offer("xml", 0.64, "The input begins with an XML tag but contains a syntax error.");
  }

  const csv = looksLikeCsv(text);
  if (csv.matches) {
    offer("csv", 0.9, `Rows consistently use ${csv.delimiter === "\t" ? "tab" : JSON.stringify(csv.delimiter)} as a delimiter.`);
  }
  if (looksLikeYaml(text)) offer("yaml", 0.82, "The input is valid YAML with mapping or sequence syntax.");

  if (scores.size === 0) offer(byExtension ?? "json", byExtension ? 0.55 : 0.25, byExtension
    ? "Only the file extension identifies the format."
    : "No format matched with high confidence; JSON is used as the safe default.");

  const candidates = [...scores.values()].sort((left, right) => right.confidence - left.confidence);
  const winner = candidates[0];
  return { ...winner, candidates };
}

function parseJson(source: string): Pick<ParseResult, "data" | "errors" | "warnings"> {
  try {
    return { data: normalizeStructuredData(JSON.parse(source)), errors: [], warnings: [] };
  } catch (error) {
    const location = jsonErrorLocation(error, source);
    const reason = cleanParserMessage(error) || "Invalid JSON syntax.";
    return {
      data: null,
      errors: [diagnostic("syntax", "INVALID_JSON", reason, location)],
      warnings: [],
    };
  }
}

function parseYaml(source: string): Pick<ParseResult, "data" | "errors" | "warnings"> {
  try {
    const document = parseDocument(source, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
      schema: "core",
    });
    const errors = document.errors.map((error) => {
      const start = error.linePos?.[0];
      const reason = error.message.split(" at line ")[0].trim();
      return diagnostic("syntax", `INVALID_YAML_${error.code}`, reason, {
        line: start?.line,
        column: start?.col,
      });
    });
    const warnings = document.warnings.map((item) => {
      const start = item.linePos?.[0];
      const reason = item.message.split(" at line ")[0].trim();
      return warning("syntax", `YAML_${item.code}`, reason, { line: start?.line, column: start?.col });
    });
    if (errors.length > 0) return { data: null, errors, warnings };
    return {
      data: normalizeStructuredData(document.toJS({ maxAliasCount: 100 })),
      errors: [],
      warnings,
    };
  } catch (error) {
    const reason = cleanParserMessage(error) || "Invalid YAML syntax.";
    return { data: null, errors: [diagnostic("syntax", "INVALID_YAML", reason)], warnings: [] };
  }
}

function xmlOptions(options: XmlParseOptions = {}) {
  return {
    ignoreAttributes: false,
    attributeNamePrefix: options.attributePrefix ?? "@",
    textNodeName: options.textNodeName ?? "#text",
    trimValues: options.trimValues ?? true,
    parseTagValue: false,
    parseAttributeValue: false,
    // DOCTYPE is rejected before parsing, so only XML's predefined entities
    // are decoded here; this preserves text such as `A & B` safely.
    processEntities: true,
    ignoreDeclaration: true,
    allowBooleanAttributes: false,
  } as const;
}

function parseXml(source: string, options?: XmlParseOptions): Pick<ParseResult, "data" | "errors" | "warnings"> {
  if (/<!DOCTYPE\b/iu.test(source)) {
    return {
      data: null,
      errors: [diagnostic(
        "syntax",
        "XML_DOCTYPE_UNSUPPORTED",
        "DOCTYPE declarations are disabled so local parsing cannot expand external entities.",
        offsetToLineColumn(source, source.search(/<!DOCTYPE\b/iu)),
      )],
      warnings: [],
    };
  }
  const validation = XMLValidator.validate(source, { allowBooleanAttributes: false });
  if (validation !== true) {
    const reason = validation.err.msg || "Invalid XML syntax.";
    return {
      data: null,
      errors: [diagnostic("syntax", `INVALID_XML_${validation.err.code}`, reason, {
        line: validation.err.line,
        column: validation.err.col,
      })],
      warnings: [],
    };
  }
  try {
    const data = new XMLParser(xmlOptions(options)).parse(source);
    return { data: normalizeStructuredData(data), errors: [], warnings: [] };
  } catch (error) {
    const reason = cleanParserMessage(error) || "Invalid XML syntax.";
    return { data: null, errors: [diagnostic("syntax", "INVALID_XML", reason)], warnings: [] };
  }
}

function uniqueHeaders(
  source: readonly string[],
  trim: boolean,
): { headers: string[]; warnings: DataDiagnostic[] } {
  const used = new Set<string>();
  const warnings: DataDiagnostic[] = [];
  const headers = source.map((raw, index) => {
    const normalized = trim ? raw.trim() : raw;
    const base = normalized || `column${index + 1}`;
    let candidate = base;
    let sequence = 2;
    while (used.has(candidate)) candidate = `${base}_${sequence++}`;
    if (candidate !== raw) warnings.push(warning(
      "syntax",
      "CSV_HEADER_NORMALIZED",
      raw === "" ? `Empty header ${index + 1} was named ${candidate}.` : `Header ${JSON.stringify(raw)} was renamed to ${JSON.stringify(candidate)} to stay unique.`,
      { line: 1, column: index + 1 },
    ));
    used.add(candidate);
    return candidate;
  });
  return { headers, warnings };
}

function parseCsv(source: string, options: ParseOptions["csv"] = {}): Pick<ParseResult, "data" | "errors" | "warnings"> & {
  delimiter: CsvDelimiter;
  rowCount: number;
  columnCount: number;
} {
  const text = source.replace(/^\uFEFF/u, "");
  const delimiter = options.delimiter && options.delimiter !== "auto"
    ? options.delimiter
    : detectCsvDelimiter(text);
  try {
    let records = parseCsvRecords(text, delimiter);
    if (options.skipEmptyLines ?? true) records = records.filter((record) => !isPhysicalBlank(record));
    if (records.length === 0) {
      return { data: [], errors: [], warnings: [], delimiter, rowCount: 0, columnCount: 0 };
    }
    const hasHeader = options.header ?? true;
    const width = records.reduce((maximum, record) => Math.max(maximum, record.cells.length), 0);
    const rawHeaders = hasHeader ? records[0].cells : Array.from({ length: width }, (_, index) => `column${index + 1}`);
    const { headers, warnings } = uniqueHeaders(rawHeaders, options.trimHeaders ?? true);
    const body = hasHeader ? records.slice(1) : records;
    const rows: StructuredData[] = [];
    for (let rowIndex = 0; rowIndex < body.length; rowIndex += 1) {
      const record = body[rowIndex];
      if (record.cells.length !== headers.length) {
        warnings.push(warning(
          "syntax",
          "CSV_COLUMN_COUNT",
          `Row ${rowIndex + (hasHeader ? 2 : 1)} has ${record.cells.length} fields; ${headers.length} were expected. Missing fields were filled with empty text and extra fields were preserved with generated headers.`,
          { line: record.line, recordIndex: rowIndex },
        ));
      }
      while (headers.length < record.cells.length) {
        const generated = `column${headers.length + 1}`;
        headers.push(generated);
        for (const previous of rows) {
          if (isDataObject(previous)) previous[generated] = "";
        }
      }
      let row: StructuredData = {};
      for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
        const value = record.cells[columnIndex] ?? "";
        row = (options.expandDottedHeaders ?? false)
          ? setAtPath(row, headers[columnIndex], value)
          : setAtPath(row, [headers[columnIndex]], value);
      }
      rows.push(row);
    }
    return { data: rows, errors: [], warnings, delimiter, rowCount: rows.length, columnCount: headers.length };
  } catch (error) {
    const syntaxError = error as Partial<CsvSyntaxError>;
    const reason = cleanParserMessage(error) || "Invalid CSV syntax.";
    return {
      data: null,
      errors: [diagnostic("syntax", syntaxError.code ?? "INVALID_CSV", reason, {
        line: syntaxError.line,
        column: syntaxError.column,
      })],
      warnings: [],
      delimiter,
      rowCount: 0,
      columnCount: 0,
    };
  }
}

export function parseData(source: string, options: ParseOptions = {}): ParseResult {
  const withoutBom = source.replace(/^\uFEFF/u, "");
  const detection = detectFormat(withoutBom, options.fileName);
  const selected = options.format && options.format !== "auto" ? options.format : detection.format;
  const result = selected === "json" ? parseJson(withoutBom)
    : selected === "yaml" ? parseYaml(withoutBom)
      : selected === "xml" ? parseXml(withoutBom, options.xml)
        : parseCsv(withoutBom, options.csv);
  const csvResult = selected === "csv" ? result as ReturnType<typeof parseCsv> : undefined;
  const rootName = selected === "xml" && result.data && isDataObject(result.data)
    ? Object.keys(result.data)[0]
    : undefined;
  const overrideWarning = options.format && options.format !== "auto" && options.format !== detection.format
    ? [warning(
        "detection",
        "FORMAT_OVERRIDE",
        `${options.format.toUpperCase()} was selected manually; automatic detection suggested ${detection.format.toUpperCase()}.`,
      )]
    : [];
  return {
    ok: result.errors.length === 0,
    detectedFormat: selected,
    detection,
    data: result.data,
    errors: result.errors,
    warnings: [...overrideWarning, ...result.warnings],
    metadata: {
      characterCount: withoutBom.length,
      delimiter: csvResult?.delimiter,
      rowCount: csvResult?.rowCount,
      columnCount: csvResult?.columnCount,
      rootName,
    },
  };
}

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  hadBom: boolean;
  warnings: DataDiagnostic[];
}

export async function decodeTextBuffer(
  input: ArrayBuffer | Uint8Array,
  encoding: TextEncoding | "auto" = "auto",
): Promise<DecodedText> {
  const bytes = input instanceof Uint8Array ? input.slice() : new Uint8Array(input.slice(0));
  const hadBom = bytes.length >= 3 && UTF8_BOM.every((byte, index) => bytes[index] === byte);
  const content = hadBom ? bytes.slice(3) : bytes;
  const decodeUtf8 = () => new TextDecoder("utf-8", { fatal: true }).decode(content);
  const decodeShiftJis = () => {
    const codes = Encoding.convert(Array.from(content), { from: "SJIS", to: "UNICODE", type: "array" });
    return Encoding.codeToString(codes);
  };
  if (encoding === "utf-8") return { text: decodeUtf8(), encoding, hadBom, warnings: [] };
  if (encoding === "shift-jis") return { text: decodeShiftJis(), encoding, hadBom: false, warnings: [] };
  try {
    return { text: decodeUtf8(), encoding: "utf-8", hadBom, warnings: [] };
  } catch {
    return {
      text: decodeShiftJis(),
      encoding: "shift-jis",
      hadBom: false,
      warnings: [warning("encoding", "SHIFT_JIS_FALLBACK", "The file was not valid UTF-8 and was decoded as Shift-JIS.")],
    };
  }
}

export async function parseDataBuffer(
  input: ArrayBuffer | Uint8Array,
  options: ParseOptions = {},
): Promise<ParseResult> {
  try {
    const decoded = await decodeTextBuffer(input, options.encoding ?? "auto");
    const result = parseData(decoded.text, options);
    return {
      ...result,
      warnings: [...decoded.warnings, ...result.warnings],
      metadata: { ...result.metadata, encoding: decoded.encoding },
    };
  } catch (error) {
    const detection = detectFormat("", options.fileName);
    const selected = options.format && options.format !== "auto" ? options.format : detection.format;
    const reason = cleanParserMessage(error) || "The selected character encoding could not decode this file.";
    return {
      ok: false,
      detectedFormat: selected,
      detection,
      data: null,
      errors: [diagnostic("encoding", "DECODE_FAILED", reason)],
      warnings: [],
      metadata: { characterCount: 0 },
    };
  }
}

function flattenForCsv(
  value: StructuredData,
  separator: string,
  prefix = "",
  target: Record<string, string | number | boolean | null> = {},
): Record<string, string | number | boolean | null> {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenForCsv(entry, separator, prefix ? `${prefix}${separator}${index}` : String(index), target));
  } else if (isDataObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      flattenForCsv(entry, separator, prefix ? `${prefix}${separator}${key}` : key, target);
    }
  } else {
    target[prefix || "value"] = value;
  }
  return target;
}

function jsonStringRow(value: StructuredData): Record<string, string | number | boolean | null> {
  if (!isDataObject(value)) return { value: Array.isArray(value) ? JSON.stringify(value) : value };
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    Array.isArray(entry) || isDataObject(entry) ? JSON.stringify(entry) : entry,
  ]));
}

function rowsForCsv(data: StructuredData, mode: CsvNestedMode): Array<Record<string, string | number | boolean | null>> {
  const sourceRows = Array.isArray(data) ? data : [data];
  return sourceRows.map((row) => mode === "json-string"
    ? jsonStringRow(row)
    : flattenForCsv(row, mode === "dot-notation" ? "." : "_"));
}

function csvCell(value: string | number | boolean | null, delimiter: CsvDelimiter): string {
  const text = value === null ? "" : String(value);
  return /["\r\n]/u.test(text) || text.includes(delimiter)
    ? `"${text.replace(/"/gu, '""')}"`
    : text;
}

function serializeCsv(data: StructuredData, options: SerializeOptions): string {
  const csv = options.csv ?? {};
  const delimiter = csv.delimiter ?? ",";
  const rows = rowsForCsv(data, csv.nestedMode ?? "dot-notation");
  const headers: string[] = [];
  const used = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!used.has(key)) {
        used.add(key);
        headers.push(key);
      }
    }
  }
  const records: string[] = [];
  if (csv.header ?? true) records.push(headers.map((header) => csvCell(header, delimiter)).join(delimiter));
  for (const row of rows) records.push(headers.map((header) => csvCell(row[header] ?? null, delimiter)).join(delimiter));
  const text = records.join(csv.lineEnding ?? "\r\n");
  return csv.includeBom ? `\uFEFF${text}` : text;
}

function validateXmlNames(
  value: StructuredData,
  attributePrefix: string,
  textNodeName: string,
  path = "$",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateXmlNames(entry, attributePrefix, textNodeName, `${path}[${index}]`));
    return;
  }
  if (!isDataObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const name = key.startsWith(attributePrefix) ? key.slice(attributePrefix.length) : key;
    if (key !== textNodeName && !XML_NAME.test(name)) {
      throw new Error(`Invalid XML name ${JSON.stringify(name)} at ${path}.`);
    }
    validateXmlNames(entry, attributePrefix, textNodeName, `${path}.${key}`);
  }
}

function xmlDocumentObject(data: StructuredData, rootName: string): DataObject {
  if (isDataObject(data)) {
    const keys = Object.keys(data);
    if (keys.length === 1 && XML_NAME.test(keys[0])) {
      const value = data[keys[0]];
      return { [keys[0]]: Array.isArray(value) ? { item: value } : value };
    }
  }
  return { [rootName]: Array.isArray(data) ? { item: data } : data };
}

function serializeXml(data: StructuredData, options: SerializeOptions): string {
  const xml = options.xml ?? {};
  const rootName = xml.rootName ?? "root";
  if (!XML_NAME.test(rootName)) throw new Error(`Invalid XML root name: ${rootName}`);
  const attributePrefix = xml.attributePrefix ?? "@";
  const textNodeName = xml.textNodeName ?? "#text";
  const document = xmlDocumentObject(data, rootName);
  validateXmlNames(document, attributePrefix, textNodeName);
  const body = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: attributePrefix,
    textNodeName,
    format: !options.minify,
    indentBy: " ".repeat(options.indent ?? 2),
    suppressEmptyNode: false,
    processEntities: true,
  }).build(document).trim();
  return xml.declaration === false ? body : `<?xml version="1.0" encoding="UTF-8"?>${options.minify ? "" : "\n"}${body}`;
}

export function serializeData(data: StructuredData, options: SerializeOptions): SerializeResult {
  try {
    let text: string;
    if (options.format === "json") {
      text = JSON.stringify(data, null, options.minify ? 0 : (options.indent ?? 2));
    } else if (options.format === "yaml") {
      text = stringifyYaml(data, {
        indent: options.indent ?? 2,
        indentSeq: true,
        lineWidth: 0,
        collectionStyle: options.minify ? "flow" : "block",
      }).trimEnd();
    } else if (options.format === "xml") {
      text = serializeXml(data, options);
    } else {
      text = serializeCsv(data, options);
    }
    const mimeType = options.format === "json" ? "application/json;charset=utf-8"
      : options.format === "yaml" ? "application/yaml;charset=utf-8"
        : options.format === "xml" ? "application/xml;charset=utf-8"
          : `text/csv;charset=${options.csv?.encoding === "shift-jis" ? "shift_jis" : "utf-8"}`;
    return { ok: true, text, errors: [], warnings: [], mimeType, extension: options.format };
  } catch (error) {
    const reason = cleanParserMessage(error) || `Could not serialize ${options.format.toUpperCase()}.`;
    return {
      ok: false,
      text: "",
      errors: [diagnostic("system", "SERIALIZE_FAILED", reason)],
      warnings: [],
      mimeType: "text/plain;charset=utf-8",
      extension: options.format,
    };
  }
}

export async function encodeSerializedText(
  result: SerializeResult,
  encoding: TextEncoding = "utf-8",
  includeBom = false,
): Promise<Uint8Array> {
  if (!result.ok) throw new Error(result.errors[0]?.reason ?? "Serialization failed.");
  if (encoding === "utf-8") {
    const body = new TextEncoder().encode(result.text.replace(/^\uFEFF/u, ""));
    if (!includeBom) return body;
    const output = new Uint8Array(UTF8_BOM.length + body.length);
    output.set(UTF8_BOM);
    output.set(body, UTF8_BOM.length);
    return output;
  }
  const converted = Encoding.convert(Encoding.stringToCode(result.text.replace(/^\uFEFF/u, "")), {
    from: "UNICODE",
    to: "SJIS",
    type: "array",
  });
  const bytes = Uint8Array.from(converted);
  const roundTripCodes = Encoding.convert(Array.from(bytes), { from: "SJIS", to: "UNICODE", type: "array" });
  const roundTrip = Encoding.codeToString(roundTripCodes);
  if (roundTrip !== result.text.replace(/^\uFEFF/u, "")) {
    throw new Error("Some characters cannot be represented in Shift-JIS. Choose UTF-8 instead.");
  }
  return bytes;
}

/** Utility used by UI previews to identify a top-level tabular collection. */
export function findTableRows(data: StructuredData): StructuredData[] | null {
  if (Array.isArray(data)) return data;
  if (!isDataObject(data)) return null;
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
  }
  return null;
}

export function readScalarAtPath(data: StructuredData, path: string): StructuredData | undefined {
  return getAtPath(data, path).value;
}
