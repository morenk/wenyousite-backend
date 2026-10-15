import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_MS, AUDIO_FAILURE_CODES } from './audio-policy';
import { AudioRuntimePaths } from './audio-runtime.service';

const execute = promisify(execFile);
const OUTPUT_MAX_BYTES = 10 * 1024 * 1024;
const FORMATS = 'mp3,mov,wav,ogg,flac';
export class AudioEncodingError extends Error {
  constructor(readonly code: (typeof AUDIO_FAILURE_CODES)[number]) {
    super(code);
  }
}
type Probe = {
  format?: { format_name?: string; duration?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    channels?: number;
    duration?: string;
    disposition?: { attached_pic?: number };
  }[];
};

async function run(binary: string, args: string[], timeout: number) {
  const result = await execute(binary, args, {
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 256 * 1024,
    env: {},
    windowsHide: true,
  });
  return result.stdout;
}
async function probe(path: string, binary: string): Promise<Probe> {
  return JSON.parse(
    await run(
      binary,
      [
        '-v',
        'error',
        '-max_alloc',
        '67108864',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        FORMATS,
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,channels,duration:stream_disposition=attached_pic',
        '-of',
        'json',
        path,
      ],
      10_000,
    ),
  ) as Probe;
}
export function inspectAudio(
  value: Probe,
  contentType: string,
): { durationMs: number; channels: number } {
  const streams = value.streams ?? [];
  const audio = streams.filter((s) => s.codec_type === 'audio');
  if (
    audio.length !== 1 ||
    streams.some(
      (s) =>
        s.codec_type !== 'audio' &&
        !(s.codec_type === 'video' && s.disposition?.attached_pic === 1),
    )
  )
    throw new AudioEncodingError('AUDIO_INVALID');
  const stream = audio[0];
  const formats = new Set((value.format?.format_name ?? '').split(','));
  const allowed =
    contentType === 'audio/mpeg'
      ? formats.has('mp3') && stream.codec_name === 'mp3'
      : contentType === 'audio/mp4'
        ? formats.has('mov') && ['aac', 'alac'].includes(stream.codec_name ?? '')
        : contentType === 'audio/wav'
          ? formats.has('wav') && /^pcm_/.test(stream.codec_name ?? '')
          : contentType === 'audio/ogg'
            ? formats.has('ogg') && ['opus', 'vorbis', 'flac'].includes(stream.codec_name ?? '')
            : contentType === 'audio/flac' && formats.has('flac') && stream.codec_name === 'flac';
  const duration = Number(stream.duration ?? value.format?.duration);
  if (
    !allowed ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isInteger(stream.channels) ||
    stream.channels! < 1 ||
    stream.channels! > 8
  )
    throw new AudioEncodingError('AUDIO_INVALID');
  if (duration * 1000 > AUDIO_MAX_DURATION_MS) throw new AudioEncodingError('AUDIO_TOO_LONG');
  return {
    durationMs: Math.max(1, Math.round(duration * 1000)),
    channels: Math.min(stream.channels!, 2),
  };
}

/** 文件、进程和输出都有界；只映射单音轨，附图/字幕/标签不会进入公开副本。 */
export async function encodeAudio(source: Buffer, contentType: string, runtime: AudioRuntimePaths) {
  if (!source.length || source.length > AUDIO_MAX_BYTES)
    throw new AudioEncodingError('AUDIO_INVALID');
  const directory = await mkdtemp(join(tmpdir(), 'wenyou-audio-'));
  try {
    const input = join(directory, 'input');
    const output = join(directory, 'playback.mp3');
    await writeFile(input, source, { mode: 0o600 });
    let metadata;
    try {
      metadata = inspectAudio(await probe(input, runtime.ffprobe), contentType);
    } catch (e) {
      if (e instanceof AudioEncodingError) throw e;
      throw new AudioEncodingError('AUDIO_INVALID');
    }
    await run(
      runtime.ffmpeg,
      [
        '-hide_banner',
        '-v',
        'error',
        '-nostdin',
        '-y',
        '-max_alloc',
        '67108864',
        '-threads',
        '1',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        FORMATS,
        '-i',
        input,
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-ac',
        String(metadata.channels),
        '-ar',
        '48000',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-threads',
        '1',
        '-t',
        '600.1',
        '-fs',
        String(OUTPUT_MAX_BYTES),
        '-id3v2_version',
        '0',
        '-write_id3v1',
        '0',
        output,
      ],
      90_000,
    );
    const bytes = (await stat(output)).size;
    if (bytes <= 0 || bytes >= OUTPUT_MAX_BYTES)
      throw new AudioEncodingError('AUDIO_PROCESSING_FAILED');
    const checked = await probe(output, runtime.ffprobe);
    const outputStream = checked.streams ?? [];
    const outputDuration = Number(checked.format?.duration);
    if (
      outputStream.length !== 1 ||
      outputStream[0].codec_name !== 'mp3' ||
      !Number.isFinite(outputDuration) ||
      Math.abs(outputDuration * 1000 - metadata.durationMs) > 1000
    )
      throw new AudioEncodingError('AUDIO_PROCESSING_FAILED');
    return { body: await readFile(output), durationMs: metadata.durationMs };
  } catch (error) {
    if (error instanceof AudioEncodingError) throw error;
    throw new AudioEncodingError('AUDIO_PROCESSING_FAILED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
