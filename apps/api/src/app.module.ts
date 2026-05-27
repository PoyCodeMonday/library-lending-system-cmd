import { Module } from "@nestjs/common";
import { BooksController } from "./books/books.controller";
import { BooksService } from "./books/books.service";
import { PrismaService } from "./prisma.service";

@Module({
  controllers: [BooksController],
  providers: [BooksService, PrismaService]
})
export class AppModule {}
