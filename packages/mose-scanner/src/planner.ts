import { TimeframeRegistry, standardTimeframes } from "@ate/multitimeframe";
import { fingerprint, frozen } from "./primitives.js";
import {
  planSchema,
  type ScanPlan,
  type ScannerPolicy,
  type ScanSubscription,
  type ScanTrigger,
} from "./contracts.js";
export function validatePlan(raw: unknown, policy: ScannerPolicy): ScanPlan {
  const p = planSchema.parse(raw),
    registry = new TimeframeRegistry(standardTimeframes());
  if (
    p.subscriptions.length > policy.maxSubscriptions ||
    p.dependencies.length > policy.maxDependencies ||
    new Set(p.subscriptions.map((s) => s.instrumentId)).size > policy.maxInstruments
  )
    throw Error("RESOURCE_BUDGET_EXCEEDED");
  if (new Set(p.subscriptions.map((s) => s.id)).size !== p.subscriptions.length)
    throw Error("DUPLICATE_SUBSCRIPTION");
  const graph = new ScanDependencyGraph(p.dependencies, policy.maxDependencies, policy.maxEdges);
  for (const s of p.subscriptions) {
    registry.get(s.timeframe);
    if (!policy.enabledModes.includes(s.mode)) throw Error("MODE_DISABLED");
    if (
      new Set(
        p.subscriptions.filter((x) => x.instrumentId === s.instrumentId).map((x) => x.timeframe),
      ).size > policy.maxTimeframes
    )
      throw Error("TIMEFRAME_BOUNDS");
    for (const d of s.dependencies) if (!graph.has(d)) throw Error("DEPENDENCY_MISSING");
    if (new Set(s.dependencies).size !== s.dependencies.length) throw Error("DUPLICATE_DEPENDENCY");
    const periodic = ["SECONDS", "SCHEDULE"].includes(s.mode);
    if (periodic !== (s.cadenceMs !== null) || (s.mode === "SCHEDULE") !== (s.schedule !== null))
      throw Error("INVALID_SCHEDULE");
    if ((s.mode === "BAR_CLOSE" || s.mode === "TIMEFRAME") && !s.streamId)
      throw Error("STREAM_REQUIRED");
    if (
      s.schedule &&
      (s.schedule.end < s.anchor ||
        Date.parse(s.schedule.end) - Date.parse(s.anchor) > policy.maxScheduleHorizonMs)
    )
      throw Error("SCHEDULE_HORIZON");
  }
  return frozen(p);
}
export class ScanDependencyGraph {
  private readonly entries = new Map<string, readonly string[]>();
  constructor(
    nodes: ScanPlan["dependencies"],
    private readonly maxNodes: number,
    maxEdges: number,
  ) {
    if (nodes.length > maxNodes || nodes.reduce((n, d) => n + d.parents.length, 0) > maxEdges)
      throw Error("DEPENDENCY_BOUNDS");
    for (const n of nodes) {
      if (this.entries.has(n.id) || new Set(n.parents).size !== n.parents.length)
        throw Error("DUPLICATE_DEPENDENCY");
      this.entries.set(n.id, frozen([...n.parents]));
    }
    for (const n of nodes)
      for (const p of n.parents) if (!this.entries.has(p)) throw Error("DEPENDENCY_MISSING");
    const visited = new Set<string>(),
      visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw Error("DEPENDENCY_CYCLE");
      if (visited.has(id)) return;
      visiting.add(id);
      for (const p of this.entries.get(id)!) visit(p);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of [...this.entries.keys()].sort()) visit(id);
  }
  has(id: string) {
    return this.entries.has(id);
  }
  affected(changed: readonly string[]): readonly string[] {
    const result = new Set(changed);
    for (const id of changed) if (!this.has(id)) throw Error("DEPENDENCY_MISSING");
    for (let i = 0; i < this.maxNodes; i++) {
      let added = false;
      for (const [id, parents] of this.entries)
        if (!result.has(id) && parents.some((p) => result.has(p))) {
          result.add(id);
          added = true;
        }
      if (!added) return frozen([...result].sort());
    }
    throw Error("DEPENDENCY_BOUNDS");
  }
}
export const workKey = (
  s: ScanSubscription,
  t: ScanTrigger,
  vector: Readonly<Record<string, string>>,
  policy: string,
) =>
  fingerprint({
    session: s.sessionId,
    universe: s.universe,
    instrument: s.instrumentId,
    timeframe: s.timeframe,
    mode: s.mode,
    subscription: s.id,
    stream: s.streamId,
    trigger: { id: t.id, kind: t.kind, cause: t.cause },
    boundary: t.boundary,
    source: t.evidence,
    vector,
    policy,
  });
export const equivalentKey = (
  s: ScanSubscription,
  t: ScanTrigger,
  vector: Readonly<Record<string, string>>,
  policy: string,
) =>
  fingerprint({
    session: s.sessionId,
    universe: s.universe,
    instrument: s.instrumentId,
    timeframe: s.timeframe,
    stream: s.streamId,
    boundary: t.boundary,
    source: t.evidence,
    vector,
    policy,
    requirement:
      s.mode === "TRIGGER" && t.kind === "RESEARCH_RESCAN"
        ? { kind: t.kind, cause: t.cause, id: t.id }
        : "QUALIFIED_OBSERVATION",
  });
export function ordered<
  T extends { boundary: string; key: string; subscription: ScanSubscription; ordinal?: number },
>(
  work: readonly T[],
  lastInstrument: string | null,
  lastWork: Readonly<Record<string, string>> = {},
): T[] {
  const byInstrument = new Map<string, T[]>();
  for (const w of work) {
    const queue = byInstrument.get(w.subscription.instrumentId) ?? [];
    queue.push(w);
    byInstrument.set(w.subscription.instrumentId, queue);
  }
  const compare = (x: T, y: T) =>
    (x.boundary < y.boundary ? -1 : x.boundary > y.boundary ? 1 : 0) ||
    x.subscription.priority - y.subscription.priority ||
    (x.ordinal ?? 0) - (y.ordinal ?? 0) ||
    (x.subscription.mode < y.subscription.mode
      ? -1
      : x.subscription.mode > y.subscription.mode
        ? 1
        : 0) ||
    (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  for (const [id, q] of byInstrument) {
    q.sort(compare);
    const last = q.findIndex((w) => w.key === lastWork[id]);
    if (last >= 0 && q.length > 1)
      byInstrument.set(id, [...q.slice(last + 1), ...q.slice(0, last + 1)]);
  }
  const ids = [...byInstrument.keys()].sort();
  const next = lastInstrument === null ? 0 : ids.findIndex((id) => id > lastInstrument);
  const start = next < 0 ? 0 : next;
  const result: T[] = [];
  while (byInstrument.size) {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[(start + i) % ids.length]!,
        q = byInstrument.get(id);
      if (!q) continue;
      result.push(q.shift()!);
      if (!q.length) byInstrument.delete(id);
    }
  }
  return result;
}
