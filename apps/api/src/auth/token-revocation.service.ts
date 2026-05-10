import { Injectable } from '@nestjs/common'

@Injectable()
export class TokenRevocationService {
  private readonly revokedTokens = new Set<string>()

  revoke(token: string): void {
    if (token) {
      this.revokedTokens.add(token)
    }
  }

  isRevoked(token: string): boolean {
    return this.revokedTokens.has(token)
  }
}
