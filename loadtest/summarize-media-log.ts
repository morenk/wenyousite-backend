import { createInterface } from 'node:readline';

const fields = [
  'queueWaitMs',
  'downloadMs',
  'inspectMs',
  'normalizeMs',
  'variantsMs',
  'uploadMs',
  'databaseMs',
  'cleanupMs',
] as const;
const samples = new Map<string, number[]>(fields.map((field) => [field, []]));

async function main() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.includes('media_processing_complete')) continue;
    for (const field of fields) {
      const value = line.match(new RegExp(`(?:^|\\s)${field}=(\\d+)`))?.[1];
      if (value) samples.get(field)!.push(Number(value));
    }
  }

  const percentile = (values: number[], ratio: number) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  };

  console.log('stage\tsamples\tp50_ms\tp95_ms\tp99_ms\tmax_ms');
  for (const field of fields) {
    const values = samples.get(field)!;
    console.log([
      field,
      values.length,
      percentile(values, 0.5) ?? '-',
      percentile(values, 0.95) ?? '-',
      percentile(values, 0.99) ?? '-',
      values.length ? Math.max(...values) : '-',
    ].join('\t'));
  }
}

void main();
