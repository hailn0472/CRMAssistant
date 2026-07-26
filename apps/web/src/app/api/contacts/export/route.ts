import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'
const AUTH_COOKIE = 'auth-token'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const realToken = cookies().get(AUTH_COOKIE)?.value
  if (!realToken) {
    return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const url = `${API_URL}/api/contacts/export${searchParams.toString() ? `?${searchParams.toString()}` : ''}`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${realToken}`,
      },
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({ message: 'Export failed' }))
      return NextResponse.json(data, { status: response.status })
    }

    // Return CSV stream
    const csvText = await response.text()
    return new NextResponse(csvText, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="contacts-export.csv"',
      },
    })
  } catch {
    return NextResponse.json({ message: 'Backend request failed' }, { status: 502 })
  }
}
