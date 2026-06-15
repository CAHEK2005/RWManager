import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { ChangePasswordDto, LoginDto, UpdateProfileDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() req: LoginDto) {
    const user = await this.authService.validateUser(req.login, req.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Post('change-password')
  async changePassword(@Body() body: ChangePasswordDto) {
    await this.authService.changePassword(body.password);
    return { success: true };
  }

  @Post('update-profile')
  async updateProfile(@Body() body: UpdateProfileDto) {
    await this.authService.updateAdminProfile(body.login, body.password);
    return { success: true };
  }
}
