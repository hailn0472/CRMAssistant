import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, Headers } from '@nestjs/common'

import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { OAuthTokenDto } from './dto/oauth-token.dto'
import { RegisterDto } from './dto/register.dto'
import { Verify2FALoginDto } from './dto/verify-2fa-login.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto): Promise<ReturnType<AuthService['register']>> {
    return this.authService.register(dto)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<ReturnType<AuthService['login']>> {
    return this.authService.login(dto)
  }

  @Post('oauth-login')
  @HttpCode(HttpStatus.OK)
  async oauthLogin(@Body() dto: OAuthTokenDto): Promise<ReturnType<AuthService['oauthLogin']>> {
    return this.authService.oauthLogin(dto)
  }

  @Post('verify-2fa-login')
  @HttpCode(HttpStatus.OK)
  async verify2FALogin(@Body() dto: Verify2FALoginDto): Promise<ReturnType<AuthService['verify2FALogin']>> {
    return this.authService.verify2FALogin(dto.tempToken, dto.code)
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(@Headers('authorization') authorization: string): Promise<void> {
    const token = authorization?.replace('Bearer ', '') ?? ''
    await this.authService.logout(token)
  }
}
