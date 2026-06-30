import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator'

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  declare email: string

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  declare password: string

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  declare firstName: string

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  declare lastName: string

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  declare tenantName: string
}
