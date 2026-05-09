# Prisma ORM Rules

## Schema Design

### Model Naming Conventions

```prisma
// ✅ Good - PascalCase singular
model Contact {
  id        String   @id @default(uuid())
  email     String   @unique
  firstName String
  lastName  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// ❌ Bad - plural or snake_case
model contacts {
  contact_id String @id
}
```

### Field Naming Conventions

```prisma
// ✅ Good - camelCase
model Contact {
  firstName String
  lastName  String
  createdAt DateTime
}

// ❌ Bad - snake_case
model Contact {
  first_name String
  last_name  String
  created_at DateTime
}
```

### Use Appropriate Field Types

```prisma
model Contact {
  id        String   @id @default(uuid())  // UUID for distributed systems
  email     String   @unique
  age       Int?                            // Optional integer
  salary    Decimal                         // Use Decimal for money
  isActive  Boolean  @default(true)
  metadata  Json?                           // JSON for flexible data
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## Relations

### One-to-Many Relation

```prisma
model Contact {
  id    String @id @default(uuid())
  name  String
  deals Deal[]  // One contact has many deals
}

model Deal {
  id        String  @id @default(uuid())
  title     String
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([contactId])
}
```

### Many-to-Many Relation

```prisma
// ✅ Good - explicit join table
model Contact {
  id   String @id @default(uuid())
  name String
  tags ContactTag[]
}

model Tag {
  id       String       @id @default(uuid())
  name     String       @unique
  contacts ContactTag[]
}

model ContactTag {
  contactId String
  tagId     String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([contactId, tagId])
  @@index([contactId])
  @@index([tagId])
}
```

### Relation Actions

```prisma
model Deal {
  id        String  @id @default(uuid())
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  // onDelete: Cascade - Delete deals when contact is deleted
  // onDelete: SetNull - Set contactId to null when contact is deleted
  // onDelete: Restrict - Prevent contact deletion if deals exist
}
```

## Multi-tenancy

### Tenant Isolation Pattern

```prisma
model Contact {
  id        String   @id @default(uuid())
  tenantId  String   // Tenant isolation
  email     String
  name      String
  createdAt DateTime @default(now())

  @@unique([tenantId, email]) // Email unique per tenant
  @@index([tenantId])         // Index for tenant queries
}

model Deal {
  id        String   @id @default(uuid())
  tenantId  String
  contactId String
  title     String

  @@index([tenantId])
  @@index([contactId])
}
```

### Always Filter by Tenant

```typescript
// ✅ Good - always include tenantId
async findAll(tenantId: string): Promise<Contact[]> {
  return this.prisma.contact.findMany({
    where: { tenantId }
  });
}

// ❌ Bad - missing tenant filter (security risk!)
async findAll(): Promise<Contact[]> {
  return this.prisma.contact.findMany();
}
```

## Indexes

### Add Indexes for Frequently Queried Fields

```prisma
model Contact {
  id        String   @id @default(uuid())
  tenantId  String
  email     String
  firstName String
  lastName  String
  createdAt DateTime @default(now())

  @@index([tenantId])              // Tenant queries
  @@index([email])                 // Email lookups
  @@index([tenantId, createdAt])   // Tenant + date range queries
  @@index([firstName, lastName])   // Name searches
}
```

### Composite Indexes for Common Queries

```prisma
model Deal {
  id        String     @id @default(uuid())
  tenantId  String
  status    DealStatus
  createdAt DateTime   @default(now())

  @@index([tenantId, status])           // Filter by tenant and status
  @@index([tenantId, createdAt(sort: Desc)]) // Recent deals per tenant
}
```

## Enums

### Define Enums in Schema

```prisma
enum DealStatus {
  OPEN
  IN_PROGRESS
  WON
  LOST
}

enum UserRole {
  ADMIN
  MANAGER
  SALES_REP
}

model Deal {
  id     String     @id @default(uuid())
  status DealStatus @default(OPEN)
}

model User {
  id   String   @id @default(uuid())
  role UserRole @default(SALES_REP)
}
```

## Query Patterns

### Select Only Needed Fields

```typescript
// ✅ Good - select specific fields
const contacts = await prisma.contact.findMany({
  select: {
    id: true,
    name: true,
    email: true,
  },
});

// ❌ Bad - fetches all fields
const contacts = await prisma.contact.findMany();
```

### Use Include for Relations

```typescript
// ✅ Good - include related data
const contact = await prisma.contact.findUnique({
  where: { id },
  include: {
    deals: true,
    activities: {
      orderBy: { createdAt: "desc" },
      take: 10,
    },
  },
});
```

### Pagination

```typescript
// ✅ Good - cursor-based pagination (preferred)
async findAll(cursor?: string, limit = 20) {
  return prisma.contact.findMany({
    take: limit,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { createdAt: 'desc' }
  });
}

// ✅ Good - offset-based pagination (simpler)
async findAll(page = 1, limit = 20) {
  return prisma.contact.findMany({
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { createdAt: 'desc' }
  });
}
```

### Filtering and Sorting

```typescript
// ✅ Good - dynamic filtering
async findAll(filters: ContactFilters) {
  return prisma.contact.findMany({
    where: {
      tenantId: filters.tenantId,
      email: filters.email ? { contains: filters.email } : undefined,
      createdAt: filters.dateFrom ? { gte: filters.dateFrom } : undefined
    },
    orderBy: { [filters.sortBy]: filters.sortOrder }
  });
}
```

## Transactions

### Use Transactions for Multi-table Operations

```typescript
// ✅ Good - transaction ensures atomicity
async createDealWithActivities(data: CreateDealDto) {
  return this.prisma.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: {
        title: data.title,
        contactId: data.contactId,
        tenantId: data.tenantId
      }
    });

    await tx.activity.create({
      data: {
        type: 'DEAL_CREATED',
        dealId: deal.id,
        tenantId: data.tenantId
      }
    });

    return deal;
  });
}
```

### Interactive Transactions

```typescript
// ✅ Good - complex transaction logic
async transferDeal(dealId: string, fromUserId: string, toUserId: string) {
  return this.prisma.$transaction(async (tx) => {
    // Check deal exists and belongs to fromUser
    const deal = await tx.deal.findFirst({
      where: { id: dealId, assignedTo: fromUserId }
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    // Update deal assignment
    await tx.deal.update({
      where: { id: dealId },
      data: { assignedTo: toUserId }
    });

    // Log activity
    await tx.activity.create({
      data: {
        type: 'DEAL_TRANSFERRED',
        dealId,
        fromUserId,
        toUserId
      }
    });
  });
}
```

## Error Handling

### Handle Prisma Errors

```typescript
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

async create(data: CreateContactDto) {
  try {
    return await this.prisma.contact.create({ data });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError) {
      // Unique constraint violation
      if (error.code === 'P2002') {
        throw new ConflictException('Email already exists');
      }
      // Record not found
      if (error.code === 'P2025') {
        throw new NotFoundException('Contact not found');
      }
      // Foreign key constraint violation
      if (error.code === 'P2003') {
        throw new BadRequestException('Invalid reference');
      }
    }
    throw error;
  }
}
```

### Common Prisma Error Codes

- **P2002**: Unique constraint violation
- **P2003**: Foreign key constraint violation
- **P2025**: Record not found
- **P2014**: Relation violation
- **P2034**: Transaction conflict

## Migrations

### Migration Best Practices

```bash
# Create migration
npx prisma migrate dev --name add_contact_table

# Apply migrations in production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### Migration Naming

```
20260505120000_add_contact_table
20260505130000_add_tenant_isolation
20260505140000_add_deal_status_enum
```

### Handle Breaking Changes

```prisma
// Step 1: Add new field as optional
model Contact {
  email    String  @unique
  newEmail String? // Add as optional first
}

// Step 2: Migrate data (custom migration)
// Step 3: Make field required
model Contact {
  email    String  @unique
  newEmail String  // Now required
}

// Step 4: Remove old field
model Contact {
  newEmail String @unique
}
```

## Performance Optimization

### Use Connection Pooling

```typescript
// prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: ["query", "error", "warn"],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### Avoid N+1 Queries

```typescript
// ❌ Bad - N+1 query problem
const contacts = await prisma.contact.findMany();
for (const contact of contacts) {
  const deals = await prisma.deal.findMany({
    where: { contactId: contact.id },
  });
}

// ✅ Good - single query with include
const contacts = await prisma.contact.findMany({
  include: {
    deals: true,
  },
});
```

### Use Batch Operations

```typescript
// ✅ Good - batch create
await prisma.contact.createMany({
  data: [
    { name: "John", email: "john@example.com", tenantId },
    { name: "Jane", email: "jane@example.com", tenantId },
  ],
  skipDuplicates: true,
});

// ✅ Good - batch update
await prisma.contact.updateMany({
  where: { tenantId, isActive: false },
  data: { status: "ARCHIVED" },
});
```

## Raw Queries (Use Sparingly)

### When to Use Raw SQL

- Complex queries not supported by Prisma
- Performance-critical queries
- Database-specific features

### Raw Query Pattern

```typescript
// ✅ Good - parameterized query
const contacts = await this.prisma.$queryRaw<Contact[]>`
  SELECT * FROM "Contact"
  WHERE "tenantId" = ${tenantId}
  AND "createdAt" > ${dateFrom}
  ORDER BY "createdAt" DESC
  LIMIT ${limit}
`;

// ❌ Bad - SQL injection risk!
const contacts = await this.prisma.$queryRawUnsafe(
  `SELECT * FROM Contact WHERE email = '${email}'`,
);
```

## Testing with Prisma

### Use Test Database

```typescript
// test/setup.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_TEST,
    },
  },
});

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean database before each test
  await prisma.contact.deleteMany();
  await prisma.deal.deleteMany();
});
```

### Use @testcontainers for Integration Tests

```typescript
import { PostgreSqlContainer } from "@testcontainers/postgresql";

let container: PostgreSqlContainer;
let prisma: PrismaClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer().start();

  process.env.DATABASE_URL = container.getConnectionUri();

  prisma = new PrismaClient();
  await prisma.$connect();

  // Run migrations
  execSync("npx prisma migrate deploy");
});

afterAll(async () => {
  await prisma.$disconnect();
  await container.stop();
});
```

## Critical Rules for AI Agents

1. **Always filter by tenantId** - Multi-tenancy security is critical
2. **Use transactions** - For operations affecting multiple tables
3. **Handle Prisma errors** - Convert to application exceptions
4. **Add indexes** - For frequently queried fields
5. **Select only needed fields** - Avoid fetching unnecessary data
6. **Use include for relations** - Avoid N+1 queries
7. **Implement pagination** - Never fetch all records
8. **Use enums** - For fixed sets of values
9. **Parameterize raw queries** - Prevent SQL injection
10. **Test with real database** - Use @testcontainers, not mocks
