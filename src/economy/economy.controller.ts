import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import {
  DailyCheckInResponseDto,
  TipResponseDto,
  WalletResponseDto,
  WalletTransactionResponseDto,
} from './dto/economy-response.dto';
import { TipRequestDto } from './dto/tip-request.dto';
import { EconomyService } from './economy.service';

@ApiTags('Wallet')
@Controller()
export class EconomyController {
  constructor(private readonly economy: EconomyService) {}

  @Get('wallet')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户温油钱包余额与收款统计' })
  @ApiOkResponse({ type: WalletResponseDto })
  getWallet(@CurrentUser() user: CurrentUserPayload) {
    return this.economy.getWallet(user.id);
  }

  @Post('wallet/check-in')
  @HttpCode(200)
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '按北京时间自动签到；每日幂等获得 1–3 升温油和 2 经验' })
  @ApiOkResponse({ type: DailyCheckInResponseDto })
  checkIn(@CurrentUser() user: CurrentUserPayload) {
    return this.economy.checkIn(user.id);
  }

  @Get('wallet/transactions')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户温油收支流水' })
  @ApiCursorPaginatedResponse(WalletTransactionResponseDto, '温油收支流水，cursor 分页')
  transactions(@CurrentUser() user: CurrentUserPayload, @Query() query: CursorPaginationDto) {
    return this.economy.listTransactions(user.id, query.cursor, query.limit);
  }

  @Post('threads/:id/tips')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '向已发布主题帖楼主打赏温油' })
  @ApiCreatedResponse({ type: TipResponseDto })
  @ApiBadRequestResponse({ description: '金额不是不小于 2 的整数升' })
  @ApiForbiddenResponse({ description: '自我打赏、拉黑关系或无主题访问权限' })
  @ApiNotFoundResponse({ description: '主题帖或收款用户不存在' })
  @ApiConflictResponse({ description: '余额不足或幂等键复用于不同请求' })
  tipThread(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: TipRequestDto,
  ) {
    return this.economy.tipThread(user, id, dto.amount, dto.clientRequestId);
  }

  @Post('users/:id/tips')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '直接向用户打赏温油' })
  @ApiCreatedResponse({ type: TipResponseDto })
  @ApiBadRequestResponse({ description: '金额不是不小于 2 的整数升' })
  @ApiForbiddenResponse({ description: '自我打赏或存在拉黑关系' })
  @ApiNotFoundResponse({ description: '收款用户不存在' })
  @ApiConflictResponse({ description: '余额不足或幂等键复用于不同请求' })
  tipUser(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: TipRequestDto,
  ) {
    return this.economy.tipUser(user, id, dto.amount, dto.clientRequestId);
  }

  @Post('moments/:id/tips')
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '给公开动态作者加油' })
  @ApiCreatedResponse({ type: TipResponseDto })
  @ApiBadRequestResponse({ description: '金额不是不小于 2 的整数升' })
  @ApiForbiddenResponse({ description: '给自己加油或存在拉黑关系' })
  @ApiNotFoundResponse({ description: '动态不存在' })
  @ApiConflictResponse({ description: '余额不足或幂等键复用于不同请求' })
  tipMoment(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: TipRequestDto,
  ) {
    return this.economy.tipMoment(user, id, dto.amount, dto.clientRequestId);
  }
}
