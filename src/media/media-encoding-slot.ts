let previousJob = Promise.resolve();

/** 完整展示与可选预览共用单槽；超时等待者不能释放仍在工作的前序任务。 */
export async function withMediaEncodingSlot<T>(deadline: number, work: () => Promise<T>): Promise<T> {
  const before = previousJob;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  previousJob = before.then(() => gate);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const acquired = await Promise.race([
      before.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())); }),
    ]);
    if (!acquired) throw new Error('MEDIA_ENCODING_SLOT_TIMEOUT');
    if (timer) clearTimeout(timer);
    return await work();
  } finally {
    if (timer) clearTimeout(timer);
    release();
  }
}
