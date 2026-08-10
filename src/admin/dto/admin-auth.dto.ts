import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export class AdminLoginChallengeDto {
  @ApiProperty({ example: 'admin@example.com', description: '管理员邮箱或用户名' })
  @IsString()
  @IsNotEmpty()
  account: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}

export class AdminChallengeVerifyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId: string;

  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
