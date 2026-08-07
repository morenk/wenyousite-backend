import { Body, Controller, Delete, Put, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AuthRead } from '../auth/decorators/auth.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { MobileDeviceResponseDto, RegisterMobileDeviceDto } from './dto/mobile-device.dto';
import { MobileDeviceService } from './mobile-device.service';

@ApiTags('Mobile Devices')
@Controller('mobile/devices')
@AuthRead()
export class MobileDeviceController {
  constructor(private readonly devices: MobileDeviceService) {}

  @Put('current')
  @ApiOperation({ summary: '注册或更新当前原生移动登录终端的 FCM token' })
  @ApiOkResponse({ type: MobileDeviceResponseDto })
  register(@Req() req: FastifyRequest, @Body() dto: RegisterMobileDeviceDto) {
    const user = req.user as { id: string; sessionId?: string };
    return this.devices.register(user.id, user.sessionId, dto);
  }

  @Delete('current')
  @ApiOperation({ summary: '注销当前原生移动登录终端的推送' })
  @ApiOkResponse({ type: MessageResponseDto })
  unregister(@Req() req: FastifyRequest) {
    const user = req.user as { id: string; sessionId?: string };
    return this.devices.unregister(user.id, user.sessionId);
  }
}
