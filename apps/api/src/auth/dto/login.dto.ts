import { IsEmail, IsNotEmpty, IsString } from 'class-validator'

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  declare email: string

  @IsString()
  @IsNotEmpty()
  declare password: string
}
