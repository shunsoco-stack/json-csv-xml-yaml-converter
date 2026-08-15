/// <reference lib="webworker" />

import { compareData } from "@/lib/diff-engine";
import {
  encodeSerializedText,
  parseData,
  parseDataBuffer,
  serializeData,
} from "@/lib/format-codecs";
import { generateJsonSchema, validateJsonSchema } from "@/lib/schema-engine";
import { runPipeline } from "@/lib/transform-engine";
import type { WorkerRequest, WorkerResponse } from "@/lib/worker-protocol";

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    let response: WorkerResponse;
    if (request.kind === "parse-text") {
      response = { id: request.id, ok: true, kind: request.kind, result: parseData(request.source, request.options) };
    } else if (request.kind === "parse-buffer") {
      response = { id: request.id, ok: true, kind: request.kind, result: await parseDataBuffer(request.buffer, request.options) };
    } else if (request.kind === "transform") {
      response = { id: request.id, ok: true, kind: request.kind, result: runPipeline(request.data, request.steps) };
    } else if (request.kind === "serialize") {
      response = { id: request.id, ok: true, kind: request.kind, result: serializeData(request.data, request.options) };
    } else if (request.kind === "export") {
      const result = serializeData(request.data, request.options);
      const encoding = request.options.format === "csv" ? request.options.csv?.encoding ?? "utf-8" : "utf-8";
      const includeBom = request.options.format === "csv" && (request.options.csv?.includeBom ?? false);
      const bytes = await encodeSerializedText(result, encoding, includeBom);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      response = { id: request.id, ok: true, kind: request.kind, result, bytes: buffer };
      workerScope.postMessage(response, [buffer]);
      return;
    } else if (request.kind === "diff") {
      response = {
        id: request.id,
        ok: true,
        kind: request.kind,
        result: compareData(request.before, request.after, { maxEntries: request.maxEntries }),
      };
    } else if (request.kind === "generate-schema") {
      response = { id: request.id, ok: true, kind: request.kind, result: generateJsonSchema(request.data, request.options) };
    } else {
      response = { id: request.id, ok: true, kind: request.kind, result: validateJsonSchema(request.data, request.schema) };
    }
    workerScope.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      ok: false,
      kind: request.kind,
      error: error instanceof Error ? error.message : "The local data operation failed.",
    };
    workerScope.postMessage(response);
  }
};

export {};
