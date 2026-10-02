import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The Next.js proxy makes the browser talk to its own origin, so CORS is mainly for
  // calling the API directly in local development.
  app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
