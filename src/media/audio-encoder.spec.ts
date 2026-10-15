import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { encodeAudio, inspectAudio } from './audio-encoder';
import { verifyAudioRuntime } from './audio-runtime.service';

const runtime = verifyAudioRuntime(resolve('.cache/audio-runtime'));
const directory = mkdtempSync(join(tmpdir(), 'wenyou-audio-test-'));
function fixture(name: string, codec: string, extra: string[] = []) {
  const file = join(directory, name);
  execFileSync(
    runtime.ffmpeg,
    [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.3',
      '-c:a',
      codec,
      ...extra,
      file,
    ],
    { timeout: 10000, env: {} },
  );
  return readFileSync(file);
}
afterAll(() => rmSync(directory, { recursive: true, force: true }));
describe('真实音频规范化', () => {
  it.each([
    ['test.mp3', 'libmp3lame', 'audio/mpeg'],
    ['test.m4a', 'aac', 'audio/mp4'],
    ['test.wav', 'pcm_s16le', 'audio/wav'],
    ['test.ogg', 'libopus', 'audio/ogg'],
    ['test.flac', 'flac', 'audio/flac'],
  ])('%s → MP3 单音轨', async (name, codec, mime) => {
    const result = await encodeAudio(fixture(name, codec), mime, runtime);
    expect(result.body.length).toBeGreaterThan(100);
    expect(result.durationMs).toBeGreaterThan(250);
    expect(result.durationMs).toBeLessThan(400);
    const output = join(directory, name + '.mp3');
    writeFileSync(output, result.body);
    const probe = JSON.parse(
      execFileSync(
        runtime.ffprobe,
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output],
        { encoding: 'utf8', timeout: 10000, env: {} },
      ),
    );
    expect(probe.streams).toHaveLength(1);
    expect(probe.streams[0].codec_name).toBe('mp3');
    expect(Number(probe.streams[0].bit_rate)).toBe(128000);
    expect(probe.format.tags).toBeUndefined();
  });
  it('允许附封面，规范副本只保留音轨', async () => {
    fixture('cover-source.mp3', 'libmp3lame');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
      .png()
      .toFile(join(directory, 'cover.png'));
    const input = join(directory, 'with-cover.mp3');
    execFileSync(
      runtime.ffmpeg,
      [
        '-v',
        'error',
        '-y',
        '-i',
        join(directory, 'cover-source.mp3'),
        '-i',
        join(directory, 'cover.png'),
        '-map',
        '0:a',
        '-map',
        '1:v',
        '-c',
        'copy',
        '-disposition:v',
        'attached_pic',
        '-metadata',
        'title=secret',
        input,
      ],
      { env: {}, timeout: 10000 },
    );
    const result = await encodeAudio(readFileSync(input), 'audio/mpeg', runtime);
    expect(result.durationMs).toBeGreaterThan(250);
    expect(result.body.includes(Buffer.from('secret'))).toBe(false);
  });
  it('拒绝伪造MIME、损坏文件、超过输入字节预算，并清理临时目录', async () => {
    const before = readdirSync(tmpdir())
      .filter((x) => x.startsWith('wenyou-audio-'))
      .sort();
    await expect(
      encodeAudio(fixture('wrong.wav', 'pcm_s16le'), 'audio/mpeg', runtime),
    ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
    await expect(encodeAudio(Buffer.from('invalid'), 'audio/mpeg', runtime)).rejects.toMatchObject({
      code: 'AUDIO_INVALID',
    });
    await expect(
      encodeAudio(Buffer.alloc(30 * 1024 * 1024 + 1), 'audio/mpeg', runtime),
    ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
    expect(
      readdirSync(tmpdir())
        .filter((x) => x.startsWith('wenyou-audio-'))
        .sort(),
    ).toEqual(before);
  });
  it('真实 MP4 活动视频与双音轨 M4A 均拒绝', async () => {
    const video=join(directory,'video.mp4');
    execFileSync(runtime.ffmpeg,['-v','error','-y','-f','lavfi','-i','sine=duration=0.2','-f','lavfi','-i','color=c=black:s=16x16:r=5:d=0.2','-map','0:a','-map','1:v','-c:a','aac','-c:v','mpeg4','-shortest',video],{env:{},timeout:10000});
    await expect(encodeAudio(readFileSync(video),'audio/mp4',runtime)).rejects.toMatchObject({code:'AUDIO_INVALID'});
    const multiple=join(directory,'multiple.m4a');
    execFileSync(runtime.ffmpeg,['-v','error','-y','-f','lavfi','-i','sine=duration=0.2','-f','lavfi','-i','sine=duration=0.2','-map','0:a','-map','1:a','-c:a','aac',multiple],{env:{},timeout:10000});
    await expect(encodeAudio(readFileSync(multiple),'audio/mp4',runtime)).rejects.toMatchObject({code:'AUDIO_INVALID'});
  });
  it('探测拒绝视频、多音轨和超长音轨', () => {
    const stream = { codec_type: 'audio', codec_name: 'mp3', channels: 2, duration: '1' };
    expect(() =>
      inspectAudio(
        { format: { format_name: 'mp3' }, streams: [stream, { codec_type: 'video' }] },
        'audio/mpeg',
      ),
    ).toThrow('AUDIO_INVALID');
    expect(() =>
      inspectAudio({ format: { format_name: 'mp3' }, streams: [stream, stream] }, 'audio/mpeg'),
    ).toThrow('AUDIO_INVALID');
    expect(() =>
      inspectAudio(
        { format: { format_name: 'mp3' }, streams: [{ ...stream, duration: '600.1' }] },
        'audio/mpeg',
      ),
    ).toThrow('AUDIO_TOO_LONG');
  });
  it('真实接近10分钟样本通过，超过10分钟被拒绝', async () => {
    for (const seconds of [599.5, 600.1]) {
      const file = join(directory, 'boundary-' + seconds + '.flac');
      execFileSync(
        runtime.ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=8000:cl=mono',
          '-t',
          String(seconds),
          '-c:a',
          'flac',
          file,
        ],
        { env: {}, timeout: 10000 },
      );
      if (seconds < 600)
        expect((await encodeAudio(readFileSync(file), 'audio/flac', runtime)).durationMs).toBe(
          599500,
        );
      else
        await expect(encodeAudio(readFileSync(file), 'audio/flac', runtime)).rejects.toMatchObject({
          code: 'AUDIO_TOO_LONG',
        });
    }
  }, 30000);
  it('不允许播放列表或网络协议输入', async () => {
    await expect(
      encodeAudio(Buffer.from('#EXTM3U\nhttps://127.0.0.1/secret\n'), 'audio/mpeg', runtime),
    ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
  });
});
