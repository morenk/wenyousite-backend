import { ApiProperty } from '@nestjs/swagger';

/** 子贴重排后的最小稳定投影。 */
export class ReorderedSubthreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ minimum: 0 })
  sortOrder!: number;
}
