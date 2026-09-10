'use client'

import { Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { TagBadge } from './TagBadge'
import { getTags, addTagToContact, removeTagFromContact } from '@/services/tag.service'

type TagShape = { id: string; name: string; color: string }

type TagSelectorProps = {
  contactId?: string | null
  selectedTags: TagShape[]
  onTagsChange: (tags: TagShape[]) => void
}

export function TagSelector({
  contactId,
  selectedTags,
  onTagsChange,
}: TagSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: allTags = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
  })

  const addMutation = useMutation({
    mutationFn: (tagId: string) => {
      if (!contactId) throw new Error('Cannot add tag without a saved contact')
      return addTagToContact(contactId, tagId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (tagId: string) => {
      if (!contactId) throw new Error('Cannot remove tag without a saved contact')
      return removeTagFromContact(contactId, tagId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
  })

  const availableTags = allTags.filter((tag) => !selectedTags.some((st) => st.id === tag.id))

  async function handleSelect(tag: TagShape): Promise<void> {
    try {
      if (contactId) {
        await addMutation.mutateAsync(tag.id)
      }
      onTagsChange([...selectedTags, tag])
    } catch {
      // Tag mutation failed — do not update local state
    }
  }

  async function handleRemove(tag: TagShape): Promise<void> {
    try {
      if (contactId) {
        await removeMutation.mutateAsync(tag.id)
      }
      onTagsChange(selectedTags.filter((st) => st.id !== tag.id))
    } catch {
      // Tag mutation failed — do not update local state
    }
  }

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />
  }

  return (
    <div className="grid gap-2">
      {selectedTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <TagBadge key={tag.id} tag={tag} onRemove={handleRemove} />
          ))}
        </div>
      ) : null}
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            className="w-full justify-between"
            disabled={addMutation.isPending}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
          >
            {open ? 'Search tags...' : 'Add tag...'}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[300px] p-0">
          <Command>
            <CommandInput placeholder="Search tags..." />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              <CommandGroup>
                {availableTags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    onSelect={() => {
                      void handleSelect(tag)
                      setOpen(false)
                    }}
                  >
                    <div
                      className="mr-2 h-3 w-3 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                    <Check className="ml-auto h-4 w-4 opacity-0" />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
