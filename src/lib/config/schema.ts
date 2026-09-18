export const CURRENT_SCHEMA = 1;

export type WhenClause = string;

export type ProvisionCommand = {
  run: string;
  /** "always" | "once" | "if-missing:<path>" */
  when: WhenClause;
};

export type WtConfig = {
  schema: number;
  repo: { defaultBase?: string; remote?: string };
  space: { label?: string; layout?: string };
  provision: {
    copy: readonly string[];
    timeoutMs: number;
    commands: readonly ProvisionCommand[];
  };
  remove: { deleteBranch: "ask" | "never" | "always" };
};

export const DEFAULT_CONFIG: WtConfig = {
  schema: CURRENT_SCHEMA,
  repo: {},
  space: {},
  provision: { copy: [], timeoutMs: 900_000, commands: [] },
  remove: { deleteBranch: "ask" },
};

export type ConfigIssue = { path: string; message: string };

export type ParsedConfig = {
  config: Partial<WtConfig>;
  /** Unknown keys are kept as warnings, never silently dropped. */
  warnings: readonly ConfigIssue[];
};

export type ValidationResult =
  | { kind: "ok"; parsed: ParsedConfig }
  /** A newer schema than we understand: refuse rather than guess. */
  | { kind: "too-new"; found: number };

const KNOWN_SECTIONS = ["repo", "space", "provision", "remove"] as const;
const KNOWN_KEYS: Record<string, readonly string[]> = {
  repo: ["default_base", "remote"],
  space: ["label", "layout"],
  provision: ["copy", "timeout_ms", "commands"],
  remove: ["delete_branch"],
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;

const asCommands = (value: unknown): ProvisionCommand[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const run = asString(record.run);
      return run === undefined
        ? undefined
        : { run, when: asString(record.when) ?? "always" };
    })
    .filter((entry): entry is ProvisionCommand => entry !== undefined);
};

/**
 * Unknown keys warn and are listed by `wt doctor`. herdr tolerates them with a
 * startup warning nobody reads, which turns every typo into a silent fallback
 * to the default.
 */
export const validateConfig = (
  raw: unknown,
  source: string,
): ValidationResult => {
  const record = asRecord(raw);
  const schema =
    typeof record.schema === "number" ? record.schema : CURRENT_SCHEMA;
  if (schema > CURRENT_SCHEMA) return { kind: "too-new", found: schema };

  const warnings: ConfigIssue[] = [];
  for (const key of Object.keys(record)) {
    if (key === "schema") continue;
    if (!KNOWN_SECTIONS.includes(key as (typeof KNOWN_SECTIONS)[number])) {
      warnings.push({ path: source, message: `unknown section [${key}]` });
      continue;
    }
    for (const inner of Object.keys(asRecord(record[key]))) {
      if (!(KNOWN_KEYS[key] ?? []).includes(inner)) {
        warnings.push({ path: source, message: `unknown key ${key}.${inner}` });
      }
    }
  }

  const repo = asRecord(record.repo);
  const space = asRecord(record.space);
  const provision = asRecord(record.provision);
  const remove = asRecord(record.remove);

  const deleteBranch = asString(remove.delete_branch);

  const config: Partial<WtConfig> = {
    schema,
    repo: {
      defaultBase: asString(repo.default_base),
      remote: asString(repo.remote),
    },
    space: { label: asString(space.label), layout: asString(space.layout) },
    provision: {
      copy: asStringArray(provision.copy) ?? [],
      timeoutMs:
        typeof provision.timeout_ms === "number"
          ? provision.timeout_ms
          : DEFAULT_CONFIG.provision.timeoutMs,
      commands: asCommands(provision.commands) ?? [],
    },
    remove: {
      deleteBranch:
        deleteBranch === "never" || deleteBranch === "always"
          ? deleteBranch
          : "ask",
    },
  };

  return { kind: "ok", parsed: { config, warnings } };
};

const defined = <T>(...values: (T | undefined)[]): T | undefined =>
  values.find((value) => value !== undefined);

/**
 * Later layers win. Arrays REPLACE rather than concatenate: otherwise a project
 * could never drop a step inherited from the defaults.
 */
export const mergeConfigs = (
  layers: readonly Partial<WtConfig>[],
): WtConfig => {
  const reversed = [...layers].reverse();
  const pick = <T>(
    read: (layer: Partial<WtConfig>) => T | undefined,
  ): T | undefined => defined(...reversed.map(read));

  return {
    schema: CURRENT_SCHEMA,
    repo: {
      defaultBase: pick((layer) => layer.repo?.defaultBase),
      remote: pick((layer) => layer.repo?.remote),
    },
    space: {
      label: pick((layer) => layer.space?.label),
      layout: pick((layer) => layer.space?.layout),
    },
    provision: {
      copy:
        pick((layer) =>
          layer.provision?.copy.length === 0
            ? undefined
            : layer.provision?.copy,
        ) ?? [],
      timeoutMs:
        pick((layer) => layer.provision?.timeoutMs) ??
        DEFAULT_CONFIG.provision.timeoutMs,
      commands:
        pick((layer) =>
          layer.provision?.commands.length === 0
            ? undefined
            : layer.provision?.commands,
        ) ?? [],
    },
    remove: {
      deleteBranch: pick((layer) => layer.remove?.deleteBranch) ?? "ask",
    },
  };
};
