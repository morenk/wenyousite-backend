import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { encodeAnimationDisplay } from '../src/media/media-animation-display-encoder';

async function main() {
  const width = 24; const height = 16;
  const pixels = Buffer.alloc(width * height * 3 * 3);
  for (let frame = 0; frame < 3; frame++) {
    for (let pixel = 0; pixel < width * height; pixel++) pixels[(frame * width * height + pixel) * 3 + (frame < 2 ? 0 : 2)] = 255;
  }
  const source = await sharp(pixels, { raw: { width, height: height * 3, channels: 3, pageHeight: height } })
    .gif({ delay: [300, 600, 600], loop: 2, keepDuplicateFrames: true }).toBuffer();
  const encoded = await encodeAnimationDisplay(source);
  const directory = join(__dirname, '../contracts/fixtures/media-display');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'duplicate-frames.gif'), source);
  writeFileSync(join(directory, 'duplicate-frames.webp'), encoded.body);
  const { body, ...metadata } = encoded;
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1,
    source: { file: 'duplicate-frames.gif', bytes: source.length, sha256: createHash('sha256').update(source).digest('hex') },
    display: { file: 'duplicate-frames.webp', ...metadata, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') },
    expected: { colors: ['red', 'red', 'blue'], frameDelaysMs: [300, 600, 600], loopCount: 2, finalColor: 'blue' },
  }, null, 2) + '\n');
}
void main().catch(() => process.exit(1));
