# API 参数校验规范

> 本文档定义温油站后端 API 的参数校验体系，适用于所有新开发的端点。
>
> 相关阅读：[API 端点表](./api-endpoints.md) | [数据模型](./data-model.md)

---

## 1. 全局校验管道

所有入请求均通过 `main.ts` 中注册的全局 `ValidationPipe` 进行自动校验：

```ts
// src/main.ts
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,             // GET query string "10" → number 10
    whitelist: true,             // 剔除 DTO 未声明的多余字段
    forbidNonWhitelisted: true,  // 多余字段直接返回 400
  }),
);
```

**校验时机**：请求到达控制器方法之前，由管道自动完成。校验失败时返回 HTTP 400，响应格式：

```json
{
  "statusCode": 400,
  "message": ["title must be shorter than or equal to 100 characters"],
  "error": "Bad Request",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "path": "/api/v1/threads"
}
```

---

## 2. DTO 编写规范

### 2.1 必须使用独立 DTO 文件

**禁止**在控制器中直接使用内联匿名对象类型。每个端点必须有独立的 DTO 文件。

```ts
// ❌ 错误示例：内联类型 + 内联取参
@Body() dto: { title: string; content: string }
@Body('userId') targetUserId: string

// ✅ 正确示例：独立 DTO 文件
@Body() dto: CreateThreadDto
@Body() dto: InviteMemberDto
```

### 2.2 DTO 文件骨架

每个 DTO 文件必须包含：

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

/** 创建某某 DTO */
export class CreateXxxDto {
  @ApiProperty({ description: '字段说明' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  field: string;

  @ApiPropertyOptional({ description: '可选字段说明' })
  @IsOptional()
  @IsString()
  optionalField?: string;
}
```

**要点**：
- 文件头部有 JSDoc 注释说明用途
- 必填字段用 `@ApiProperty`，可选字段用 `@ApiPropertyOptional`
- 每个字段至少包含 `description`
- 枚举字段使用 `@ApiPropertyOptional({ enum: [...] })` 提供 Swagger 选项
- 所有字段必须有对应的 `class-validator` 装饰器

### 2.3 继承复用

通用字段应提取为基础 DTO 并继承，避免重复定义。

```ts
// ✅ 正确示例
export class ThreadQueryDto extends CursorPaginationDto {
  category?: string;
  sort?: string;
}
```

---

## 3. 参数类型约束细则

### 3.1 字符串长度

| 场景 | 装饰器 | 示例 |
|------|--------|------|
| 标题 | `@MaxLength(100)` | 主题帖标题、子贴标题 |
| 正文 | `@MaxLength(10000)` | 帖子内容、草稿内容 |
| 昵称 | `@MaxLength(50)` | 用户昵称 |
| 简介 | `@MaxLength(255)` | 用户 bio |
| 密码 | `@MinLength(8) @MaxLength(100)` | 注册/修改/重置密码 |
| 标签名 | `@MinLength(1) @MaxLength(20)` | TopicTag / SubthreadTagDef |
| 文件名 | `@MinLength(1) @MaxLength(255)` | 媒体上传文件名 |

### 3.2 ID 字段（UUID）

所有数据库主键/外键 ID 字段必须添加：

```ts
@IsString()
@IsUUID()
threadId: string;
```

**例外**：纯字符串标识符（如邀请链接 token、验证 token）不在此列，仅用 `@IsString()`。

### 3.3 邮箱

```ts
@IsEmail()
email: string;
```

### 3.4 枚举

使用 `@IsIn()` 配合数组，不使用 `@IsEnum()`（Prisma 枚举为编译后类型，运行时不可用）。

```ts
@IsIn(['DEDUCTION', 'NATION', 'RPG'])
category: string;

@IsIn(['THREAD', 'USER'])
type: string;
```

### 3.5 数字

整数范围使用：

```ts
@IsNumber()
@Min(1)
@Max(10 * 1024 * 1024)  // 10 MB 文件大小上限
size: number;

// 草稿槽位
@IsIn([1, 2, 3, 4, 5])
slot: number;
```

### 3.6 正则匹配

```ts
// 用户名：字母 + 数字 + 下划线 + 中文
@Matches(/^[a-zA-Z0-9_\u4e00-\u9fff]+$/)

// 颜色：十六进制 #RRGGBB
@Matches(/^#[0-9a-fA-F]{6}$/)
```

### 3.7 布尔值

```ts
@IsBoolean()
playerMarked: boolean;
```

### 3.8 数组

```ts
@IsArray()
@IsString({ each: true })
tagNames: string[];
```

---

## 4. 查询字符串参数规范

### 4.1 必须使用 DTO 接收

```ts
// ❌ 错误：内联 @Query
@Query('cursor') cursor?: string
@Query('limit') limit?: string

// ✅ 正确：DTO 接收
@Query() query: PostQueryDto
```

### 4.2 数字类型转换

GET 请求的 query string 值全部为字符串，必须配合 `@Type(() => Number)` 完成转换：

```ts
import { Type } from 'class-transformer';

export class CursorPaginationDto {
  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}
```

`transform: true`（在全局 ValidationPipe 中） + `@Type(() => Number)` 自动将 `?limit=10` 转为 `10`（number）。

### 4.3 分页规范

所有需要分页的列表端点统一继承 `CursorPaginationDto`：

```ts
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class XxxQueryDto extends CursorPaginationDto {
  // 自定义筛选字段
}
```

**分页规则**：
- `cursor`：上一页最后一条记录的 ID（字符串），首次请求不传
- `limit`：每页条数，默认 20，必须校验 `@IsNumber()`

---

## 5. 响应格式

### 5.1 成功响应

`TransformInterceptor` 自动将所有成功响应包装为：

```json
{
  "data": { ... }
}
```

### 5.2 校验错误响应

`ValidationPipe` 自动生成：

```json
{
  "statusCode": 400,
  "message": ["password must be longer than or equal to 8 characters"],
  "error": "Bad Request",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "path": "/api/v1/auth/register"
}
```

前端可根据 `message` 数组（各字段错误列表）定位具体问题字段。

### 5.3 其他异常

`AllExceptionsFilter` 统一格式：

```json
{
  "statusCode": 404,
  "message": "Thread not found",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "path": "/api/v1/threads/xxx"
}
```

---

## 6. 新增端点 Checklist

开发新端点时逐项确认：

- [ ] 所有 Body 参数使用独立 DTO 文件（非内联类型、非 `@Body('field')`）
- [ ] 所有 Query 参数使用 DTO（非 `@Query('field')`）
- [ ] 每个 DTO 字段有 `@ApiProperty` / `@ApiPropertyOptional`
- [ ] 每个 DTO 字段有对应的 `class-validator` 装饰器
- [ ] ID 字段有 `@IsUUID()`
- [ ] 字符串有 `@MinLength` / `@MaxLength`
- [ ] 枚举有 `@IsIn([...])`
- [ ] 数字有 `@IsNumber()`，query string 有 `@Type(() => Number)`
- [ ] 需要分页的列表继承 `CursorPaginationDto`
- [ ] DTO 文件头部有 JSDoc 用途说明

---

## 7. used 校验装饰器速查

| 装饰器 | 用途 | 使用频率 |
|--------|------|----------|
| `@IsString()` | 类型校验 | 必加 |
| `@IsOptional()` | 标记可选 | 按需 |
| `@IsNumber()` | 数字校验 | 按需 |
| `@IsBoolean()` | 布尔校验 | 按需 |
| `@IsEmail()` | 邮箱格式 | 邮箱字段 |
| `@IsUUID()` | UUID v4 | ID 字段 |
| `@IsIn([...])` | 枚举值 | 枚举字段 |
| `@IsArray()` | 数组校验 | 数组字段 |
| `@MinLength(n)` / `@MaxLength(n)` | 字符串长度 | 按需 |
| `@Min(n)` / `@Max(n)` | 数字范围 | 按需 |
| `@Matches(/.../)` | 正则匹配 | 按需 |
| `@Type(() => Number)` | 查询串类型转换 | query DTO |
| `@ApiProperty({ description })` | Swagger 文档 | 必加 |
| `@ApiPropertyOptional({ description })` | Swagger 文档（可选） | 必加 |
