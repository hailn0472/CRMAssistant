import * as shared from '@/components/shared'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'

describe('shared barrel exports', () => {
  it('should export EmptyState', () => {
    expect(shared.EmptyState).toBe(EmptyState)
  })

  it('should export ErrorState', () => {
    expect(shared.ErrorState).toBe(ErrorState)
  })

  it('should export LoadingSkeleton', () => {
    expect(shared.LoadingSkeleton).toBeDefined()
  })
})
