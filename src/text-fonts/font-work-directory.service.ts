import { Injectable } from '@nestjs/common';
import { lstat, mkdir, open, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FontStorageService } from './font-storage.service';

type Ownership = {
  version: 1;
  kind: 'build' | 'import';
  jobId: string;
  attempt: number;
  claim: string;
  uid: number;
  pid: number;
  processStart: string;
  device: number;
  inode: number;
};
export type FontWorkTicket = { root: string; ownership: Ownership };
async function processIdentity(
  pid: number,
): Promise<{ start: string; uid: number; alive: boolean } | null> {
  try {
    const stat = await lstat(`/proc/${pid}`);
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    if (!/^\d+$/u.test(fields[19] ?? '')) throw new Error('font_process_identity');
    return { start: fields[19], uid: stat.uid, alive: !['Z', 'X'].includes(fields[0]) };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
      return null;
    throw new Error('font_process_identity');
  }
}

@Injectable()
export class FontWorkDirectoryService {
  constructor(private readonly storage: FontStorageService) {}

  async create(
    jobId: string,
    attempt: number,
    claim: string,
    kind: 'build' | 'import' = 'build',
  ): Promise<FontWorkTicket> {
    if (!/^tfj_[a-f0-9]{32}$/u.test(jobId) || !/^[a-f0-9]{32}$/u.test(claim))
      throw new Error('font_work_identity');
    const root = join(await this.storage.directory('work'), `${jobId}-${claim}`);
    await mkdir(root, { mode: 0o700 });
    const stat = await lstat(root);
    try {
      const ownerProcess = await processIdentity(process.pid);
      if (!ownerProcess || !ownerProcess.alive) throw new Error('font_process_identity');
      const ownership: Ownership = {
        version: 1,
        kind,
        jobId,
        attempt,
        claim,
        uid: stat.uid,
        pid: process.pid,
        processStart: ownerProcess.start,
        device: stat.dev,
        inode: stat.ino,
      };
      const file = await open(join(root, 'ownership.json'), 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(ownership));
        await file.sync();
      } finally {
        await file.close();
      }
      return { root, ownership };
    } catch {
      const current = await lstat(root);
      if (
        current.dev === stat.dev &&
        current.ino === stat.ino &&
        current.uid === stat.uid &&
        !current.isSymbolicLink()
      )
        await rm(root, { recursive: true });
      throw new Error('font_work_registration');
    }
  }

  private async validate(ticket: FontWorkTicket) {
    const { root, ownership: record } = ticket;
    const work = await this.storage.directory('work');
    if (
      root !== join(work, `${record.jobId}-${record.claim}`) ||
      record.version !== 1 ||
      !['build', 'import'].includes(record.kind) ||
      !/^tfj_[a-f0-9]{32}$/u.test(record.jobId) ||
      !/^[a-f0-9]{32}$/u.test(record.claim) ||
      record.uid !== process.getuid?.() ||
      !Number.isSafeInteger(record.pid) ||
      record.pid < 1 ||
      !Number.isSafeInteger(record.attempt) ||
      record.attempt < 1
    )
      throw new Error('font_work_identity');
    const stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== record.uid ||
      stat.dev !== record.device ||
      stat.ino !== record.inode ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error('font_work_identity');
    const file = await lstat(join(root, 'ownership.json'));
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.uid !== record.uid ||
      file.nlink !== 1 ||
      file.size > 4096 ||
      (file.mode & 0o077) !== 0
    )
      throw new Error('font_work_identity');
    const current: unknown = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
    if (JSON.stringify(current) !== JSON.stringify(record)) throw new Error('font_work_identity');
  }

  async abandoned(): Promise<FontWorkTicket[]> {
    const work = await this.storage.directory('work');
    const tickets: FontWorkTicket[] = [];
    for (const name of await readdir(work)) {
      if (!/^tfj_[a-f0-9]{32}-[a-f0-9]{32}$/u.test(name)) continue;
      const root = join(work, name);
      try {
        const file = await lstat(join(root, 'ownership.json'));
        if (!file.isFile() || file.isSymbolicLink() || file.size > 4096) continue;
        const ownership = JSON.parse(
          await readFile(join(root, 'ownership.json'), 'utf8'),
        ) as Ownership;
        const ticket = { root, ownership };
        await this.validate(ticket);
        const owner = await processIdentity(ownership.pid);
        if (
          !owner ||
          !owner.alive ||
          owner.start !== ownership.processStart ||
          owner.uid !== ownership.uid
        )
          tickets.push(ticket);
      } catch {
        /* 身份不足或仍在创建的目录保留，不猜测其他任务归属。 */
      }
    }
    return tickets;
  }

  async remove(ticket: FontWorkTicket, ownActiveJob = false): Promise<void> {
    await this.validate(ticket);
    const owner = await processIdentity(ticket.ownership.pid);
    if (
      owner?.alive &&
      owner.start === ticket.ownership.processStart &&
      owner.uid === ticket.ownership.uid &&
      !(ownActiveJob && ticket.ownership.pid === process.pid)
    )
      throw new Error('font_work_still_active');
    await rm(ticket.root, { recursive: true });
  }
}
