import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional } from 'class-validator';
export class MarkdownCapabilityDto {
  @ApiPropertyOptional({ type: 'integer', enum: [1, 2], description: '1 支持字体 v1；2 支持 v1/v2 混合正文无损读写；新端始终发送，包括删除全部字体。新/原正文含字体未声明返回 409/40019；v1 新写受 textFontV1WriteEnabled 控制；v2 新写受 textFontV2WriteEnabled 与版本 pasteAllowed 控制。颜色组合还须 textColorVersion:1。' })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2])
  textFontVersion?: number;

  @ApiPropertyOptional({ type: 'integer', enum: [1], description: '支持文本颜色 v1 无损读写；新端始终发送，包括删除全部颜色。新/原正文含颜色未声明返回 409/40016；新写受 textColorV1WriteEnabled 控制。' })
  @IsOptional()
  @IsInt()
  @IsIn([1])
  textColorVersion?: number;

  @ApiPropertyOptional({ type: 'integer', enum: [6], description: '声明编辑器支持 Markdown 6 角色提及源的无损读取/编辑。服务端 capabilities.roleMentionsV6Supported 为 true 时新端始终发送，包括删光旧节点；未声明而新/原正文含 v6 返回 409/40014。新节点还须 roleMentionsV6WriteEnabled。' })
  @IsOptional()
  @IsInt()
  @IsIn([6])
  markdownContractVersion?: number;
}
