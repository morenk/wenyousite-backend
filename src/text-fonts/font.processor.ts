import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { FontProcessingService } from './font-processing.service';
import { FontProcessingFailure } from './font-sandbox.service';

@Processor('text-font', { concurrency: 1, lockDuration: 60000, autorun: false })
export class FontProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly processing: FontProcessingService,
    @InjectQueue('text-font') private readonly queue: Queue,
  ) {
    super();
  }
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    void this.worker.run().catch(() => {
      new Logger('FontProcessor').error('font_worker_loop_stopped');
      process.exitCode = 1;
      process.kill(process.pid, 'SIGTERM');
    });
  }
  async process(job: Job<{ jobId: string; attempt: number }>): Promise<void> {
    if (
      !/^tfj_[a-f0-9]{32}$/u.test(job.data.jobId) ||
      !Number.isSafeInteger(job.data.attempt) ||
      job.data.attempt < 1
    )
      throw new UnrecoverableError('invalid-font-job');
    try {
      await this.processing.process(job.data.jobId, job.data.attempt);
    } catch (error) {
      const code = error instanceof FontProcessingFailure ? error.code : 'processing-failed';
      if (['invalid-font', 'unsupported-font', 'rights-required', 'resource-limit'].includes(code))
        throw new UnrecoverableError(code);
      throw new Error(code);
    }
  }
}
