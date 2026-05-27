import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@library-lending/api"],
  serverExternalPackages: [
    "@nestjs/core",
    "@nestjs/common",
    "@nestjs/platform-express",
    "@prisma/client",
    "class-transformer",
    "class-validator"
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        {
          "@nestjs/common": "commonjs @nestjs/common",
          "@nestjs/core": "commonjs @nestjs/core",
          "@nestjs/platform-express": "commonjs @nestjs/platform-express",
          "@prisma/client": "commonjs @prisma/client",
          "class-transformer": "commonjs class-transformer",
          "class-validator": "commonjs class-validator"
        }
      ];
    }

    return config;
  }
};

export default nextConfig;
