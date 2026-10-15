import { Injectable, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, lstatSync, accessSync, constants } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AUDIO_UPLOAD_POLICY } from './audio-policy';

export interface AudioRuntimePaths {
  ffmpeg: string;
  ffprobe: string;
}
interface RuntimeLock {
  platform: string;
  arch: string;
  ffmpegVersion: string;
  files: Record<string, string>;
}

/** 每个进程启动时检查只读、固定哈希的运行依赖，不搜索 PATH、不在线下载。 */
export function verifyAudioRuntime(
  directory: string,
  lockPath = resolve('audio-runtime.lock.json'),
): AudioRuntimePaths {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as RuntimeLock;
  if (process.platform !== lock.platform || process.arch !== lock.arch)
    throw new Error('AUDIO_RUNTIME_PLATFORM');
  const root = realpathSync(directory);
  for (const [relative, hash] of Object.entries(lock.files)) {
    const file = join(root, relative);
    if (
      relative.startsWith('/') ||
      relative.includes('..') ||
      !lstatSync(file).isFile() ||
      !realpathSync(file).startsWith(root + sep) ||
      createHash('sha256').update(readFileSync(file)).digest('hex') !== hash
    )
      throw new Error('AUDIO_RUNTIME_INTEGRITY');
  }
  const paths = { ffmpeg: join(root, 'bin/ffmpeg'), ffprobe: join(root, 'bin/ffprobe') };
  for (const path of Object.values(paths)) {
    accessSync(path, constants.X_OK);
    const text = execFileSync(path, ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: {},
    });
    if (
      !text.split('\n')[0].includes(lock.ffmpegVersion) ||
      text.includes('--enable-nonfree') ||
      text.includes('--enable-gpl')
    )
      throw new Error('AUDIO_RUNTIME_VERSION');
  }
  const encoders = execFileSync(paths.ffmpeg, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 256 * 1024,
    env: {},
  });
  if (!encoders.includes('libmp3lame')) throw new Error('AUDIO_RUNTIME_CODEC');
  const decoders = execFileSync(paths.ffmpeg, ['-hide_banner', '-decoders'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 256 * 1024,
    env: {},
  });
  for (const codec of ['mp3float', 'aac', 'alac', 'pcm_s16le', 'opus', 'vorbis', 'flac']) {
    if (!new RegExp('\\s' + codec + '\\s').test(decoders)) throw new Error('AUDIO_RUNTIME_CODEC');
  }
  return paths;
}

@Injectable()
export class AudioRuntimeService {
  private readonly paths: AudioRuntimePaths | null;
  constructor(config: ConfigService) {
    this.paths = null;
    if (config.get<boolean>('audio.enabled') === true) {
      try {
        this.paths = verifyAudioRuntime(
          config.get<string>('audio.runtimeDirectory') ?? resolve('tools/audio-runtime'),
        );
      } catch {
        /* 无运行依赖时显式关闭能力和签发，不暴露文件系统诊断。 */
      }
    }
  }
  capability() {
    return this.paths
      ? { ...AUDIO_UPLOAD_POLICY, contentTypes: [...AUDIO_UPLOAD_POLICY.contentTypes] }
      : undefined;
  }
  requireReady(): AudioRuntimePaths {
    if (!this.paths) throw new ServiceUnavailableException('音频上传暂不可用');
    return this.paths;
  }
}

@Module({ providers: [AudioRuntimeService], exports: [AudioRuntimeService] })
export class AudioRuntimeModule {}
