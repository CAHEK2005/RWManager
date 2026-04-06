import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { RequestMethod, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', 1);

  const authService = app.get(AuthService);
  await authService.seedAdmin();

  const corsOrigins = process.env.CORS_ORIGIN?.split(',').filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : 'http://localhost:5173',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'bus/:uuid', method: RequestMethod.GET },
      { path: 'bus/:uuid/:tunnelId', method: RequestMethod.GET },
    ]
  });
  
  await app.listen(3000);
}
bootstrap();