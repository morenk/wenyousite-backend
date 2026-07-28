import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

/** 处理举报 DTO */
export class HandleReportDto {
  @ApiProperty({ enum: ['RESOLVED', 'DISMISSED'], description: '处理状态' })
  @IsString()
  @IsIn(['RESOLVED', 'DISMISSED'])
  status: string;
}
