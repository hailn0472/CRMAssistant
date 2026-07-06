import { IsOptional, IsString, IsNotEmpty, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'

export class OAuthTokenDto {
  @IsString()
  @IsNotEmpty()
  declare accessToken: string

  @IsOptional()
  @IsString()
  @MinLength(2)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  declare tenantName?: string
}
