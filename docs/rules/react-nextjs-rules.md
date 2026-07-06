# React & Next.js Framework Rules

## Component Structure

### Functional Components Only

```tsx
// ✅ Good
export function ContactCard({ contact }: ContactCardProps) {
  return <div>{contact.name}</div>
}

// ❌ Bad - no class components
export class ContactCard extends React.Component {
  render() {
    return <div>{this.props.contact.name}</div>
  }
}
```

### Component File Structure

```tsx
// 1. Imports
import { useState } from 'react'
import type { Contact } from '@/types'

// 2. Types/Interfaces
interface ContactCardProps {
  contact: Contact
  onEdit?: (id: string) => void
}

// 3. Component
export function ContactCard({ contact, onEdit }: ContactCardProps) {
  // 3a. Hooks
  const [isExpanded, setIsExpanded] = useState(false)

  // 3b. Event handlers
  const handleEdit = () => {
    onEdit?.(contact.id)
  }

  // 3c. Render
  return <div>{/* JSX */}</div>
}
```

## Hooks Rules

### Hook Order (React Rules of Hooks)

```tsx
function ContactForm() {
  // 1. State hooks
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  // 2. Context hooks
  const { user } = useAuth()

  // 3. Custom hooks
  const { mutate, isLoading } = useCreateContact()

  // 4. useEffect hooks (last)
  useEffect(() => {
    // Side effects
  }, [])

  return <form>...</form>
}
```

### Custom Hooks Naming

- **Always prefix with `use`**
- **Return object or array** (consistent pattern)
- **Examples**: `useContactForm`, `useAuth`, `useTextToSql`

### Custom Hook Pattern

```tsx
// ✅ Good - returns object
export function useContactForm(initialData?: Contact) {
  const [data, setData] = useState(initialData)
  const [errors, setErrors] = useState({})

  const validate = () => {
    // Validation logic
  }

  return { data, setData, errors, validate }
}

// ✅ Good - returns array (like useState)
export function useToggle(initial = false): [boolean, () => void] {
  const [value, setValue] = useState(initial)
  const toggle = () => setValue((v) => !v)
  return [value, toggle]
}
```

## State Management

### TanStack Query for Server State

```tsx
// ✅ Good - server state with TanStack Query
export function ContactList() {
  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => fetchContacts()
  });

  if (isLoading) return <Spinner />;
  return <div>{contacts.map(...)}</div>;
}
```

### Zustand for UI State

```tsx
// ✅ Good - UI state with Zustand
import { create } from 'zustand'

interface UIStore {
  sidebarOpen: boolean
  toggleSidebar: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))
```

### NEVER Mix Server and UI State

```tsx
// ❌ Bad - mixing concerns
const [contacts, setContacts] = useState([]) // Server state
const [sidebarOpen, setSidebarOpen] = useState(true) // UI state

// ✅ Good - separated
const { data: contacts } = useQuery(['contacts'], fetchContacts) // Server
const { sidebarOpen } = useUIStore() // UI
```

## Next.js App Router Patterns

### Server Components by Default

```tsx
// app/contacts/page.tsx
// ✅ Good - Server Component (default)
export default async function ContactsPage() {
  const contacts = await prisma.contact.findMany()
  return <ContactList contacts={contacts} />
}
```

### Client Components When Needed

```tsx
// components/ContactForm.tsx
'use client' // ✅ Explicit client component

import { useState } from 'react'

export function ContactForm() {
  const [name, setName] = useState('')
  // Interactive UI
}
```

**When to use 'use client':**

- Component uses React hooks (useState, useEffect, etc.)
- Component uses browser APIs (window, document, localStorage)
- Component uses event handlers (onClick, onChange, etc.)
- Component uses Context providers/consumers
- Component uses third-party libraries that require client-side

### Server Actions

```tsx
// app/contacts/actions.ts
'use server'

export async function createContact(formData: FormData) {
  const data = {
    name: formData.get('name') as string,
    email: formData.get('email') as string,
  }

  // Validate data
  const validated = contactSchema.parse(data)

  // Create contact
  return await prisma.contact.create({ data: validated })
}
```

### Use Server Actions in Forms

```tsx
// ✅ Good - Server Action
<form action={createContact}>
  <input name="name" />
  <input name="email" />
  <button type="submit">Create</button>
</form>
```

### Data Fetching Patterns

**Fetch in Server Components:**

```tsx
// ✅ Good - fetch in Server Component
export default async function ContactPage({ params }: { params: { id: string } }) {
  const contact = await prisma.contact.findUnique({
    where: { id: params.id },
  })

  if (!contact) notFound()

  return <ContactDetail contact={contact} />
}
```

**Use TanStack Query in Client Components:**

```tsx
'use client';

export function ContactList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['contacts'],
    queryFn: async () => {
      const res = await fetch('/api/contacts');
      return res.json();
    }
  });

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return <div>{data.map(...)}</div>;
}
```

## Performance Optimization

### Use React.memo for Expensive Components

```tsx
// ✅ Good
export const ContactCard = React.memo(function ContactCard({ contact }: Props) {
  return <div>{contact.name}</div>
})
```

**When to use React.memo:**

- Component renders often with same props
- Component is expensive to render
- Component is in a list

**When NOT to use React.memo:**

- Component rarely re-renders
- Props change frequently
- Component is cheap to render

### Use useMemo for Expensive Calculations

```tsx
// ✅ Good
const sortedContacts = useMemo(
  () => contacts.sort((a, b) => a.name.localeCompare(b.name)),
  [contacts],
)

// ❌ Bad - recalculates on every render
const sortedContacts = contacts.sort((a, b) => a.name.localeCompare(b.name))
```

### Use useCallback for Event Handlers Passed to Children

```tsx
// ✅ Good
const handleEdit = useCallback((id: string) => {
  // Edit logic
}, [])

return <ContactCard onEdit={handleEdit} />

// ❌ Bad - creates new function on every render
return (
  <ContactCard
    onEdit={(id) => {
      /* logic */
    }}
  />
)
```

### Lazy Load Heavy Components

```tsx
// ✅ Good
import { lazy, Suspense } from 'react'

const HeavyChart = lazy(() => import('./HeavyChart'))

export function Dashboard() {
  return (
    <Suspense fallback={<Spinner />}>
      <HeavyChart data={data} />
    </Suspense>
  )
}
```

### Image Optimization

```tsx
// ✅ Good - use Next.js Image component
import Image from 'next/image';

<Image
  src="/avatar.jpg"
  alt="User avatar"
  width={100}
  height={100}
  priority // for above-the-fold images
/>

// ❌ Bad - regular img tag
<img src="/avatar.jpg" alt="User avatar" />
```

## Form Handling

### Use React Hook Form + Zod

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const contactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
})

type ContactFormData = z.infer<typeof contactSchema>

export function ContactForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  })

  const onSubmit = async (data: ContactFormData) => {
    await createContact(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span className="text-red-500">{errors.name.message}</span>}

      <input {...register('email')} />
      {errors.email && <span className="text-red-500">{errors.email.message}</span>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Save'}
      </button>
    </form>
  )
}
```

### Form Validation Rules

- **Always use Zod schemas** for validation
- **Show validation errors inline** below each field
- **Disable submit button** while submitting
- **Show loading state** during submission
- **Handle server errors** gracefully

## Styling with Tailwind CSS

### Use Tailwind Utility Classes

```tsx
// ✅ Good
<div className="flex items-center gap-4 p-4 bg-white rounded-lg shadow">
  <h2 className="text-xl font-semibold text-gray-900">{contact.name}</h2>
  <p className="text-sm text-gray-600">{contact.email}</p>
</div>
```

### Use cn() Helper for Conditional Classes

```tsx
import { cn } from '@/lib/utils'
;<button
  className={cn(
    'px-4 py-2 rounded font-medium transition-colors',
    isActive && 'bg-blue-500 text-white',
    !isActive && 'bg-gray-200 text-gray-700',
    isDisabled && 'opacity-50 cursor-not-allowed',
  )}
>
  Click me
</button>
```

### Use shadcn/ui Components

```tsx
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
;<Card>
  <CardHeader>
    <h2>Contact Form</h2>
  </CardHeader>
  <CardContent>
    <Input placeholder="Name" />
    <Button variant="outline">Submit</Button>
  </CardContent>
</Card>
```

### Responsive Design

```tsx
// ✅ Good - mobile-first responsive
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {contacts.map((contact) => (
    <ContactCard key={contact.id} contact={contact} />
  ))}
</div>
```

## Error Handling

### Error Boundaries

```tsx
// app/error.tsx
'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
      <p className="text-gray-600 mb-4">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 bg-blue-500 text-white rounded">
        Try again
      </button>
    </div>
  )
}
```

### Loading States

```tsx
// app/contacts/loading.tsx
export default function Loading() {
  return <Spinner />
}
```

### Not Found Pages

```tsx
// app/contacts/[id]/not-found.tsx
export default function NotFound() {
  return (
    <div>
      <h2>Contact Not Found</h2>
      <Link href="/contacts">Back to Contacts</Link>
    </div>
  )
}
```

## Accessibility

### Semantic HTML

```tsx
// ✅ Good
<button onClick={handleClick}>Click me</button>
<nav>...</nav>
<main>...</main>
<article>...</article>

// ❌ Bad
<div onClick={handleClick}>Click me</div>
```

### ARIA Labels

```tsx
// ✅ Good
<button aria-label="Close dialog" onClick={onClose}>
  <X />
</button>

<input
  type="text"
  aria-label="Search contacts"
  placeholder="Search..."
/>
```

### Keyboard Navigation

```tsx
// ✅ Good - handle keyboard events
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleClick()
    }
  }}
>
  Click me
</div>
```

## Critical Rules for AI Agents

1. **Server Components by default** - Only use 'use client' when necessary
2. **Separate server and UI state** - TanStack Query for server, Zustand for UI
3. **Always use React Hook Form + Zod** - No manual form validation
4. **Use shadcn/ui components** - Don't reinvent the wheel
5. **Optimize performance** - Use React.memo, useMemo, useCallback appropriately
6. **Lazy load heavy components** - Use React.lazy + Suspense
7. **Use Next.js Image component** - Never use regular img tags
8. **Handle loading and error states** - Use loading.tsx and error.tsx
9. **Accessibility is mandatory** - Semantic HTML, ARIA labels, keyboard navigation
10. **Mobile-first responsive design** - Use Tailwind responsive utilities
