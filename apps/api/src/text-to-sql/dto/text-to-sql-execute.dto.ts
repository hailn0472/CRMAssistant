import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator'

import { SALES_QUERY_INTENTS } from '../text-to-sql.types'

export class TextToSqlExecuteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  question!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(8_000)
  sql!: string

  @IsString()
  @IsIn(SALES_QUERY_INTENTS)
  intent!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  executionToken!: string
}
