import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

type GeminiApiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

export type GoogleAiStudioResponse = {
  content: string
  model: string
}

@Injectable()
export class GoogleAiStudioClient {
  constructor(private readonly configService: ConfigService) {}

  async generateJson(systemPrompt: string, question: string): Promise<GoogleAiStudioResponse> {
    const apiKey = this.configService.get<string>('GOOGLE_AI_STUDIO_API_KEY')
    if (!apiKey) {
      throw new ServiceUnavailableException('Text-to-SQL is not configured')
    }

    const model = this.configService.get<string>('GOOGLE_AI_STUDIO_MODEL') ?? 'gemini-3.6-flash'
    let response: Response

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: question }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0,
              maxOutputTokens: 1_024,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      )
    } catch {
      throw new BadGatewayException('Text-to-SQL provider is unavailable')
    }

    if (!response.ok) {
      throw new BadGatewayException('Text-to-SQL provider rejected the request')
    }

    let payload: GeminiApiResponse
    try {
      payload = (await response.json()) as GeminiApiResponse
    } catch {
      throw new BadGatewayException('Text-to-SQL provider returned an invalid response')
    }

    const content = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim()

    if (!content) {
      throw new BadGatewayException('Text-to-SQL provider returned no generated query')
    }

    return { content, model }
  }
}
