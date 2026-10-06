import type { Finding, RecordData } from '../shared/types';
import { decode } from './transport';

export interface PrivateFinding { public: Finding; value: string; offset: number; payloadLine?: number }
interface Rule { pattern: RegExp; reason: string; severity: 'warning' | 'block'; replacement: string; group?: number }
const rules: Rule[] = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, reason: 'Возможный закрытый ключ', severity: 'block', replacement: 'REPOSYNC_REDACTED' },
  { pattern: /(?:password|secret|token|api[_-]?key|accessToken|refreshToken|clientSecret|authorization)\s*["']?\s*[:=]\s*["']?([^\s"'`,;}{]{4,})/gi, group: 1, reason: 'Возможный пароль или токен', severity: 'block', replacement: 'REPOSYNC_REDACTED' },
  { pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,})\b/g, reason: 'Возможный ключ доступа к API', severity: 'block', replacement: 'REPOSYNC_REDACTED' },
  { pattern: /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, reason: 'Возможный адрес электронной почты', severity: 'warning', replacement: 'test@example.invalid' },
  { pattern: /(?<!\w)(?:\+\d[\d ()-]{8,}\d|[78]\s*\(?\d{3}\)?[ -]?\d{3}[ -]?\d{2}[ -]?\d{2})(?!\w)/g, reason: 'Возможный номер телефона', severity: 'warning', replacement: '+70000000000' },
  { pattern: /[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ][а-яё]{2,}/g, reason: 'Возможное ФИО на русском языке', severity: 'warning', replacement: 'Тестовый Пользователь' },
  { pattern: /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g, reason: 'Возможное имя на английском языке', severity: 'warning', replacement: 'Test User' },
  { pattern: /(?:firstName|lastName|middleName|fullName|fio|employeeName|customerName|personName)\s*["']?\s*[:=]\s*["']([^"'\r\n]{2,80})["']/gi, group: 1, reason: 'Возможное имя в поле данных', severity: 'warning', replacement: 'Test User' },
];
export function findingLocation(record: RecordData, payloadLine: number, payload?: string): { line: number; before: boolean } {
  if (record.operation !== 'MODIFY') return { line: payloadLine, before: false };
  let old = 0; let next = 0;
  const lines = (payload ?? decode(record).toString('utf8')).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? ''; const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); continue; }
    if (!old && !next) continue;
    if (i + 1 === payloadLine) return { line: text.startsWith('-') ? old : next, before: text.startsWith('-') };
    if (text.startsWith('-')) old++; else if (text.startsWith('+')) next++; else if (text.startsWith(' ')) { old++; next++; }
  }
  return { line: payloadLine, before: false };
}
export function scan(records: RecordData[], local: boolean): PrivateFinding[] {
  const findings: PrivateFinding[] = [];
  for (const record of records) {
    if (record.operation === 'DELETE' || record.operation === 'RENAME') continue;
    const bytes = decode(record);
    const text = bytes.toString('utf8');
    const sensitiveFile = /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key)$/i.test(record.path);
    if (sensitiveFile) findings.push({ public: { id: `${findings.length}`, path: record.path, line: 1, preview: 'Имя файла с возможными данными доступа', context: { before: '', match: record.path, after: '', location: 'Проверка по имени или расширению файла: .env, .pem, .key' }, reason: 'Файл может содержать данные доступа', severity: 'block', replacement: '', canReplace: false }, value: '', offset: 0 });
    const firstFinding = findings.length;
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      for (const match of text.matchAll(rule.pattern)) {
        const value = match[rule.group ?? 0];
        if (!value || value === 'REPOSYNC_REDACTED' || value === 'test@example.invalid') continue;
        const offset = match.index + (rule.group ? match[0].lastIndexOf(value) : 0);
        const line = text.slice(0, offset).split('\n').length;
        const context = /(?:mock|mocks|fixtures|test-data|seed|demo)(?:\/|$)/i.test(record.path) ? ' · контекст тестовых данных' : '';
        findings.push({ public: { id: `${findings.length}`, path: record.path, line,
          preview: value.slice(0, 160).replace(/[^\r\n]/g, '•'), reason: rule.reason + context,
          severity: rule.severity, replacement: rule.replacement, canReplace: local && value.length > 0 }, value, offset });
        if (findings.length >= 10_000) throw new Error('Найдено 10 000 совпадений. Исключите часть файлов и повторите проверку.');
      }
    }
    const matches = findings.slice(firstFinding);
    const positions = new Set<number>();
    for (const finding of matches) for (let i = finding.offset; i < finding.offset + finding.value.length; i++) positions.add(i);
    const masked = (start: number, end: number): string => text.slice(start, end).split('').map((char, index) => positions.has(start + index) && char !== '\r' && char !== '\n' ? '•' : char).join('');
    for (const item of matches) {
      const payloadLine = item.public.line;
      const location = findingLocation(record, payloadLine, text);
      item.payloadLine = payloadLine; item.public.line = location.line;
      const start = Math.max(0, text.lastIndexOf('\n', item.offset - 1) + 1, item.offset - 160);
      const endOfLine = text.indexOf('\n', item.offset + item.value.length);
      const end = Math.min(endOfLine < 0 ? text.length : endOfLine, item.offset + item.value.length + 160);
      item.public.context = { before: masked(start, item.offset), match: masked(item.offset, item.offset + Math.min(item.value.length, 160)) + (item.value.length > 160 ? '…' : ''), after: masked(item.offset + item.value.length, end), location: `${record.operation === 'MODIFY' ? 'Изменения · ' : ''}${location.before ? 'строка до изменений:' : 'строка после изменений:'} ${location.line}` };
    }
  }
  return findings;
}
