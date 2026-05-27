import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from "class-validator";
import { BookCategory } from "../books.types";

export class AddBookDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  author!: string;

  @IsIn(["textbook", "general", "novel"])
  category!: BookCategory;

  @IsInt()
  @Min(1)
  @Max(1000)
  copies!: number;
}
