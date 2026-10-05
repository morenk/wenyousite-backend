import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional } from 'class-validator';
export class MarkdownCapabilityDto {
  @ApiPropertyOptional({ type: Number, enum: [6], description: '声明编辑器支持 Markdown 6 角色提及源的无损读取/编辑。服务端 capabilities.roleMentionsV6Supported 为 true 时新端始终发送，包括删光旧节点；未声明而新/原正文含 v6 返回 409/40014。新节点还须 roleMentionsV6WriteEnabled。' })
  @IsOptional()
  @IsInt()
  @IsIn([6])
  markdownContractVersion?: number;
}
