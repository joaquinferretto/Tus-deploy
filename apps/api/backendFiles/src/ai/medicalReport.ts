import { DEFAULT_MEDICAL_JSON_SCHEMA, parseMedicalJson, type MedicalJsonSchema } from '../validation/medicalJson';

export const MEDICAL_REPORT_ROLE = { SYSTEM: 'system', USER: 'user' } as const;
export type MedicalReportRole = (typeof MEDICAL_REPORT_ROLE)[keyof typeof MEDICAL_REPORT_ROLE];

export interface MedicalChatMessage {
  role: MedicalReportRole;
  content: string;
}

export interface MedicalChatRequest {
  messages: MedicalChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface MedicalChatResponse {
  content: string;
}

export interface MedicalChatClient {
  chat(request: MedicalChatRequest): Promise<MedicalChatResponse>;
}

export interface MedicalReportInput {
  transcript: string;
  sourceContext?: string;
}

export interface MedicalReportPromptConfig {
  systemInstruction?: string;
  language?: string;
  outputInstruction?: string;
}

export interface MedicalReportOptions {
  prompt?: MedicalReportPromptConfig;
  schema?: MedicalJsonSchema;
  temperature?: number;
  signal?: AbortSignal;
}

export interface MedicalReportDocument {
  summary: string;
  findings: string[];
  impression: string | null;
  recommendations: string[];
  limitations: string[];
}

export interface MedicalReportResult {
  text: string;
  json: MedicalReportDocument;
  rawText: string;
  validJson: boolean;
}

const DEFAULT_SYSTEM_INSTRUCTION = 'You are a cautious medical documentation assistant. Do not diagnose, prescribe, or invent facts. Use only evidence present in the source. Clearly state uncertainty and limitations.';
const DEFAULT_OUTPUT_INSTRUCTION = 'Return only a JSON object with exactly these useful fields: summary (string), findings (array of strings), impression (string or null, never a definitive diagnosis), recommendations (array of strings), limitations (array of strings).';

function cleanText(value: string): string {
  return value.trim();
}

export function buildMedicalReportPrompt(input: MedicalReportInput, config: MedicalReportPromptConfig = {}): MedicalChatMessage[] {
  const language = config.language ?? 'English';
  const sourceContext = input.sourceContext ? `\nAdditional source context:\n${input.sourceContext}` : '';
  return [
    { role: MEDICAL_REPORT_ROLE.SYSTEM, content: `${config.systemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION}\nWrite in ${language}. ${config.outputInstruction ?? DEFAULT_OUTPUT_INSTRUCTION}` },
    { role: MEDICAL_REPORT_ROLE.USER, content: `Prepare a structured clinical report from this source transcription. Do not add facts that are absent, do not turn possibilities into diagnoses, and use null or an explicit limitation when evidence is insufficient.\n\nSource transcription:\n${input.transcript}${sourceContext}` },
  ];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(cleanText).filter(Boolean) : [];
}

function reportFromJson(value: Record<string, unknown>): MedicalReportDocument {
  return {
    summary: typeof value.summary === 'string' ? cleanText(value.summary) : '',
    findings: stringArray(value.findings),
    impression: typeof value.impression === 'string' ? cleanText(value.impression) : null,
    recommendations: stringArray(value.recommendations),
    limitations: stringArray(value.limitations),
  };
}

function fallbackReport(rawText: string): MedicalReportDocument {
  return {
    summary: cleanText(rawText),
    findings: [],
    impression: null,
    recommendations: [],
    limitations: ['The model response was not valid structured JSON; clinical interpretation requires review of the source and report format.'],
  };
}

export function formatMedicalReportText(report: MedicalReportDocument): string {
  const lines = [
    `SUMMARY\n${report.summary || 'Not provided.'}`,
    `FINDINGS\n${report.findings.length > 0 ? report.findings.map((item) => `- ${item}`).join('\n') : '- None documented.'}`,
    `IMPRESSION\n${report.impression ?? 'Not stated; no definitive diagnosis is provided.'}`,
    `RECOMMENDATIONS\n${report.recommendations.length > 0 ? report.recommendations.map((item) => `- ${item}`).join('\n') : '- None documented.'}`,
    `LIMITATIONS\n${report.limitations.length > 0 ? report.limitations.map((item) => `- ${item}`).join('\n') : '- None documented.'}`,
  ];
  return lines.join('\n\n');
}

export async function generateMedicalReport(client: MedicalChatClient, input: MedicalReportInput, options: MedicalReportOptions = {}): Promise<MedicalReportResult> {
  const response = await client.chat({ messages: buildMedicalReportPrompt(input, options.prompt), temperature: options.temperature ?? 0.2, signal: options.signal });
  const rawText = cleanText(response.content);
  const parsed = parseMedicalJson(rawText, options.schema ?? DEFAULT_MEDICAL_JSON_SCHEMA);
  const json = parsed.ok ? reportFromJson(parsed.data) : fallbackReport(rawText);
  return { text: formatMedicalReportText(json), json, rawText, validJson: parsed.ok };
}
