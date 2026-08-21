export const ANONYMIZATION_FIELD = {
  NAME: 'name',
  EMAIL: 'email',
  PHONE: 'phone',
  DOCUMENT: 'document',
  ADDRESS: 'address',
  SENSITIVE_DATE: 'sensitive_date',
} as const;

export type AnonymizationField = (typeof ANONYMIZATION_FIELD)[keyof typeof ANONYMIZATION_FIELD];

export interface AnonymizationPatterns {
  name?: RegExp;
  email?: RegExp;
  phone?: RegExp;
  document?: RegExp;
  address?: RegExp;
  sensitiveDate?: RegExp;
}

export interface AnonymizerOptions {
  reversible?: boolean;
  tokenPrefix?: string;
  enabledFields?: ReadonlyArray<AnonymizationField>;
  names?: ReadonlyArray<string>;
  patterns?: AnonymizationPatterns;
}

export interface AnonymizationReplacement {
  field: AnonymizationField;
  token: string;
}

export interface AnonymizationResult {
  text: string;
  replacements: AnonymizationReplacement[];
  reversible: boolean;
}

interface PatternDefinition {
  field: AnonymizationField;
  pattern: RegExp;
}

const DEFAULT_PATTERNS: Record<AnonymizationField, RegExp> = {
  name: /(?:nombre|name)\s*[:=-]\s*[A-ZÁÉÍÓÚÑ][^\n,;]{1,80}/giu,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  phone: /(?<!\d)(?:\+?\d[\d\s().-]{6,}\d)(?!\d)/gu,
  document: /(?:DNI|NIF|NIE|cédula|cedula|documento|passport|pasaporte)\s*[:#=-]?\s*[A-Z0-9][A-Z0-9 -]{4,24}/giu,
  address: /(?:dirección|direccion|domicilio|address)\s*[:=-]\s*[^\n,;]{3,120}/giu,
  sensitive_date: /(?:fecha\s+(?:de\s+)?nacimiento|birth\s+date|date\s+of\s+birth|DOB)\s*[:=-]?\s*\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/giu,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withGlobalFlag(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function fieldPattern(field: AnonymizationField, options: AnonymizerOptions): RegExp {
  const custom = field === ANONYMIZATION_FIELD.SENSITIVE_DATE
    ? options.patterns?.sensitiveDate
    : field === ANONYMIZATION_FIELD.NAME
      ? options.patterns?.name
      : field === ANONYMIZATION_FIELD.EMAIL
        ? options.patterns?.email
        : field === ANONYMIZATION_FIELD.PHONE
          ? options.patterns?.phone
          : field === ANONYMIZATION_FIELD.DOCUMENT
            ? options.patterns?.document
            : options.patterns?.address;
  if (custom) return withGlobalFlag(custom);
  if (field === ANONYMIZATION_FIELD.NAME && options.names && options.names.length > 0) {
    const names = [...options.names].sort((left, right) => right.length - left.length).map(escapeRegExp).join('|');
    return new RegExp(`\\b(?:${names})\\b`, 'giu');
  }
  return withGlobalFlag(DEFAULT_PATTERNS[field]);
}

function definitions(options: AnonymizerOptions): PatternDefinition[] {
  const enabled = new Set(options.enabledFields ?? Object.values(ANONYMIZATION_FIELD));
  const orderedFields: AnonymizationField[] = [ANONYMIZATION_FIELD.NAME, ANONYMIZATION_FIELD.EMAIL, ANONYMIZATION_FIELD.SENSITIVE_DATE, ANONYMIZATION_FIELD.PHONE, ANONYMIZATION_FIELD.DOCUMENT, ANONYMIZATION_FIELD.ADDRESS];
  return orderedFields.filter((field) => enabled.has(field)).map((field) => ({ field, pattern: fieldPattern(field, options) }));
}

export class Anonymizer {
  private readonly reversible: boolean;
  private readonly tokenPrefix: string;
  private readonly tokens = new Map<string, string>();
  private readonly originals = new Map<string, string>();
  private readonly counters = new Map<AnonymizationField, number>();
  private readonly definitionsList: PatternDefinition[];

  public constructor(options: AnonymizerOptions = {}) {
    this.reversible = options.reversible ?? false;
    this.tokenPrefix = options.tokenPrefix ?? 'REDACTED';
    this.definitionsList = definitions(options);
  }

  private tokenFor(field: AnonymizationField, original: string): string {
    const existing = this.tokens.get(`${field}:${original}`);
    if (existing) return existing;
    const next = (this.counters.get(field) ?? 0) + 1;
    this.counters.set(field, next);
    const token = `[${this.tokenPrefix}_${field.toUpperCase()}_${next}]`;
    if (this.reversible) {
      this.tokens.set(`${field}:${original}`, token);
      this.originals.set(token, original);
    }
    return token;
  }

  public anonymize(input: string): AnonymizationResult {
    let text = input;
    const replacements: AnonymizationReplacement[] = [];
    for (const definition of this.definitionsList) {
      text = text.replace(definition.pattern, (match: string) => {
        const token = this.tokenFor(definition.field, match);
        replacements.push({ field: definition.field, token });
        return token;
      });
    }
    return { text, replacements, reversible: this.reversible };
  }

  public restore(input: string): string {
    if (!this.reversible || this.originals.size === 0) return input;
    let restored = input;
    for (const [token, original] of this.originals.entries()) restored = restored.replaceAll(token, original);
    return restored;
  }
}

export function anonymizeText(input: string, options?: AnonymizerOptions): AnonymizationResult {
  return new Anonymizer(options).anonymize(input);
}
