
import sharp from 'sharp';
import { inspectMediaImage } from './media-image-inspection';
import { inspectImage } from '../common/image-inspection';
import {
  EncodedPreview, PREVIEW_EDGES, PREVIEW_MAX_INPUT_BYTES, PREVIEW_MAX_PIXELS, PREVIEW_QUALITY,
} from './media-animation-preview-policy';

/** 仅在可杀死的编码子进程运行；调用者不得在 HTTP 进程执行全帧解码。 */
export async function encodeAnimationPreviews(source: Buffer): Promise<EncodedPreview[]> {
  if (source.length > PREVIEW_MAX_INPUT_BYTES) return [];
  const input = await inspectMediaImage(source);
  if (!input.isGif || input.frameCount < 2 || input.totalFramePixels > PREVIEW_MAX_PIXELS ||
    input.frameDelaysMs.length !== input.frameCount) return [];
  sharp.concurrency(1);
  sharp.cache(false);
  const outputs: EncodedPreview[] = [];
  let previousSize = '';
  for (const edge of PREVIEW_EDGES) {
    const scale = Math.min(1, edge / Math.max(input.frameWidth, input.frameHeight));
    const size = Math.round(input.frameWidth * scale) + 'x' + Math.round(input.frameHeight * scale);
    if (size === previousSize) continue;
    previousSize = size;
    const body = await sharp(source, { animated: true, limitInputPixels: PREVIEW_MAX_PIXELS })
      .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY, alphaQuality: 100, effort: 4,
        loop: input.loop, delay: input.frameDelaysMs })
      .toBuffer();
    if (body.length >= source.length) continue;
    const output = await inspectImage(body, { limitInputPixels: PREVIEW_MAX_PIXELS });
    // 保守拒绝时间线或循环变化；不能以更小体积掩盖抽帧、截短或静态化。
    if (output.format !== 'webp' || output.frameCount !== input.frameCount ||
      JSON.stringify(output.frameDelaysMs) !== JSON.stringify(input.frameDelaysMs) ||
      (output.loop ?? 1) !== (input.loop ?? 1) ||
      output.frameWidth > input.frameWidth || output.frameHeight > input.frameHeight ||
      Math.max(output.frameWidth, output.frameHeight) > edge) continue;
    outputs.push({ edge, width: output.frameWidth, height: output.frameHeight, body });
  }
  return outputs;
}
