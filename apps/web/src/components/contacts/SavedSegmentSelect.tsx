'use client'

import { useQuery } from '@tanstack/react-query'

import { Select } from '@/components/ui/select'
import { getSavedSegments, type SavedSegment } from '@/services/segment.service'

type SavedSegmentSelectProps = {
  onSelect: (segment: SavedSegment) => void
}

export function SavedSegmentSelect({ onSelect }: SavedSegmentSelectProps): React.JSX.Element {
  const { data: segments = [] } = useQuery({
    queryKey: ['savedSegments'],
    queryFn: getSavedSegments,
  })

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const value = e.target.value
    if (!value) return
    if (value === '__create_new__') {
      onSelect({
        id: '__create_new__',
        name: '',
        filters: '',
        createdBy: '',
        createdAt: '',
        updatedAt: '',
      })
      return
    }
    const segment = segments.find((s) => s.id === value)
    if (segment) {
      onSelect(segment)
    }
  }

  if (segments.length === 0) {
    return <></>
  }

  return (
    <Select onChange={handleChange} placeholder="Saved segments..." className="w-[200px]">
      {segments.map((segment) => (
        <option key={segment.id} value={segment.id}>
          {segment.name}
        </option>
      ))}
    </Select>
  )
}
