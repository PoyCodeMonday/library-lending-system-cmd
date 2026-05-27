import { IsOptional, IsString } from "class-validator";

export class ReturnLoanDto {
  @IsString()
  @IsOptional()
  returnedAt?: string;
}
