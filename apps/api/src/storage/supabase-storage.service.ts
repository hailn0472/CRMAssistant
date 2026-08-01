import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const SIGNED_URL_TTL_SECONDS = 300
export const DEFAULT_STORAGE_BUCKET = 'deal-documents'

/**
 * Minimal Supabase Storage wrapper (Story 3.6).
 *
 * Builds its OWN client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` —
 * it must not borrow `AuthService.supabaseAdmin`, which is an optional,
 * auth-scoped client. The client is created lazily on first use: constructing
 * must never throw, or the whole API fails to boot in any environment that has
 * not yet been given the service-role key. Object paths are tenant-first
 * (`deals/{tenantId}/{dealId}/{documentId}-{sanitizedFileName}`), matching the
 * `avatars/{tenantId}/{userId}.{ext}` convention from Story 2.1.
 *
 * Every Supabase `{ error }` result maps to a 500 — the API registers no global
 * exception filter, so an unmapped throw would become an opaque 500 anyway.
 */
@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name)
  private client: SupabaseClient | null = null

  constructor(private readonly config: ConfigService) {}

  private getClient(): SupabaseClient {
    if (this.client) return this.client
    const url = this.config.get<string>('SUPABASE_URL')
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceRoleKey) {
      throw new InternalServerErrorException('Document storage is not configured')
    }
    this.client = createClient(url, serviceRoleKey)
    return this.client
  }

  private getBucket(): string {
    return this.config.get<string>('SUPABASE_STORAGE_BUCKET') ?? DEFAULT_STORAGE_BUCKET
  }

  async upload(objectPath: string, body: Buffer, mimeType: string): Promise<void> {
    const { error } = await this.getClient()
      .storage.from(this.getBucket())
      .upload(objectPath, body, { contentType: mimeType })
    if (error) {
      this.logger.error(`Storage upload failed for ${objectPath}: ${error.message}`)
      throw new InternalServerErrorException('Document storage is unavailable')
    }
  }

  async createSignedUrl(objectPath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.getClient()
      .storage.from(this.getBucket())
      .createSignedUrl(objectPath, expiresInSeconds)
    if (error || !data?.signedUrl) {
      this.logger.error(
        `Signed URL creation failed for ${objectPath}: ${error?.message ?? 'no URL returned'}`,
      )
      throw new InternalServerErrorException('Document storage is unavailable')
    }
    return data.signedUrl
  }

  async remove(objectPath: string): Promise<void> {
    const { error } = await this.getClient().storage.from(this.getBucket()).remove([objectPath])
    if (error) {
      this.logger.error(`Storage removal failed for ${objectPath}: ${error.message}`)
      throw new InternalServerErrorException('Document storage is unavailable')
    }
  }
}
