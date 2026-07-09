import { IsNotEmpty, IsString, MinLength } from 'class-validator'

export class Verify2FALoginDto {
  @IsString()
  @IsNotEmpty()
  declare tempToken: string

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  declare code: string
}
