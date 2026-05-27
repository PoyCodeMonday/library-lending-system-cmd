import { IsNotEmpty, IsString } from "class-validator";

export class CreateLoanDto {
  @IsString()
  @IsNotEmpty()
  bookId!: string;
}
