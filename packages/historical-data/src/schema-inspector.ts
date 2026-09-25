import type {
  HistoricalFormat,
  ParsedHistoricalRecord,
  SourceFieldSummary,
  SourceSchemaSummary,
} from "./types.js";

export const inspectRecords = (input: {
  format: HistoricalFormat;
  records: readonly ParsedHistoricalRecord[];
  inspectedAt: SourceSchemaSummary["inspectedAt"];
}): SourceSchemaSummary => {
  const fields = new Map<
    string,
    {
      missing: number;
      samples: Set<string>;
      types: Set<SourceFieldSummary["inferredTypes"][number]>;
    }
  >();

  for (const record of input.records) {
    for (const key of Object.keys(record.values)) {
      if (!fields.has(key)) {
        fields.set(key, { missing: 0, samples: new Set(), types: new Set() });
      }
    }
    for (const [field, summary] of fields) {
      const value = record.values[field];
      if (value === undefined || value === null || value === "") {
        summary.missing += 1;
        summary.types.add("NULL");
      } else {
        const asString = valueToString(value).slice(0, 64);
        if (summary.samples.size < 3) {
          summary.samples.add(asString);
        }
        inferTypes(asString).forEach((type) => summary.types.add(type));
      }
    }
  }

  const summaries = Array.from(fields.entries()).map(([fieldName, value]) => ({
    fieldName,
    inferredTypes: Array.from(value.types).sort(),
    missingCount: value.missing,
    sampleValues: Array.from(value.samples),
  }));

  return {
    format: input.format,
    recordCount: input.records.length,
    fields: summaries,
    timestampCandidates: candidateFields(summaries, ["time", "date", "timestamp"]),
    priceCandidates: candidateFields(summaries, [
      "bid",
      "ask",
      "price",
      "open",
      "high",
      "low",
      "close",
    ]),
    volumeCandidates: candidateFields(summaries, ["volume", "tick", "quantity", "qty", "count"]),
    inspectedAt: input.inspectedAt,
  };
};

const inferTypes = (value: string): SourceFieldSummary["inferredTypes"] => {
  const types: SourceFieldSummary["inferredTypes"][number][] = ["STRING"];
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/u.test(value)) {
    types.push("DECIMAL");
  }
  if (/^(true|false)$/iu.test(value)) {
    types.push("BOOLEAN");
  }
  if (/^\d{4}-\d{2}-\d{2}[T\s]/u.test(value) || /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    types.push("TIMESTAMP_CANDIDATE");
  }
  return types;
};

const valueToString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "[non-scalar]";
};

const candidateFields = (
  summaries: readonly SourceFieldSummary[],
  names: readonly string[],
): readonly string[] =>
  summaries
    .filter((summary) => {
      const lower = summary.fieldName.toLowerCase();
      return names.some((name) => lower.includes(name));
    })
    .map((summary) => summary.fieldName);
