// Real upstream owners are immutable in this campaign. Share their retained artifacts,
// while isolating every P24 clock, authority resolver, configuration, service and root.
import { beforeAll } from "vitest";
import { VirtualClock } from "@ate/time";
import { StaticApprovalAuthorityResolver } from "@ate/configuration";
import {
  InstrumentEligibility,
  MemoryEligibilityRepository,
  type Repository,
  type Policy,
  type Action,
  type Stage,
} from "@ate/instrument-eligibility";
import {
  fixture as ownerFixture,
  take,
  issuer,
  checker,
  maker,
  time,
  configuration,
} from "./fixtures.js";
let owners: Awaited<ReturnType<typeof ownerFixture>>;
beforeAll(async () => {
  owners = await ownerFixture();
});
export async function fixture(
  policy: Policy = owners.policy,
  repository: Repository = new MemoryEligibilityRepository(),
) {
  const clock = new VirtualClock(time),
    context = structuredClone(owners.context);
  let config = await configuration(policy, clock),
    seq = 0;
  const ports = {
    ...owners.ports,
    clock,
    repository,
    configuration: () => config,
    authorityResolver: new StaticApprovalAuthorityResolver({
      clock,
      grants: {
        [issuer.actorId]: ["CONFIGURATION_CHECKER"],
        [checker.actorId]: ["CONFIGURATION_CHECKER"],
      },
    }),
  };
  const service = new InstrumentEligibility("eligibility-lab", ports);
  take(await service.initialize());
  const request = (destination: Stage, extra: Partial<Extract<Action, { kind: "REQUEST" }>> = {}) =>
    owners.request(destination, {
      ...extra,
      id: `request-${++seq}`,
      context: structuredClone(context),
    });
  const promote = async (
    destination: Stage,
    extra: Partial<Extract<Action, { kind: "REQUEST" }>> = {},
  ) => {
    const r = request(destination, extra);
    take(await service.requestTransition(r));
    const a = take(
      await service.approveTransition({
        kind: "APPROVE",
        id: `approval-${++seq}`,
        requestId: r.id,
        checker,
      }),
    );
    return take(
      await service.commitTransition({
        kind: "COMMIT",
        id: `commit-${++seq}`,
        requestId: r.id,
        approvalId: a.action.id,
      }),
    );
  };
  const discover = async () =>
    take(
      await service.discover({
        kind: "DISCOVER",
        id: "discover",
        instrumentId: context.instrumentId,
        context,
        maker,
        occurredAt: time,
        effectiveAt: time,
      }),
    );
  return {
    ...owners,
    service,
    ports,
    context,
    policy,
    repository,
    request,
    promote,
    discover,
    attestation: (extra: Record<string, unknown> = {}) =>
      owners.attestation({ policyId: policy.policyId, ...extra }),
    toResearch: async () => {
      await discover();
      for (const stage of ["MAPPED", "DATA_QUALIFIED", "RESEARCH"] as const) await promote(stage);
    },
    setConfiguration: (value: typeof config) => {
      config = value;
    },
    spec: {
      ...owners.spec,
      mapping: { ...owners.spec.mapping, base: { ...owners.spec.mapping.base, clock } },
    },
  };
}
