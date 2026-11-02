// Maps the stable codes the backend returns for a rejected smart playlist rule to localized
// messages, the same way passwordErrors.ts does for passwords.

type Translate = (key: string) => string;

export type RuleFieldErrors = Partial<Record<'field' | 'operator' | 'value' | 'value_2', string>>;

const CODE_TO_KEY: Record<string, string> = {
  unsupported_field: 'smartPlaylists.ruleErrors.unsupportedField',
  unsupported_operator: 'smartPlaylists.ruleErrors.unsupportedOperator',
  value_required: 'smartPlaylists.ruleErrors.valueRequired',
  whole_number_required: 'smartPlaylists.ruleErrors.wholeNumberRequired',
  number_out_of_range: 'smartPlaylists.ruleErrors.numberOutOfRange',
  reversed_range: 'smartPlaylists.ruleErrors.reversedRange',
  date_required: 'smartPlaylists.ruleErrors.dateRequired',
  date_out_of_range: 'smartPlaylists.ruleErrors.dateOutOfRange',
};
const UNKNOWN_CODE_KEY = 'smartPlaylists.ruleErrors.invalid';

const translateCode = (code: unknown, t: Translate): string => t(CODE_TO_KEY[String(code)] ?? UNKNOWN_CODE_KEY);

/**
 * Indexed by submitted rule position. The API names only the rules that failed, keyed by
 * position: `{ rules: { "1": { value: ["value_required"] } } }`.
 */
export function ruleErrorsFromResponse(data: any, t: Translate): RuleFieldErrors[] {
  const errors: RuleFieldErrors[] = [];
  for (const [position, ruleErrors] of Object.entries<any>(data?.rules ?? {})) {
    if (!/^\d+$/.test(position)) continue;
    const messages: RuleFieldErrors = {};
    for (const target of ['field', 'operator', 'value', 'value_2'] as const) {
      if (ruleErrors?.[target]?.length) messages[target] = translateCode(ruleErrors[target][0], t);
    }
    errors[Number(position)] = messages;
  }
  return errors;
}

export function firstRuleError(errors: RuleFieldErrors[]): string | undefined {
  return errors.flatMap((ruleErrors) => Object.values(ruleErrors))[0];
}
