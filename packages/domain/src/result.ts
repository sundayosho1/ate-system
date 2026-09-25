import type { ZodIssue, ZodType } from "zod";

export type DomainIssueSeverity = "ERROR" | "WARNING";

export type DomainIssue = Readonly<{
  code: string;
  message: string;
  path?: readonly (string | number)[];
  severity?: DomainIssueSeverity;
}>;

export type DomainResult<T> =
  | Readonly<{
      ok: true;
      value: T;
    }>
  | Readonly<{
      ok: false;
      issues: readonly DomainIssue[];
    }>;

export const ok = <T>(value: T): DomainResult<T> => ({ ok: true, value });

export const fail = (issues: readonly DomainIssue[] | DomainIssue): DomainResult<never> => ({
  ok: false,
  issues: Array.isArray(issues) ? issues : [issues],
});

export const domainIssue = (
  code: string,
  message: string,
  path?: readonly (string | number)[],
): DomainIssue => ({
  code,
  message,
  ...(path === undefined ? {} : { path }),
  severity: "ERROR",
});

const fromZodIssue = (issue: ZodIssue): DomainIssue =>
  domainIssue(issue.code, issue.message, issue.path);

export const parseWithSchema = <T>(schema: ZodType<T>, input: unknown): DomainResult<T> => {
  const result = schema.safeParse(input);

  if (result.success) {
    return ok(result.data);
  }

  return fail(result.error.issues.map(fromZodIssue));
};

export const unwrapOrThrow = <T>(result: DomainResult<T>): T => {
  if (result.ok) {
    return result.value;
  }

  throw new Error(result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
};
