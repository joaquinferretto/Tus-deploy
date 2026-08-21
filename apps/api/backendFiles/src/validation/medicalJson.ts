export const MEDICAL_JSON_ERROR_CODE = {
  INVALID_JSON: 'invalid_json',
  NOT_OBJECT: 'not_object',
  MISSING_FIELD: 'missing_field',
  INVALID_TYPE: 'invalid_type',
} as const;

export type MedicalJsonErrorCode = (typeof MEDICAL_JSON_ERROR_CODE)[keyof typeof MEDICAL_JSON_ERROR_CODE];

export const MEDICAL_JSON_FIELD_TYPE = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
  NULL: 'null',
} as const;

export type MedicalJsonFieldType = (typeof MEDICAL_JSON_FIELD_TYPE)[keyof typeof MEDICAL_JSON_FIELD_TYPE];

export interface MedicalJsonValidationError {
  code: MedicalJsonErrorCode;
  path: string;
  message: string;
}

export interface MedicalJsonSchema {
  requiredFields: ReadonlyArray<string>;
  arrayFields: ReadonlyArray<string>;
  fieldTypes?: Readonly<Record<string, MedicalJsonFieldType>>;
}

export interface MedicalJsonSuccess {
  ok: true;
  data: Record<string, unknown>;
  errors: [];
}

export interface MedicalJsonFailure {
  ok: false;
  data: null;
  errors: MedicalJsonValidationError[];
}

export type MedicalJsonResult = MedicalJsonSuccess | MedicalJsonFailure;

export const DEFAULT_MEDICAL_JSON_SCHEMA: MedicalJsonSchema = {
  requiredFields: ['summary', 'findings', 'impression', 'recommendations', 'limitations'],
  arrayFields: ['findings', 'recommendations', 'limitations'],
  fieldTypes: {
    summary: MEDICAL_JSON_FIELD_TYPE.STRING,
    findings: MEDICAL_JSON_FIELD_TYPE.ARRAY,
    recommendations: MEDICAL_JSON_FIELD_TYPE.ARRAY,
    limitations: MEDICAL_JSON_FIELD_TYPE.ARRAY,
  },
};

export function stripMarkdownFences(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesType(value: unknown, expected: MedicalJsonFieldType): boolean {
  if (expected === MEDICAL_JSON_FIELD_TYPE.NULL) return value === null;
  if (expected === MEDICAL_JSON_FIELD_TYPE.ARRAY) return Array.isArray(value);
  if (expected === MEDICAL_JSON_FIELD_TYPE.OBJECT) return isRecord(value);
  return typeof value === expected;
}

export function validateMedicalJson(value: unknown, schema: MedicalJsonSchema = DEFAULT_MEDICAL_JSON_SCHEMA): MedicalJsonResult {
  if (!isRecord(value)) {
    return { ok: false, data: null, errors: [{ code: MEDICAL_JSON_ERROR_CODE.NOT_OBJECT, path: '$', message: 'Medical JSON must be an object' }] };
  }
  const errors: MedicalJsonValidationError[] = [];
  for (const field of schema.requiredFields) {
    if (!(field in value) || value[field] === undefined) errors.push({ code: MEDICAL_JSON_ERROR_CODE.MISSING_FIELD, path: `$.${field}`, message: `Required field '${field}' is missing` });
  }
  for (const field of schema.arrayFields) {
    if (field in value && !Array.isArray(value[field])) errors.push({ code: MEDICAL_JSON_ERROR_CODE.INVALID_TYPE, path: `$.${field}`, message: `Field '${field}' must be an array` });
  }
  for (const [field, expected] of Object.entries(schema.fieldTypes ?? {})) {
    if (field in value && !matchesType(value[field], expected)) errors.push({ code: MEDICAL_JSON_ERROR_CODE.INVALID_TYPE, path: `$.${field}`, message: `Field '${field}' has an invalid type` });
  }
  return errors.length > 0 ? { ok: false, data: null, errors } : { ok: true, data: value, errors: [] };
}

export function parseMedicalJson(input: unknown, schema: MedicalJsonSchema = DEFAULT_MEDICAL_JSON_SCHEMA): MedicalJsonResult {
  let value: unknown;
  try {
    value = typeof input === 'string' ? JSON.parse(stripMarkdownFences(input)) as unknown : input;
  } catch {
    return { ok: false, data: null, errors: [{ code: MEDICAL_JSON_ERROR_CODE.INVALID_JSON, path: '$', message: 'Input is not valid JSON' }] };
  }
  return validateMedicalJson(value, schema);
}
