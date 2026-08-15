import type {
  DiffResult,
  JsonSchema,
  ParseOptions,
  ParseResult,
  PipelineStep,
  SchemaGenerationOptions,
  SchemaValidationResult,
  SerializeOptions,
  SerializeResult,
  StructuredData,
  TransformResult,
} from "./types";

export type WorkerRequest =
  | { id: string; kind: "parse-text"; source: string; options?: ParseOptions }
  | { id: string; kind: "parse-buffer"; buffer: ArrayBuffer; options?: ParseOptions }
  | { id: string; kind: "transform"; data: StructuredData; steps: PipelineStep[] }
  | { id: string; kind: "serialize"; data: StructuredData; options: SerializeOptions }
  | { id: string; kind: "export"; data: StructuredData; options: SerializeOptions }
  | { id: string; kind: "diff"; before: StructuredData; after: StructuredData; maxEntries?: number }
  | { id: string; kind: "generate-schema"; data: StructuredData; options?: SchemaGenerationOptions }
  | { id: string; kind: "validate-schema"; data: StructuredData; schema: JsonSchema };

export type WorkerSuccess =
  | { id: string; ok: true; kind: "parse-text" | "parse-buffer"; result: ParseResult }
  | { id: string; ok: true; kind: "transform"; result: TransformResult }
  | { id: string; ok: true; kind: "serialize"; result: SerializeResult }
  | {
      id: string;
      ok: true;
      kind: "export";
      result: SerializeResult;
      bytes: ArrayBuffer;
    }
  | { id: string; ok: true; kind: "diff"; result: DiffResult }
  | { id: string; ok: true; kind: "generate-schema"; result: JsonSchema }
  | { id: string; ok: true; kind: "validate-schema"; result: SchemaValidationResult };

export interface WorkerFailure {
  id: string;
  ok: false;
  kind: WorkerRequest["kind"];
  error: string;
}

export type WorkerResponse = WorkerSuccess | WorkerFailure;
