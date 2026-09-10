import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class TextToSqlQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  question!: string
}
