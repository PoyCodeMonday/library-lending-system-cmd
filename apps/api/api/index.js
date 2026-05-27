const serverless = require("serverless-http");
const { createApp } = require("../dist/create-app");

let cachedHandler = null;

async function bootstrap() {
  if (!cachedHandler) {
    const app = await createApp();
    await app.init();
    cachedHandler = serverless(app.getHttpAdapter().getInstance());
  }

  return cachedHandler;
}

module.exports = async function handler(request, response) {
  const server = await bootstrap();
  return server(request, response);
};
