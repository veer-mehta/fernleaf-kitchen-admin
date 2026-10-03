import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The Next.js proxy makes the browser talk to its own origin, so CORS is mainly for
  // calling the API directly in local development.
  // Only the web app's own address may call the API from a browser; with no address configured, nobody may.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? false, credentials: true });
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
