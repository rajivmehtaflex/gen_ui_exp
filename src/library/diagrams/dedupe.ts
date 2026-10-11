// De-duplicate diagram children by id BEFORE layout. A model-hallucinated
// duplicate id would otherwise throw in the pure layout functions and vanish
// into the renderer's per-element error boundary — a silently blank diagram.
// Keeping the first occurrence and reporting the count keeps the failure
// visible, matching the dropped-edge/message convention.
export function dedupeById<T extends { id: string }>(items: T[]): {
  kept: T[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const kept: T[] = [];
  let duplicates = 0;
  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(item.id);
    kept.push(item);
  }
  return { kept, duplicates };
}
