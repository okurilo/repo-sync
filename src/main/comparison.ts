import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';

// Display-only combinations: 1 = CRLF/LF, 2 = edge indentation, 4 = blank lines, 8 = collapse whitespace (compare-projects).
export function matchingComparisonFilters(before: Buffer, after: Buffer): number[] {
  if (before.includes(0) || after.includes(0) || !isUtf8(before) || !isUtf8(after)) return [];
  const matches: number[] = collapsed(before) === collapsed(after) ? [8] : [];
  if (normalized(before, 7) !== normalized(after, 7)) return matches;
  matches.push(7);
  for (let options = 1; options < 7; options++) if (normalized(before, options) === normalized(after, options)) matches.push(options);
  return matches;
}
function normalized(bytes: Buffer, options: number): string {
  const hash = createHash('sha256');
  const space = (byte: number | undefined): boolean => byte === 32 || byte === 9;
  for (let start = 0; start < bytes.length;) {
    const newline = bytes.indexOf(10, start);
    const end = newline < 0 ? bytes.length : newline;
    const contentEnd = newline >= 0 && bytes[end - 1] === 13 ? end - 1 : end;
    let first = start; let last = contentEnd;
    if (options & 2) {
      while (first < last && space(bytes[first])) first++;
      while (last > first && space(bytes[last - 1])) last--;
    }
    let blank = true;
    for (let index = first; index < last; index++) if (!space(bytes[index])) { blank = false; break; }
    if (!(options & 4) || !blank) {
      hash.update(bytes.subarray(first, last));
      if (newline >= 0) {
        if (options & 1) hash.update('\n');
        else hash.update(bytes.subarray(contentEnd, end + 1));
      }
    }
    start = end + 1;
  }
  return hash.digest('hex');
}

function collapsed(bytes: Buffer): string {
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let started = false; let pendingSpace = false;
  const consume = (text: string): void => {
    for (const match of text.matchAll(/\s+|\S+/gu)) {
      if (/^\s/u.test(match[0])) pendingSpace = true;
      else {
        if (started && pendingSpace) hash.update(' ');
        hash.update(match[0]); started = true; pendingSpace = false;
      }
    }
  };
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) consume(decoder.decode(bytes.subarray(offset, offset + 64 * 1024), { stream: true }));
  consume(decoder.decode());
  return hash.digest('hex');
}
