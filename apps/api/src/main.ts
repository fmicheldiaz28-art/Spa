import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { requestContextMiddleware } from './common/context/request-context.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';
import { env } from './config/env.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);

// La web llega a través del proxy de Next.js: confiar en X-Forwarded-For solo desde esos saltos
// (misma máquina en local; red privada en la nube, p. ej. TRUST_PROXY='loopback, uniquelocal, 100.64.0.0/10').
app.set('trust proxy', env.TRUST_PROXY);
app.use(requestContextMiddleware);
app.use(helmet());
app.use(cookieParser());
app.setGlobalPrefix('api/v1');
app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
app.useGlobalFilters(new ProblemDetailsFilter());
app.enableShutdownHooks();

await app.listen(env.PORT);
Logger.log(`API escuchando en http://localhost:${env.PORT}/api/v1`, 'Bootstrap');
