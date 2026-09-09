import sharp from 'sharp';
import { crc32, deflateSync } from 'node:zlib';

// 重复真实编码的帧块，避免为累计像素边界分配上亿像素的原始图像。
export async function gif(width: number, height: number, frames: number, delay = 100) {
  const frame = await sharp({
    create: { width, height, channels: 3, background: '#336699' },
  })
    .gif({ delay })
    .toBuffer();
  let frameStart = 13 + (frame[10] & 0x80 ? 3 * 2 ** ((frame[10] & 7) + 1) : 0);
  // 应用扩展保留一份；图形控制扩展（含时长）随图像帧重复。
  while (frame[frameStart] === 0x21 && frame[frameStart + 1] !== 0xf9) {
    frameStart += 2;
    while (frame[frameStart] !== 0) frameStart += frame[frameStart] + 1;
    frameStart++;
  }
  return Buffer.concat([
    frame.subarray(0, frameStart),
    ...Array<Buffer>(frames).fill(frame.subarray(frameStart, -1)),
    Buffer.from([0x3b]),
  ]);
}

export function pngChunk(type: string, data: Buffer) {
  const label = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}

/** 标准双帧 APNG：acTL / fcTL / IDAT / fcTL / fdAT。 */
export function apng(frames = 2, defaultImageExcluded = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4);
  header.writeUInt32BE(4, 4);
  header[8] = 8;
  header[9] = 6;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(frames);
  const control = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence);
    data.writeUInt32BE(4, 4);
    data.writeUInt32BE(4, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return data;
  };
  const pixels = (value: number) =>
    deflateSync(
      Buffer.concat(
        Array<Buffer>(4).fill(Buffer.concat([Buffer.from([0]), Buffer.alloc(16, value)])),
      ),
    );
  const sequence = defaultImageExcluded
    ? [
        pngChunk('IDAT', pixels(255)),
        pngChunk('fcTL', control(0)),
        pngChunk('fdAT', Buffer.concat([Buffer.from([0, 0, 0, 1]), pixels(0)])),
      ]
    : [
        pngChunk('fcTL', control(0)),
        pngChunk('IDAT', pixels(255)),
        ...(frames > 1
          ? [
              pngChunk('fcTL', control(1)),
              pngChunk('fdAT', Buffer.concat([Buffer.from([0, 0, 0, 2]), pixels(0)])),
            ]
          : []),
      ];
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('acTL', animation),
    ...sequence,
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function distinctFrames(format: 'gif' | 'webp') {
  const pixels = Buffer.concat([Buffer.alloc(40 * 30 * 3, 0), Buffer.alloc(40 * 30 * 3, 255)]);
  const image = sharp(pixels, { raw: { width: 40, height: 60, channels: 3, pageHeight: 30 } });
  return (
    format === 'gif'
      ? image.gif({ delay: [100, 200], loop: 2 })
      : image.webp({ delay: [100, 200], loop: 2 })
  ).toBuffer();
}
