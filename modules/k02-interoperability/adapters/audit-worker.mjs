import { createHash } from 'node:crypto';

let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk;
  if (Buffer.byteLength(raw) > 750000) process.exit(2);
}
try {
  const input = JSON.parse(raw);
  if (!input || typeof input.transcript !== 'string' || !Array.isArray(input.candidates)) process.exit(3);
  const accepted = [], rejected = [];
  input.candidates.forEach((c, i) => {
    if (Number.isSafeInteger(c.start) && Number.isSafeInteger(c.end)
        && c.start >= 0 && c.end <= input.transcript.length && c.start < c.end
        && input.transcript.slice(c.start, c.end) === c.quote) {
      accepted.push({ action: c.action, quote: c.quote, start: c.start, end: c.end });
    } else rejected.push({ candidateIndex: i, reason: 'SOURCE_SPAN_MISMATCH' });
  });
  const transcriptSha256 = createHash('sha256').update(input.transcript).digest('hex');
  process.stdout.write(JSON.stringify({ status: 'REVIEW_REQUIRED', accepted, rejected, transcriptSha256 }));
} catch { process.exit(4); }
