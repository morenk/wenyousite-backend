import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const outputDir = resolve(__dirname, 'fixtures');

const fixtures = [
  { name: 'small.png', width: 256, height: 256, color: '#8f6d85' },
  { name: 'medium.png', width: 1024, height: 1024, color: '#5f7f8d' },
  { name: 'large.png', width: 1536, height: 1536, color: '#8d765f' },
];

async function main() {
  await mkdir(outputDir, { recursive: true });
  for (const fixture of fixtures) {
    const target = resolve(outputDir, fixture.name);
    const result = await sharp({
      create: {
        width: fixture.width,
        height: fixture.height,
        channels: 4,
        background: fixture.color,
      },
    })
      .png({ compressionLevel: 0, adaptiveFiltering: false })
      .toFile(target);
    console.log(`${fixture.name}\t${result.width}x${result.height}\t${result.size} bytes`);
  }
}

void main();
