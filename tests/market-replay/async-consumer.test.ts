import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { VirtualClock } from "@ate/time";
import { ConsumerChannel, type AcceptedObservation } from "@ate/realtime-data";
import { hash } from "@ate/multitimeframe";
import {
  ReplayController,
  FilesystemReplayCheckpointRepository,
  type ReplayCheckpointRepository,
  type ReplayCommandResult,
} from "@ate/market-replay";
import { replayFixture, observation, stream, t } from "./fixtures.js";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ok = (r: ReplayCommandResult) => {
  if (!r.ok) throw Error(r.code);
  return r.checkpoint;
};
function accepted(id: number): AcceptedObservation {
  const input = observation(t(id === 3 ? "10:01:00" : "10:00:00"), id);
  return {
    ingress: {
      ingressId: `ingress-${id}`,
      sourceId: stream.sourceId,
      adapterId: "scripted",
      adapterVersion: "1",
      sessionId: "session-1",
      subscriptionId: "quotes",
      providerSymbol: "TEST",
      observationKind: "QUOTE",
      receivedAt: input.observation.receivedAt,
      localSequence: id,
      payloadFingerprint: hash(input.observation),
      configurationFingerprint: hash("fixture"),
    },
    observation: input.observation,
    processedAt: input.observation.receivedAt,
    warnings: [],
  };
}
async function setup() {
  const f = replayFixture(undefined, undefined, [
    {
      taskId: "explicit-reconciliation",
      dueAt: t("10:02:00"),
      action: {
        kind: "WATERMARK",
        streamId: hash(stream),
        authorityReference: "recorded-source-owner",
        evidence: {
          sessionId: "session-1",
          through: t("10:02:00"),
          observedAt: t("10:02:00"),
          coverage: "COMPLETE_COVERAGE",
          kind: "END_OF_STREAM",
          evidenceId: "source-reconciliation",
          reconciled: true,
        },
      },
    },
  ]);
  const root = mkdtempSync(join(tmpdir(), "ate-channel-replay-"));
  roots.push(root);
  const clock = new VirtualClock(t("13:00:00"));
  const repository = new FilesystemReplayCheckpointRepository(root, clock, f.spec.resourceLimits);
  const controller = new ReplayController(f.spec, f.inputs, repository);
  ok(await controller.initialize());
  ok(await controller.runToTime(t("10:00:00")));
  return { ...f, root, clock, repository, controller };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("real Prompt 17 asynchronous channel loss", () => {
  it("records capacity-one overflow and fences unknown subscription scope", async () => {
    const f = await setup();
    const channel = new ConsumerChannel("consumer-1", 1);
    expect(channel.deliver(accepted(1))).toBe(true);
    expect(channel.deliver(accepted(2))).toBe(false);
    const cp = ok(await f.controller.observeConsumerChannel(channel, "captured-channel"));
    expect(Object.values(cp.aggregation.consumerLosses ?? {})).toMatchObject([
      { rejected: 1, scope: "UNKNOWN_CHANNEL_SCOPE", affectedStreams: [hash(stream)] },
    ]);
    expect(cp.aggregation.watermarks[hash(stream)]?.status).toBe("FENCED");
    expect(cp.cursor).toBe(2);
    expect(f.controller.diagnostics().pendingConsumerReads).toBe(0);
  });
  it("observes loss introduced during the actual asynchronous read", async () => {
    const f = await setup();
    const pending = gate(),
      entered = gate();
    class DelayedChannel extends ConsumerChannel {
      public override async read() {
        const retained = await super.read();
        entered.resolve();
        await pending.promise;
        return retained;
      }
    }
    const channel = new DelayedChannel("consumer-await", 1);
    channel.deliver(accepted(1));
    const read = f.controller.observeConsumerChannel(channel, "captured-channel");
    await entered.promise;
    expect(channel.deliver(accepted(2))).toBe(true);
    expect(channel.deliver(accepted(3))).toBe(false);
    pending.resolve();
    const cp = ok(await read);
    expect(Object.values(cp.aggregation.consumerLosses ?? {})[0]?.rejected).toBe(1);
    expect(cp.aggregation.watermarks[hash(stream)]?.status).toBe("FENCED");
  });
  it("retains unknown read scope when shutdown interrupts the await", async () => {
    const f = await setup();
    const pending = gate(),
      entered = gate();
    class DelayedChannel extends ConsumerChannel {
      public override async read() {
        entered.resolve();
        await pending.promise;
        return super.read();
      }
    }
    const channel = new DelayedChannel("consumer-stop", 1);
    channel.deliver(accepted(1));
    const read = f.controller.observeConsumerChannel(channel, "captured-channel");
    await entered.promise;
    expect(await f.controller.stop()).toMatchObject({ ok: false, code: "SHUTDOWN_IN_PROGRESS" });
    channel.close();
    pending.resolve();
    expect(await read).toMatchObject({ ok: false, code: "CHANNEL_READ_INTERRUPTED" });
    expect(await f.controller.stop()).toMatchObject({ ok: false, code: "RECOVERY_OBLIGATION" });
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    const restored = ok(await fresh.initialize());
    expect(restored.aggregation.watermarks[hash(stream)]?.status).toBe("FENCED");
    expect(fresh.diagnostics().pendingConsumerReads).toBe(1);
    expect(await fresh.stop()).toMatchObject({ ok: false, code: "CHANNEL_RECOVERY_OBLIGATION" });
  });
  it("requires explicit recorded source reconciliation to close recovered read obligations", async () => {
    const f = await setup();
    const pending = gate(),
      entered = gate();
    class DelayedChannel extends ConsumerChannel {
      public override async read() {
        entered.resolve();
        await pending.promise;
        return super.read();
      }
    }
    const channel = new DelayedChannel("consumer-recovery", 1);
    const read = f.controller.observeConsumerChannel(channel, "capture");
    await entered.promise;
    await f.controller.stop();
    pending.resolve();
    await read;
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    const cp = ok(await fresh.initialize());
    const id = cp.evidence.find((e) => e.kind === "CHANNEL_READ_PENDING")!.identity;
    expect(await fresh.reconcileConsumerRead(id)).toMatchObject({
      ok: false,
      code: "SOURCE_RECONCILIATION_REQUIRED",
    });
    ok(await fresh.runToTime(t("10:02:00")));
    ok(await fresh.reconcileConsumerRead(id));
    expect(fresh.diagnostics().pendingConsumerReads).toBe(0);
    expect(ok(await fresh.runToEnd()).state).toBe("COMPLETED");
  });
  it("preserves a durable fence when loss persistence fails after the read", async () => {
    const f = await setup();
    let commits = 0;
    const faulty: ReplayCheckpointRepository = {
      recover: (s) => f.repository.recover(s),
      publish: (id) => f.repository.publish(id),
      commit: (cp) =>
        ++commits === 2
          ? {
              ok: false,
              code: "LOSS_WRITE_FAILED",
              operationId: cp.checkpointId,
              commitment: "CONFIRMED_NOT_COMMITTED",
            }
          : f.repository.commit(cp),
    };
    const c = new ReplayController(f.spec, f.inputs, faulty);
    ok(await c.initialize());
    const channel = new ConsumerChannel("consumer-loss-write", 1);
    channel.deliver(accepted(1));
    channel.deliver(accepted(2));
    expect(await c.observeConsumerChannel(channel, "capture")).toMatchObject({
      ok: false,
      code: "LOSS_WRITE_FAILED",
    });
    expect(await c.stop()).toMatchObject({ ok: false, code: "CHANNEL_RECOVERY_OBLIGATION" });
    const fresh = new ReplayController(f.spec, f.inputs, f.repository);
    const restored = ok(await fresh.initialize());
    expect(restored.aggregation.watermarks[hash(stream)]?.status).toBe("FENCED");
    expect(fresh.diagnostics().pendingConsumerReads).toBe(1);
  });
  it("rejects unrecorded future observations and preserves the pending read guard", async () => {
    const f = await setup();
    const channel = new ConsumerChannel("future", 1);
    channel.deliver(accepted(3));
    expect(await f.controller.observeConsumerChannel(channel, "capture")).toMatchObject({
      ok: false,
      code: "CONSUMER_INTEGRITY_FAILED",
    });
    expect(f.controller.diagnostics().pendingConsumerReads).toBe(1);
  });
  it("retains discarded-on-close evidence even without rejection", async () => {
    const f = await setup();
    const channel = new ConsumerChannel("closed", 1);
    channel.deliver(accepted(1));
    channel.close();
    const cp = ok(await f.controller.observeConsumerChannel(channel, "capture"));
    expect(Object.values(cp.aggregation.consumerLosses ?? {})[0]).toMatchObject({
      discarded: 1,
      closed: true,
      rejected: 0,
    });
  });
});
