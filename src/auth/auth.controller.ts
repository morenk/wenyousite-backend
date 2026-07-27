import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

/** 认证控制器：注册、登录、Token 刷新 */
@ApiTags('Auth')
@Controller('auth')
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: '注册新账号' })
  @ApiResponse({ status: 201, type: AuthResponseDto, description: '注册成功返回双 Token 和用户信息' })
  @ApiResponse({ status: 409, description: '邮箱或用户名已被占用' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '邮箱 + 密码登录' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '登录成功返回双 Token 和用户信息' })
  @ApiResponse({ status: 401, description: '邮箱或密码错误' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新访问令牌' })
  @ApiResponse({ status: 200, type: AuthResponseDto, description: '刷新成功，返回新的双 Token' })
  @ApiResponse({ status: 401, description: '刷新令牌无效' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }
}
