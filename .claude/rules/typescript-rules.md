# Language-Specific Rules (TypeScript)

## TypeScript Configuration Requirements

### tsconfig.json strict mode settings

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Critical Rules

- **NEVER use `any` type** - use `unknown` if type is truly unknown
- **NEVER use `@ts-ignore`** - fix the type error instead
- **NEVER use `as any` casting** - find the proper type
- **Always provide explicit return types for functions**
- **Use `const` by default**, `let` only when reassignment needed, never `var`

## Import/Export Patterns

### Import Order (enforced by ESLint)

```typescript
// 1. External dependencies (node_modules)
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// 2. Internal absolute imports (workspace packages)
import { ContactService } from '@/contacts/contact.service';
import { validateEmail } from '@/utils/validation';

// 3. Relative imports (same module)
import { CreateContactDto } from './dto/create-contact.dto';
import { ContactRepository } from './contact.repository';

// 4. Type-only imports (separate group)
import type { Contact } from '@prisma/client';
import type { User } from '@/types';
```

### Export Patterns

- **Use named exports by default**: `export const myFunction = () => {}`
- **Use default export only for**: React components and main module entry
- **Avoid `export default`** for utilities and services
- **Group exports** at bottom of file when exporting multiple items

### Path Aliases

```typescript
// Use @ for workspace root
import { ContactService } from '@/contacts/contact.service';

// Use @packages for shared packages
import { validateEmail } from '@packages/utils';
```

## Type Safety Patterns

### Prefer Type Inference

```typescript
// ✅ Good - type inferred
const count = 10;
const name = 'John';

// ❌ Bad - unnecessary annotation
const count: number = 10;
```

### Explicit Types for Function Signatures

```typescript
// ✅ Good - explicit return type
function getContact(id: string): Promise<Contact | null> {
  return prisma.contact.findUnique({ where: { id } });
}

// ❌ Bad - implicit return type
function getContact(id: string) {
  return prisma.contact.findUnique({ where: { id } });
}
```

### Use Discriminated Unions for Complex Types

```typescript
// ✅ Good
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ❌ Bad
type Result<T> = {
  success: boolean;
  data?: T;
  error?: string;
};
```

### Use `unknown` Instead of `any`

```typescript
// ✅ Good
function processData(data: unknown): string {
  if (typeof data === 'string') {
    return data.toUpperCase();
  }
  throw new Error('Invalid data type');
}

// ❌ Bad
function processData(data: any): string {
  return data.toUpperCase(); // No type safety
}
```

## Error Handling Patterns

### Use Custom Error Classes

```typescript
// Define custom errors
export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(
    message: string,
    public resource: string,
    public id: string
  ) {
    super(message);
    this.name = 'NotFoundError';
  }
}
```

### Throw Typed Errors

```typescript
// ✅ Good
if (!contact) {
  throw new NotFoundError('Contact not found', 'Contact', id);
}

// ❌ Bad
if (!contact) {
  throw new Error('Contact not found');
}
```

### Handle Errors with Type Guards

```typescript
// ✅ Good
try {
  await createContact(data);
} catch (error) {
  if (error instanceof ValidationError) {
    return { error: error.message, field: error.field };
  }
  if (error instanceof NotFoundError) {
    return { error: error.message, resource: error.resource };
  }
  // Unknown error
  throw error;
}

// ❌ Bad
try {
  await createContact(data);
} catch (error: any) {
  return { error: error.message };
}
```

### Use Result Type for Expected Errors

```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

async function createContact(
  data: CreateContactDto
): Promise<Result<Contact, ValidationError>> {
  // Validation
  if (!validateEmail(data.email)) {
    return {
      ok: false,
      error: new ValidationError('Invalid email', 'email', data.email)
    };
  }

  // Success
  const contact = await prisma.contact.create({ data });
  return { ok: true, value: contact };
}
```

## Async/Await Patterns

### Always Use async/await Over Promises

```typescript
// ✅ Good
async function getContacts(): Promise<Contact[]> {
  const contacts = await prisma.contact.findMany();
  return contacts;
}

// ❌ Bad
function getContacts(): Promise<Contact[]> {
  return prisma.contact.findMany().then(contacts => contacts);
}
```

### Handle Errors with try/catch

```typescript
// ✅ Good
async function createContact(data: CreateContactDto): Promise<Contact> {
  try {
    return await prisma.contact.create({ data });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ValidationError('Email already exists', 'email', data.email);
      }
    }
    throw error;
  }
}
```

### Use Promise.all for Parallel Operations

```typescript
// ✅ Good - parallel
const [contacts, deals] = await Promise.all([
  prisma.contact.findMany(),
  prisma.deal.findMany()
]);

// ❌ Bad - sequential
const contacts = await prisma.contact.findMany();
const deals = await prisma.deal.findMany();
```

## Null Safety

### Use Optional Chaining

```typescript
// ✅ Good
const email = user?.contact?.email;

// ❌ Bad
const email = user && user.contact && user.contact.email;
```

### Use Nullish Coalescing

```typescript
// ✅ Good
const pageSize = query.pageSize ?? 20;

// ❌ Bad
const pageSize = query.pageSize || 20; // Fails for 0
```

### Avoid null, Prefer undefined

```typescript
// ✅ Good
function getContact(id: string): Contact | undefined {
  return contacts.find(c => c.id === id);
}

// ❌ Bad
function getContact(id: string): Contact | null {
  return contacts.find(c => c.id === id) || null;
}
```

## Type Utilities

### Use Built-in Utility Types

```typescript
// Partial - make all properties optional
type UpdateContactDto = Partial<CreateContactDto>;

// Pick - select specific properties
type ContactSummary = Pick<Contact, 'id' | 'name' | 'email'>;

// Omit - exclude specific properties
type ContactWithoutDates = Omit<Contact, 'createdAt' | 'updatedAt'>;

// Required - make all properties required
type RequiredContact = Required<Partial<Contact>>;

// Record - create object type with specific keys
type ContactMap = Record<string, Contact>;
```

### Create Custom Utility Types

```typescript
// Make specific fields required
type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Example usage
type ContactWithEmail = RequireFields<Partial<Contact>, 'email'>;
```

## Enums vs Union Types

### Prefer Const Objects Over Enums

```typescript
// ✅ Good - const object
export const DealStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WON: 'WON',
  LOST: 'LOST'
} as const;

export type DealStatus = typeof DealStatus[keyof typeof DealStatus];

// ❌ Bad - enum (generates runtime code)
export enum DealStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WON = 'WON',
  LOST = 'LOST'
}
```

### Use String Literal Unions for Simple Cases

```typescript
// ✅ Good
type Status = 'pending' | 'approved' | 'rejected';

// ❌ Bad - unnecessary enum
enum Status {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected'
}
```

## Performance Considerations

### Avoid Expensive Type Operations in Hot Paths

```typescript
// ✅ Good - compute type once
type ContactKeys = keyof Contact;
const keys: ContactKeys[] = ['id', 'name', 'email'];

// ❌ Bad - recompute on every iteration
contacts.forEach(contact => {
  const keys: (keyof Contact)[] = Object.keys(contact);
});
```

### Use Type Assertions Sparingly

```typescript
// ✅ Good - validate before asserting
function isContact(obj: unknown): obj is Contact {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'email' in obj
  );
}

if (isContact(data)) {
  // TypeScript knows data is Contact
  console.log(data.email);
}

// ❌ Bad - unsafe assertion
const contact = data as Contact;
console.log(contact.email); // Runtime error if data is not Contact
```

## Critical Rules for AI Agents

1. **Type safety is non-negotiable** - No `any`, no `@ts-ignore`, no unsafe casts
2. **Explicit function return types** - Always declare what functions return
3. **Use discriminated unions** - Better than optional properties for complex types
4. **Custom error classes** - Typed errors enable better error handling
5. **async/await over Promises** - More readable and easier to debug
6. **Optional chaining and nullish coalescing** - Modern null safety patterns
7. **Prefer const objects over enums** - Less runtime overhead
8. **Type guards for runtime validation** - Bridge compile-time and runtime safety
9. **Result types for expected errors** - Make error handling explicit
10. **Import order matters** - Enforced by ESLint, keeps code organized
