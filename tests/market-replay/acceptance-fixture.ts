import { hash, CalendarBoundaryResolver, utcCalendar } from "@ate/multitimeframe";
import type { Input, Stream } from "@ate/multitimeframe";
import {
  createReplayInputManifest,
  immutableReplayInputs,
  createReplaySpecification,
  type ReplayTaskDescriptor,
  type ReplayMode,
  type ReplaySourceRecord,
  resolveHistoricalReplayInputs,
  type ReplayResolvedInputs,
} from "@ate/market-replay";
import { replayFixture, observation, stream, t } from "./fixtures.js";
export const cutoffs = [
  "10:14:59",
  "10:15:00",
  "10:15:05",
  "10:30:00",
  "11:00:00",
  "11:00:05",
  "11:00:06",
];
import { historicalFixture } from "./historical-fixture.js";
export async function acceptanceFixture(mode: ReplayMode = "VERIFIED_POINT_IN_TIME", multi = true) {
  const streams: Stream[] = multi
    ? [0, 1, 2, 3].map((i) => ({
        ...stream,
        sourceId: i < 2 ? stream.sourceId : "40000000-0000-4000-8000-000000000011",
        instrumentId: i % 2 ? "40000000-0000-4000-8000-000000000012" : stream.instrumentId,
        sourceFingerprint: i < 2 ? stream.sourceFingerprint : hash("provider-two"),
      }))
    : [stream];
  const tasks: ReplayTaskDescriptor[] = [];
  const recordsByStream: ReplaySourceRecord[][] = [];
  const ownerInputs: ReplayResolvedInputs[] = [];
  for (const [i, s] of streams.entries()) {
    const id = hash(s);
    let n = 0;
    const task = (at: string, action: ReplayTaskDescriptor["action"]) =>
      tasks.push({ taskId: `${i}-${String(++n).padStart(3, "0")}`, dueAt: t(at), action });
    const wm = (
      at: string,
      sessionId = "session-1",
      coverage: "COMPLETE_COVERAGE" | "INCOMPLETE" = "COMPLETE_COVERAGE",
    ) =>
      task(at, {
        kind: "WATERMARK",
        streamId: id,
        authorityReference: `recorded-provider-${i}`,
        evidence: {
          sessionId,
          through: t(at),
          observedAt: t(at),
          coverage,
          kind: "END_OF_STREAM",
          evidenceId: `eos-${i}-${at}`,
          reconciled: true,
        },
      });
    const pub = (at: string, timeframe: string, event: string, final = true) =>
      task(at, { kind: "PUBLISH", streamId: id, timeframe, eventAt: t(event), final });
    const snapshot = (at: string) =>
      task(at, {
        kind: "SNAPSHOT",
        streamId: id,
        timeframes: ["M1", "M5", "M15", "H1", "H4"],
        includeIncomplete: false,
      });
    const records = await Promise.all(
      [
        ["07:50:00", "08:00:05"],
        ["09:50:00", "10:00:05"],
        ["10:01:00", "10:14:59"],
        ["10:20:00", "10:30:00"],
        ["09:50:01", "11:00:06"],
      ].map(async ([event, receipt], j): Promise<ReplaySourceRecord> => {
        const base = observation(
          t(event!),
          100 + i * 10 + j,
          j === 4 ? "9" : String(j + 1),
          t(receipt!),
        );
        const price = j === 4 ? "9" : String(j + 1);
        const owner = await historicalFixture({
          stream: s,
          at: receipt!,
          rows: `${t(event!)},TEST,${price},${j === 2 ? "0.5" : price}`,
        });
        const resolved = await resolveHistoricalReplayInputs({
          ...owner.options,
          manifestId: `quality-record-${i}-${j}`,
          availability: () => ({
            kind: "CANONICAL_FIXTURE",
            availableAt: t(receipt!),
            fingerprint: hash({ i, j, receipt }),
          }),
        });
        ownerInputs.push(resolved);
        const owned = resolved.manifests[0]!.records[0]!;
        const canonical = owned.input.observation;
        const input: Input = {
          ...base,
          ...owned.input,
          availability: "VERIFIED",
          observation: canonical,
          sourceFingerprint: s.sourceFingerprint,
          sessionId: j === 3 ? "session-2" : "session-1",
          continuity: j === 3 ? "GAP" : "CONTINUOUS",
        };
        if (i % 2) {
          const { orderingSequence: _sequence, ...uncertain } = input;
          return {
            qualityAvailableAt: t(receipt!),
            input: uncertain,
            evidence: {
              kind: "CANONICAL_FIXTURE",
              availableAt: t(receipt!),
              fingerprint: hash({ i, j, receipt }),
            },
          };
        }
        return {
          qualityAvailableAt: t(receipt!),
          input,
          evidence: {
            kind: "CANONICAL_FIXTURE",
            availableAt: t(receipt!),
            fingerprint: hash({ i, j, receipt }),
          },
        };
      }),
    );
    recordsByStream.push(records);
    wm("08:00:05");
    for (const code of ["M1", "M5", "M15", "H1", "H4"]) pub("08:00:05", code, "07:50:00");
    wm("10:00:05");
    for (const code of ["M1", "M5", "M15", "H1"]) pub("10:00:05", code, "09:50:00");
    pub("10:14:59", "M15", "10:01:00", false);
    snapshot("10:14:59");
    snapshot("10:15:00");
    wm("10:15:05");
    for (const code of ["M1", "M5", "M15"]) pub("10:15:05", code, "10:01:00");
    snapshot("10:15:05");
    task("10:30:00", { kind: "FENCE", streamId: id, reason: "RECORDED_RECONNECT" });
    snapshot("10:30:00");
    snapshot("11:00:00");
    wm("11:00:05", "session-2", "INCOMPLETE");
    pub("11:00:05", "H1", "10:01:00");
    snapshot("11:00:05");
    wm("2026-10-08T11:00:05.001Z");
    snapshot("11:00:06");
  }
  const calendarFingerprint = new CalendarBoundaryResolver(utcCalendar).fingerprint;
  const manifests = [0, ...(multi ? [1] : [])].map((provider) => {
    const included = streams
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => (multi ? Math.floor(i / 2) === provider : i === 0));
    return createReplayInputManifest(
      {
        manifestId: `provider-${provider}`,
        kind: "FIXTURE",
        canonicalSchemaVersion: "1",
        sourceFingerprint: included[0]!.s.sourceFingerprint,
        records: included.flatMap(({ i }) => recordsByStream[i]!),
        scopes: included.map(({ s }) => s),
        continuity: "UNKNOWN",
        qualityReferences: [
          ...new Set(
            included.flatMap(({ i }) =>
              recordsByStream[i]!.flatMap((r) =>
                r.input.quality ? [r.input.quality.reportFingerprint] : [],
              ),
            ),
          ),
        ],
        calendarFingerprint,
        validation: "VALIDATED",
        originReference: `fixture-provider-${provider}`,
        originFingerprint: hash(included.map(({ i }) => recordsByStream[i])),
      },
      replayFixture().spec.resourceLimits,
    );
  });
  const { fingerprint: _fp, ...base } = replayFixture(mode).spec;
  const spec = createReplaySpecification({
    ...base,
    sessionId: `acceptance-${mode}-${multi}`,
    sourceManifestIds: manifests.map((m) => m.manifestId),
    datasetFingerprints: manifests.map((m) => m.contentFingerprint),
    instrumentScope: [...new Set(streams.map((s) => s.instrumentId))],
    sourceScope: [...new Set(streams.map((s) => s.sourceId))],
    startTime: t("07:00:00"),
    streams,
    tasks,
  });
  return {
    spec,
    manifests,
    inputs: immutableReplayInputs(manifests, async () => {
      for (const owner of ownerInputs) await owner.verify();
    }),
    streams,
  };
}
