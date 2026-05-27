import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { config } from "dotenv";
import express from "express";
import { AppModule } from "./app.module";

config({ path: [".env", "../../.env"], quiet: true });

let cached: express.Express | null = null;

export async function getExpressApp(): Promise<express.Express> {
  if (cached) {
    return cached;
  }

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: true,
    logger: ["error", "warn"]
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  );

  await app.init();
  cached = server;
  return server;
}
