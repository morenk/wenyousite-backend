
import { encodeAnimationPreviews } from './media-animation-preview-encoder';
import { PREVIEW_MAX_INPUT_BYTES } from './media-animation-preview-policy';

async function main() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > PREVIEW_MAX_INPUT_BYTES) throw new Error('input_limit');
    chunks.push(buffer);
  }
  const variants = await encodeAnimationPreviews(Buffer.concat(chunks));
  const header = Buffer.from(JSON.stringify(variants.map(({ edge, width, height, body }) =>
    ({ edge, width, height, bytes: body.length }))));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  process.stdout.write(Buffer.concat([length, header, ...variants.map((variant) => variant.body)]));
}
void main().catch(() => { process.exitCode = 1; });
