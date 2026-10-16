import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprint } from "@ate/configuration";
import {
  MOSECoreRuntime,
  checkpointSchema,
  FilesystemMOSERepository,
  type Checkpoint,
  type Repository,
} from "@ate/mose-core";
import { fixture, take, root, type Owners } from "./fixtures.js";
export const historicalArtifacts = JSON.parse(
  readFileSync(new URL("./audit-history-fixtures.json", import.meta.url), "utf8"),
) as Record<string, { files: Record<string, string>; sha256: Record<string, string> }>;
export const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const rehash = (c: Checkpoint) => {
  const { fingerprint: ignored, ...body } = c;
  void ignored;
  c.fingerprint = fingerprint(body);
};
export async function recover(f: Awaited<ReturnType<typeof fixture>>, repository = f.repository) {
  const reader = new MOSECoreRuntime("mose-lab", { ...f.ports, repository });
  return { reader, result: await reader.initialize() };
}
export async function stored(base: Owners, kind: string) {
  const path = root(),
    artifact = historicalArtifacts[kind]!,
    first = JSON.parse(Object.values(artifact.files)[0]!) as Checkpoint,
    policy = first.state.sessions[0]!.universe.policy,
    repository = new FilesystemMOSERepository(
      path,
      policy.maxCheckpointBytes,
      policy.maxHistory,
      policy.maxRetainedBytes,
    );
  for (const [name, bytes] of Object.entries(artifact.files))
    writeFileSync(join(path, name), bytes);
  const f = await fixture(base, policy, repository, false),
    reader = new MOSECoreRuntime(first.runtimeId, f.ports);
  return { path, f, reader, result: await reader.initialize(), first };
}
export async function altered(
  f: Awaited<ReturnType<typeof fixture>>,
  mutation: (checkpoint: Checkpoint) => void,
) {
  const rows = copy(take(await f.repository.load())) as Checkpoint[];
  let previous: string | null = null;
  for (const row of rows) {
    mutation(row);
    row.previous = previous;
    rehash(row);
    previous = row.fingerprint;
  }
  const repository: Repository = {
    load: () => Promise.resolve({ ok: true, value: rows }),
    commit: () => Promise.reject(Error("NO_WRITE_EXPECTED")),
  };
  return { ...(await recover(f, repository)), rows };
}
export async function started(base: Owners) {
  const f = await fixture(base);
  await f.setup();
  take(await f.start());
  return f;
}

export async function loadCheckpoints(repository: Repository): Promise<Checkpoint[]> {
  return take(await repository.load()).map((row) => checkpointSchema.parse(row));
}
