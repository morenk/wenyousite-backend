/** 分页元数据 */
export interface PaginationMeta {
  /** 本页最后一条记录的 ID，用作下一页的 cursor 参数 */
  cursor: string | null;
  /** 是否有更多页 */
  hasMore: boolean;
}

/** 分页结果：TransformInterceptor 自动将 items 提取到 data，pagination 提取到 meta */
export class PaginatedResult<T> {
  constructor(
    readonly items: T[],
    readonly pagination: PaginationMeta,
  ) {}
}

/** 创建分页结果快捷方法 */
export function paginate<T>(
  items: T[],
  pagination: PaginationMeta,
): PaginatedResult<T> {
  return new PaginatedResult(items, pagination);
}
