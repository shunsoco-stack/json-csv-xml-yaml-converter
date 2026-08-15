import type { DataObject, PathSegment, StructuredData } from "./types";

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$-]*$/u;

export function isDataObject(value: StructuredData | unknown): value is DataObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cloneData<T extends StructuredData>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneData(entry)) as T;
  }
  if (isDataObject(value)) {
    const cloned: DataObject = {};
    for (const [key, entry] of Object.entries(value)) cloned[key] = cloneData(entry);
    return cloned as T;
  }
  return value;
}

/** Converts parser/library output into data that is safe to clone, persist and postMessage. */
export function normalizeStructuredData(value: unknown): StructuredData {
  const seen = new WeakSet<object>();

  const visit = (candidate: unknown, path: string): StructuredData => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new Error(`${path} contains a non-finite number.`);
      return candidate;
    }
    if (candidate instanceof Date) {
      if (Number.isNaN(candidate.getTime())) throw new Error(`${path} contains an invalid date.`);
      return candidate.toISOString();
    }
    if (typeof candidate !== "object" || candidate === undefined) {
      throw new Error(`${path} contains an unsupported ${typeof candidate} value.`);
    }
    if (seen.has(candidate)) throw new Error(`${path} contains a circular reference.`);
    seen.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        return candidate.map((entry, index) => visit(entry, `${path}[${index}]`));
      }
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        if (candidate instanceof Map) {
          const mapped: DataObject = {};
          for (const [key, entry] of candidate) {
            if (typeof key !== "string") throw new Error(`${path} has a non-string map key.`);
            assertSafeKey(key);
            mapped[key] = visit(entry, `${path}.${key}`);
          }
          return mapped;
        }
        throw new Error(`${path} contains an unsupported object.`);
      }
      const object: DataObject = {};
      for (const [key, entry] of Object.entries(candidate)) {
        assertSafeKey(key);
        object[key] = visit(entry, `${path}.${key}`);
      }
      return object;
    } finally {
      seen.delete(candidate);
    }
  };

  return visit(value, "$");
}

export function assertSafeKey(key: string): void {
  if (UNSAFE_KEYS.has(key)) throw new Error(`Unsafe key is not allowed: ${key}`);
}

function parseQuotedBracket(source: string): string {
  if (source.startsWith('"')) return JSON.parse(source) as string;
  const body = source.slice(1, -1);
  return body.replace(/\\([\\'])/gu, "$1");
}

/**
 * Parses `customer.address.city`, `items[0].sku`, `$["key.with.dots"]`, and
 * escaped bare keys such as `key\\.with\\.dots`.
 */
export function parsePath(path: string): PathSegment[] {
  const source = path.trim();
  if (source === "" || source === "$") return [];
  const segments: PathSegment[] = [];
  let index = source.startsWith("$") ? 1 : 0;
  let needsSegment = true;

  while (index < source.length) {
    if (source[index] === ".") {
      if (needsSegment && segments.length > 0) throw new Error(`Invalid empty path segment in: ${path}`);
      needsSegment = true;
      index += 1;
      continue;
    }

    if (source[index] === "[") {
      const end = findBracketEnd(source, index);
      if (end < 0) throw new Error(`Unclosed bracket in path: ${path}`);
      const raw = source.slice(index + 1, end).trim();
      let segment: PathSegment;
      if (/^(?:0|[1-9]\d*)$/u.test(raw)) {
        segment = Number(raw);
      } else if (
        raw.length >= 2 &&
        ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
      ) {
        try {
          segment = parseQuotedBracket(raw);
        } catch {
          throw new Error(`Invalid quoted key in path: ${path}`);
        }
      } else {
        throw new Error(`Only numeric or quoted bracket paths are supported: ${path}`);
      }
      if (typeof segment === "string") assertSafeKey(segment);
      segments.push(segment);
      index = end + 1;
      needsSegment = false;
      continue;
    }

    let token = "";
    while (index < source.length && source[index] !== "." && source[index] !== "[") {
      if (source[index] === "\\") {
        index += 1;
        if (index >= source.length) throw new Error(`Trailing escape in path: ${path}`);
      }
      token += source[index];
      index += 1;
    }
    if (!token) throw new Error(`Invalid path: ${path}`);
    assertSafeKey(token);
    segments.push(token);
    needsSegment = false;
  }

  if (needsSegment) throw new Error(`Path cannot end with a dot: ${path}`);
  return segments;
}

function findBracketEnd(source: string, start: number): number {
  let quote = "";
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "]") return index;
  }
  return -1;
}

export function formatPath(path: readonly PathSegment[]): string {
  if (path.length === 0) return "$";
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    if (SIMPLE_KEY.test(segment)) return result === "$" ? `$.${segment}` : `${result}.${segment}`;
    return `${result}[${JSON.stringify(segment)}]`;
  }, "$");
}

export interface PathLookup {
  exists: boolean;
  value?: StructuredData;
}

export function getAtPath(
  data: StructuredData,
  path: string | readonly PathSegment[],
): PathLookup {
  const segments = typeof path === "string" ? parsePath(path) : path;
  let current: StructuredData = data;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return { exists: false };
      current = current[segment];
    } else {
      if (!isDataObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return { exists: false };
      }
      current = current[segment];
    }
  }
  return { exists: true, value: current };
}

export function setAtPath(
  data: StructuredData,
  path: string | readonly PathSegment[],
  value: StructuredData,
): StructuredData {
  const segments = typeof path === "string" ? parsePath(path) : [...path];
  if (segments.length === 0) return cloneData(value);

  const write = (current: StructuredData | undefined, depth: number): StructuredData => {
    const segment = segments[depth];
    const isLast = depth === segments.length - 1;
    if (typeof segment === "number") {
      const array = Array.isArray(current) ? current.map((entry) => cloneData(entry)) : [];
      while (array.length <= segment) array.push(null);
      array[segment] = isLast ? cloneData(value) : write(array[segment], depth + 1);
      return array;
    }
    assertSafeKey(segment);
    const object: DataObject = isDataObject(current) ? cloneData(current) : {};
    object[segment] = isLast ? cloneData(value) : write(object[segment], depth + 1);
    return object;
  };

  return write(data, 0);
}

export function deleteAtPath(
  data: StructuredData,
  path: string | readonly PathSegment[],
  pruneEmpty = true,
): StructuredData {
  const segments = typeof path === "string" ? parsePath(path) : [...path];
  if (segments.length === 0) return null;

  const remove = (current: StructuredData, depth: number): [StructuredData, boolean] => {
    const segment = segments[depth];
    const isLast = depth === segments.length - 1;
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return [current, false];
      const array = current.map((entry) => cloneData(entry));
      if (isLast) array.splice(segment, 1);
      else {
        const [child, changed] = remove(array[segment], depth + 1);
        if (!changed) return [current, false];
        if (pruneEmpty && isEmptyContainer(child)) array.splice(segment, 1);
        else array[segment] = child;
      }
      return [array, true];
    }
    if (!isDataObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return [current, false];
    }
    const object = cloneData(current);
    if (isLast) delete object[segment];
    else {
      const [child, changed] = remove(object[segment], depth + 1);
      if (!changed) return [current, false];
      if (pruneEmpty && isEmptyContainer(child)) delete object[segment];
      else object[segment] = child;
    }
    return [object, true];
  };

  return remove(data, 0)[0];
}

function isEmptyContainer(value: StructuredData): boolean {
  return (Array.isArray(value) && value.length === 0) ||
    (isDataObject(value) && Object.keys(value).length === 0);
}

export function deepEqual(left: StructuredData, right: StructuredData): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isDataObject(left) || isDataObject(right)) {
    if (!isDataObject(left) || !isDataObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

export function countRecords(data: StructuredData): number {
  return Array.isArray(data) ? data.length : 1;
}
