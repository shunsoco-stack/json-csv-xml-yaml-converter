import { cloneData, deepEqual, formatPath, isDataObject } from "./structured-data";
import type { DiffEntry, DiffResult, PathSegment, StructuredData } from "./types";

export interface DiffOptions {
  maxEntries?: number;
}

export function compareData(
  before: StructuredData,
  after: StructuredData,
  options: DiffOptions = {},
): DiffResult {
  const maxEntries = Math.max(0, options.maxEntries ?? 5_000);
  const entries: DiffEntry[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;

  const addEntry = (entry: DiffEntry) => {
    if (entry.kind === "added") added += 1;
    else if (entry.kind === "removed") removed += 1;
    else changed += 1;
    if (entries.length < maxEntries) entries.push(entry);
  };

  const visit = (left: StructuredData, right: StructuredData, path: PathSegment[]) => {
    if (deepEqual(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const sharedLength = Math.min(left.length, right.length);
      for (let index = 0; index < sharedLength; index += 1) visit(left[index], right[index], [...path, index]);
      for (let index = sharedLength; index < left.length; index += 1) {
        addEntry({ kind: "removed", path: formatPath([...path, index]), before: cloneData(left[index]) });
      }
      for (let index = sharedLength; index < right.length; index += 1) {
        addEntry({ kind: "added", path: formatPath([...path, index]), after: cloneData(right[index]) });
      }
      return;
    }
    if (isDataObject(left) && isDataObject(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) => a.localeCompare(b));
      for (const key of keys) {
        const inLeft = Object.prototype.hasOwnProperty.call(left, key);
        const inRight = Object.prototype.hasOwnProperty.call(right, key);
        const childPath = formatPath([...path, key]);
        if (!inLeft) addEntry({ kind: "added", path: childPath, after: cloneData(right[key]) });
        else if (!inRight) addEntry({ kind: "removed", path: childPath, before: cloneData(left[key]) });
        else visit(left[key], right[key], [...path, key]);
      }
      return;
    }
    addEntry({ kind: "changed", path: formatPath(path), before: cloneData(left), after: cloneData(right) });
  };

  visit(before, after, []);
  const totalChanges = added + removed + changed;
  return {
    entries,
    added,
    removed,
    changed,
    totalChanges,
    truncated: entries.length < totalChanges,
    identical: totalChanges === 0,
  };
}
