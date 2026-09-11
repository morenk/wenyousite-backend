import { encodeAnimationDisplay, encodeStickerDisplayFrames } from './media-animation-display-encoder';
import { DISPLAY_MAX_INPUT_BYTES, DISPLAY_ENCODING_MS } from './media-animation-display-policy';

async function main() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > DISPLAY_MAX_INPUT_BYTES) throw new Error('DISPLAY_INPUT_LIMIT');
    chunks.push(buffer);
  }
  const source = Buffer.concat(chunks);
  const { body, ...descriptor } = process.argv.includes('--sticker')
    ? await encodeStickerDisplayFrames(source, { maxEdge: 512, quality: 80, maxOutputBytes: 4 * 1024 * 1024, maxTotalPixels: 120_000_000 })
    : await encodeAnimationDisplay(source);
  const header = Buffer.from(JSON.stringify({ ...descriptor, bytes: body.length }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  process.stdout.write(Buffer.concat([length, header, body]));
}
const watchdog = setTimeout(() => process.exit(1), DISPLAY_ENCODING_MS);
void main().then(() => clearTimeout(watchdog)).catch((error: unknown) => {
  const code = error instanceof Error && /^(DISPLAY|IMAGE|GIF|ANIMATED_IMAGE)_[A-Z_]{1,64}$/.test(error.message)
    ? error.message : 'DISPLAY_ENCODING_FAILED';
  process.stderr.write(code + '\n', () => process.exit(1));
});
