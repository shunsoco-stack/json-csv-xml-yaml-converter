import type { WorkerRequest, WorkerResponse, WorkerSuccess } from "./worker-protocol";

interface PendingRequest {
  resolve: (response: WorkerSuccess) => void;
  reject: (error: Error) => void;
}

export class DataWorkerClient {
  private worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();

  constructor() {
    this.worker = this.createWorker();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("../workers/data.worker.ts", import.meta.url), {
      type: "module",
      name: "data-shift-local-worker",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response);
      else pending.reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "The local data worker stopped unexpectedly.");
      this.pending.forEach((request) => request.reject(error));
      this.pending.clear();
    };
    return worker;
  }

  request<T extends WorkerSuccess>(request: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.pending.has(request.id)) {
        reject(new Error(`A worker request with id ${request.id} is already running.`));
        return;
      }
      this.pending.set(request.id, {
        resolve: (response) => resolve(response as T),
        reject,
      });
      this.worker.postMessage(request, transfer);
    });
  }

  restart(reason = "The local worker was restarted."): void {
    this.worker.terminate();
    this.pending.forEach((request) => request.reject(new Error(reason)));
    this.pending.clear();
    this.worker = this.createWorker();
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.forEach((request) => request.reject(new Error("The local worker was closed.")));
    this.pending.clear();
  }
}

export function createRequestId(kind: WorkerRequest["kind"]): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${kind}-${suffix}`;
}
