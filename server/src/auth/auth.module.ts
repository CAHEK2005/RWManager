import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../settings/entities/setting.entity';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { getJwtSecret } from './jwt-secret';

@Module({
  imports: [
    TypeOrmModule.forFeature([Setting]),
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => {
        if (!process.env.JWT_SECRET) {
          console.warn(
            '[AuthModule] WARNING: JWT_SECRET is not set. ' +
              'Using an insecure default key. Set JWT_SECRET in production!',
          );
        }
        return {
          secret: getJwtSecret(),
          signOptions: { expiresIn: '24h' },
        };
      },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
