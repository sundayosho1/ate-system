import { it, expect } from "vitest";
import { ReplayController, FilesystemReplayCheckpointRepository } from "@ate/market-replay";
import { VirtualClock } from "@ate/time";
import { fingerprint } from "@ate/configuration";
import { fixture, approve, take, root } from "./fixtures.js";
import { acceptanceFixture } from "../market-replay/acceptance-fixture.js";
import { historicalFixture } from "../market-replay/historical-fixture.js";
it.each(["VERIFIED_POINT_IN_TIME", "EVENT_TIME_RECONSTRUCTION"] as const)(
  "J owner-preservation journey uses actual P16/P18/P19 owners in %s",
  async (mode) => {
    const f = await fixture(),
      c = await f.import(),
      approval = await approve(f, c),
      request = f.request();
    request.approvals = [
      {
        ownerId: "offline-lab",
        catalogueFingerprint: c.fingerprint,
        observationFingerprint: c.observations[0]!.fingerprint,
        proposalId: approval.proposal.proposalId,
      },
    ];
    const s = take(await f.service.publish(request)),
      history = await historicalFixture(),
      data = await acceptanceFixture(mode, false),
      before = {
        history: fingerprint(history.registration),
        quality: fingerprint(history.report),
        spec: fingerprint(data.spec),
        inputs: fingerprint(data.inputs),
      };
    take(
      f.service.associateResearchEvidence(s.prepared.mappings[0]!.fingerprint, {
        owner: "DATASET_CATALOGUE",
        ownerReference: history.registration.entry.version.versionId,
        ownerFingerprint: history.registration.entry.version.versionFingerprint,
      }),
    );
    take(
      f.service.associateResearchEvidence(s.prepared.mappings[0]!.fingerprint, {
        owner: "MARKET_REPLAY",
        ownerReference: data.spec.sessionId,
        ownerFingerprint: before.spec,
      }),
    );
    const control = new ReplayController(
        data.spec,
        data.inputs,
        new FilesystemReplayCheckpointRepository(
          root(),
          new VirtualClock(f.base.clock.now()),
          data.spec.resourceLimits,
        ),
      ),
      associated = new ReplayController(
        data.spec,
        data.inputs,
        new FilesystemReplayCheckpointRepository(
          root(),
          new VirtualClock(f.base.clock.now()),
          data.spec.resourceLimits,
        ),
      );
    expect((await control.initialize()).ok).toBe(true);
    expect((await associated.initialize()).ok).toBe(true);
    for (let i = 0; i < 6; i++) {
      const a = await control.stepEvent(),
        b = await associated.stepEvent();
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(b).toEqual(a);
    }
    expect(fingerprint(history.registration)).toBe(before.history);
    expect(fingerprint(history.report)).toBe(before.quality);
    expect(fingerprint(data.spec)).toBe(before.spec);
    expect(fingerprint(data.inputs)).toBe(before.inputs);
  },
);
