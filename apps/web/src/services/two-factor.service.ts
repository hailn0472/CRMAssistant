type GraphQlResponse<T> = { data?: Record<string, T>; errors?: { message: string }[] }

async function graphqlRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const accessToken = localStorage.getItem('accessToken')
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error('GraphQL request failed')
  }

  const result = (await response.json()) as GraphQlResponse<T>
  if (result.errors?.[0]) {
    throw new Error(result.errors[0].message)
  }

  return result.data![Object.keys(result.data!)[0] as string]
}

export const twoFactorService = {
  async enable2FA(): Promise<{ secret: string; qrCodeDataUrl: string; backupCodes: string[] }> {
    return graphqlRequest(`
      mutation Enable2FA {
        enable2FA {
          secret
          qrCodeDataUrl
          backupCodes
        }
      }
    `)
  },

  async verify2FA(code: string): Promise<{ success: boolean }> {
    return graphqlRequest(`
      mutation Verify2FA($code: String!) {
        verify2FA(code: $code) {
          success
        }
      }
    `, { code })
  },

  async disable2FA(password: string): Promise<boolean> {
    return graphqlRequest(`
      mutation Disable2FA($password: String!) {
        disable2FA(password: $password)
      }
    `, { password })
  },

  async regenerateBackupCodes(password: string): Promise<string[]> {
    return graphqlRequest(`
      mutation RegenerateBackupCodes($password: String!) {
        regenerateBackupCodes(password: $password)
      }
    `, { password })
  },

  async updateTenantSettings(enforce2FA: boolean): Promise<{ enforce2FA: boolean }> {
    return graphqlRequest(`
      mutation UpdateTenantSettings($enforce2FA: Boolean!) {
        updateTenantSettings(enforce2FA: $enforce2FA) {
          enforce2FA
        }
      }
    `, { enforce2FA })
  },

  async getCurrentUser(): Promise<{ ssoProvider: string | null }> {
    return graphqlRequest(`
      query CurrentUser {
        me {
          ssoProvider
        }
      }
    `)
  },
}
