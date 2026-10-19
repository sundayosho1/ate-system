import { inOperation } from "./validation.js";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, link, unlink } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import {
  success,
  failure,
  type OpportunityRepository,
  type JournalRecord,
  type Policy,
} from "./contracts.js";
import { defaultOpportunityPolicy, effectivePolicy } from "./policy.js";
import { canonical, checkedCanonicalText } from "./canonical.js";
import { recoverJournal } from "./recovery.js";
import { acknowledgement } from "./journal.js";
import { demand } from "./validation.js";
function absent(error: unknown) {
  return error !== null && typeof error === "object" && Reflect.get(error, "code") === "ENOENT";
}
/** Offline trusted root and single writer. No Windows or power-loss certificate. */
export class FilesystemOpportunityRepository implements OpportunityRepository {
  readonly root: string;
  readonly storageMode = "OFFLINE_FILESYSTEM" as const;
  readonly policy: Policy;
  private busy = false;
  constructor(root: string, policy: Policy = defaultOpportunityPolicy) {
    demand(
      typeof root === "string" &&
        root.length > 0 &&
        Buffer.byteLength(root) <= 4096 &&
        !Array.from(root).some((c) => c.charCodeAt(0) < 32),
      "INPUT_INVALID",
    );
    this.root = resolve(root);
    this.policy = effectivePolicy(policy);
    demand(this.policy.filesystemEnabled, "FILESYSTEM_DISABLED");
  }
  private async ancestors() {
    let p = this.root;
    while (true) {
      try {
        const s = await lstat(p);
        demand(!s.isSymbolicLink() && s.isDirectory(), "UNTRUSTED_ROOT");
      } catch (e) {
        if (!absent(e)) throw e;
      }
      if (dirname(p) === p) break;
      p = dirname(p);
    }
  }
  private async text(name: string) {
    const file = await open(join(this.root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      demand(stat.isFile() && stat.size <= this.policy.limits.maxRecordBytes, "BUDGET_EXHAUSTED");
      const buffer = Buffer.alloc(this.policy.limits.maxRecordBytes + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      demand(bytesRead <= this.policy.limits.maxRecordBytes, "BUDGET_EXHAUSTED");
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } finally {
      await file.close();
    }
  }
  private async read() {
    await this.ancestors();
    let dir;
    try {
      dir = await opendir(this.root);
    } catch (e) {
      if (absent(e)) return [] as readonly JournalRecord[];
      throw e;
    }
    const names: string[] = [];
    for await (const entry of dir) {
      demand(names.length < this.policy.limits.maxJournalRecords * 2, "BUDGET_EXHAUSTED");
      names.push(entry.name);
    }
    names.sort();
    const published = names.filter((n) => /^journal-[0-9]{8}\.json$/u.test(n)),
      pending = names.filter((n) => /^\.pending-[a-f0-9]{64}\.json$/u.test(n));
    demand(names.length === published.length + pending.length, "JOURNAL_CORRUPT");
    const raw: unknown[] = [];
    let retained = 0;
    for (const [i, n] of published.entries()) {
      demand(n === `journal-${String(i + 1).padStart(8, "0")}.json`, "JOURNAL_CORRUPT");
      const text = await this.text(n);
      retained += Buffer.byteLength(text);
      demand(retained <= this.policy.limits.maxRetainedJournalBytes, "BUDGET_EXHAUSTED");
      raw.push(checkedCanonicalText(text, this.policy.limits));
    }
    const records = raw;
    for (const n of pending) {
      const text = await this.text(n);
      retained += Buffer.byteLength(text);
      demand(retained <= this.policy.limits.maxRetainedJournalBytes, "BUDGET_EXHAUSTED");
      const p = checkedCanonicalText(text, this.policy.limits);
      demand(
        p !== null &&
          typeof p === "object" &&
          "fingerprint" in p &&
          typeof p.fingerprint === "string",
        "RECOVERY_REQUIRED",
      );
      demand(
        n === `.pending-${p.fingerprint.slice(7)}.json` &&
          records.some((r) => canonical(r) === text),
        "RECOVERY_REQUIRED",
      );
    }
    return records;
  }
  async load() {
    return inOperation(this.policy.limits, async () => {
      try {
        return success(await this.read());
      } catch {
        return failure("RECOVERY_REQUIRED", "UNKNOWN");
      }
    });
  }
  async compareAppend(raw: JournalRecord) {
    return inOperation(this.policy.limits, async () => {
      if (this.busy) return failure("BUSY");
      this.busy = true;
      let possible = false;

      try {
        const records = await this.read();
        const record = recoverJournal([...records, raw], this.root, this.policy).at(-1)!;
        const text = canonical(record);
        demand(Buffer.byteLength(text) <= this.policy.limits.maxRecordBytes, "BUDGET_EXHAUSTED");
        await this.ancestors();
        await mkdir(this.root, { recursive: true });
        await this.ancestors();
        const pending = `.pending-${record.fingerprint.slice(7)}.json`;
        const path = join(this.root, pending);
        const handle = await open(path, "wx");
        possible = true;
        try {
          await handle.writeFile(text, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await link(
          path,
          join(this.root, `journal-${String(record.journalGeneration).padStart(8, "0")}.json`),
        );
        const exact = await this.text(
          `journal-${String(record.journalGeneration).padStart(8, "0")}.json`,
        );
        demand(exact === text, "ACK_MISMATCH");
        await unlink(path);
        return success(acknowledgement(record, this.storageMode));
      } catch {
        return failure("REPOSITORY_WRITE_FAILED", possible ? "UNKNOWN" : "NONE", raw.operationId);
      } finally {
        this.busy = false;
      }
    });
  }
}
