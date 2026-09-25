import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  //desactivar cache
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('etag', false);

  const WEB_ORIGINS = [
    'https://dev.exdev.cl',
    'https://exdev.cl',
    'https://www.exdev.cl',
    'http://localhost:5000',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://tomas.exdev.cl',
    'https://www.tomas.exdev.cl',
  ];
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, WEB_ORIGINS.includes(origin));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    optionsSuccessStatus: 204,
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}
bootstrap();
