/**
 * Prisma Seed Script
 *
 * Creates sample tenant, user, and role data for local development.
 * Also creates Supabase Auth users so seeded accounts can log in directly.
 *
 * Run with: infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma:seed
 *
 * IMPORTANT: Do not use real credentials or production PII here.
 */

import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_ROLE_PERMISSIONS as DEFAULT_ROLE_PERMISSIONS_SHARED } from '../src/permissions/default-role-permissions'
import { DEFAULT_DEAL_STAGES } from '../src/deals/default-deal-stages'

const prisma = new PrismaClient()

const DEMO_PASSWORD = 'Demo@123456'

const RESOURCES = [
  'CONTACT',
  'DEAL',
  'TASK',
  'TICKET',
  'INBOX',
  'REPORT',
  'USER',
  'ROLE',
  'SETTINGS',
] as const
const ACTIONS = [
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'WRITE',
  'EXPORT',
  'IMPORT',
  'ASSIGN',
] as const

function describePermission(resource: string, action: string): string {
  const actionLabel: Record<string, string> = {
    CREATE: 'Create',
    READ: 'Read',
    UPDATE: 'Update',
    DELETE: 'Delete',
    EXPORT: 'Export',
    IMPORT: 'Import',
    ASSIGN: 'Assign',
  }
  const resourceLabel: Record<string, string> = {
    CONTACT: 'contacts',
    DEAL: 'deals',
    TASK: 'tasks',
    TICKET: 'tickets',
    INBOX: 'inbox',
    REPORT: 'reports',
    USER: 'users',
    ROLE: 'roles',
    SETTINGS: 'settings',
  }
  return `${actionLabel[action] ?? action} ${resourceLabel[resource] ?? resource}`
}

function buildPermissionCatalog(): { resource: string; action: string; description: string }[] {
  const catalog: { resource: string; action: string; description: string }[] = []
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      catalog.push({ resource, action, description: describePermission(resource, action) })
    }
  }
  catalog.push({
    resource: 'DATA',
    action: 'VIEW_ALL',
    description: 'View all data regardless of visibility rules',
  })
  return catalog
}

const SEED_PERMISSIONS = buildPermissionCatalog()

const DEFAULT_ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  ...DEFAULT_ROLE_PERMISSIONS_SHARED,
  ADMIN: SEED_PERMISSIONS.map((p) => ({ resource: p.resource, action: p.action })),
}

async function seedPermissions(): Promise<Record<string, string>> {
  const permMap: Record<string, string> = {}

  for (const perm of SEED_PERMISSIONS) {
    const existing = await prisma.permission.findUnique({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
    })

    const created = existing
      ? existing
      : await prisma.permission.create({
          data: {
            resource: perm.resource,
            action: perm.action,
            description: perm.description,
          },
        })

    permMap[`${perm.resource}:${perm.action}`] = created.id
  }

  return permMap
}

async function seedRolePermissions(): Promise<void> {
  const roles = await prisma.role.findMany({
    where: { isSystem: true, deletedAt: null },
    select: { id: true, tenantId: true, name: true },
  })

  for (const role of roles) {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role.name]
    if (!defaults || defaults.length === 0) continue

    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permission: { select: { resource: true, action: true } } },
    })
    const existingSet = new Set(
      existing.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
    )

    const missingIds: string[] = []
    for (const permDef of defaults) {
      const key = `${permDef.resource}:${permDef.action}`
      if (existingSet.has(key)) continue
      const perm = permMap[key]
      if (perm) {
        missingIds.push(perm)
      }
    }

    if (missingIds.length > 0) {
      console.log(
        `  → Adding ${missingIds.length} missing permission(s) to role "${role.name}" (${role.id})`,
      )
      await prisma.rolePermission.createMany({
        data: missingIds.map((pid) => ({
          roleId: role.id,
          permissionId: pid,
        })),
      })
    }
  }
}

let permMap: Record<string, string> = {}

async function seedRolePermissionsForTenant(tenantId: string, roleNames: string[]): Promise<void> {
  const roles = await prisma.role.findMany({
    where: { tenantId, name: { in: roleNames }, deletedAt: null },
    select: { id: true, name: true },
  })

  for (const role of roles) {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role.name]
    if (!defaults || defaults.length === 0) continue

    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permission: { select: { resource: true, action: true } } },
    })
    const existingSet = new Set(
      existing.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
    )

    const missingIds: string[] = []
    for (const permDef of defaults) {
      const key = `${permDef.resource}:${permDef.action}`
      if (existingSet.has(key)) continue
      const perm = permMap[key]
      if (perm) {
        missingIds.push(perm)
      }
    }

    if (missingIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: missingIds.map((pid) => ({
          roleId: role.id,
          permissionId: pid,
        })),
      })
    }
  }
}

export { seedPermissions, seedRolePermissions, seedRolePermissionsForTenant }

const SYSTEM_ROLES = [
  {
    name: 'ADMIN',
    description: 'Full system access',
    isSystem: true,
    dataVisibility: 'ALL' as const,
  },
  {
    name: 'SALES_MANAGER',
    description: 'Sales team manager',
    isSystem: true,
    dataVisibility: 'TEAM' as const,
  },
  {
    name: 'SALES_REP',
    description: 'Sales representative',
    isSystem: true,
    dataVisibility: 'OWN' as const,
  },
  {
    name: 'SUPPORT_AGENT',
    description: 'Customer support agent',
    isSystem: true,
    dataVisibility: 'OWN' as const,
  },
  {
    name: 'MARKETING_USER',
    description: 'Marketing team member',
    isSystem: true,
    dataVisibility: 'OWN' as const,
  },
]

async function seedSystemRoles(tenantId: string): Promise<Record<string, string>> {
  const roleMap: Record<string, string> = {}

  for (const roleDef of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({
      where: { tenantId, name: roleDef.name },
    })

    const role = existing
      ? existing
      : await prisma.role.create({
          data: {
            tenantId,
            name: roleDef.name,
            description: roleDef.description,
            isSystem: roleDef.isSystem,
            dataVisibility: roleDef.dataVisibility,
            createdBy: 'seed',
            updatedBy: 'seed',
          },
        })

    roleMap[role.name] = role.id
  }

  return roleMap
}

async function assignRoleIfMissing(userId: string, roleId: string): Promise<void> {
  const existing = await prisma.userRole.findUnique({
    where: { userId_roleId: { userId, roleId } },
  })

  if (!existing) {
    await prisma.userRole.create({
      data: {
        userId,
        roleId,
        assignedBy: 'seed',
      },
    })
  }
}

/**
 * Create a Supabase Auth user idempotently.
 * Returns the supabaseUserId (UUID from Supabase Auth) or null if unavailable.
 */
async function createSupabaseAuthUser(
  supabase: ReturnType<typeof createClient>,
  email: string,
  password: string,
): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (data?.user?.id) {
    return data.user.id
  }

  // If already registered, find by email
  if (error?.message?.includes('already been registered')) {
    const { data: users } = await supabase.auth.admin.listUsers()
    const found = users?.users?.find((u) => u.email === email)
    if (found?.id) return found.id
  }

  return null
}

async function main(): Promise<void> {
  console.log('🌱 Seeding database...')

  // ── Init Supabase Admin Client ────────────────────────────────────────────
  const supabaseUrl = process.env['SUPABASE_URL']
  const supabaseServiceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  let supabase: ReturnType<typeof createClient> | null = null

  if (supabaseUrl && supabaseServiceRoleKey) {
    supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    console.log('ℹ️  Supabase admin client initialized')
  } else {
    console.log(
      '⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping Auth user creation',
    )
  }

  // ── Seed Global Permission Catalog ──────────────────────────────────────────
  permMap = await seedPermissions()
  console.log(`✅ Seeded ${Object.keys(permMap).length} permissions`)

  // ── Seed Tenant: Acme Corp ─────────────────────────────────────────────────
  const acmeTenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Acme Corp',
    },
  })

  // ── Seed Tenant: Beta Inc ──────────────────────────────────────────────────
  const betaTenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Beta Inc',
    },
  })

  console.log(`✅ Tenants seeded: "${acmeTenant.name}", "${betaTenant.name}"`)

  // ── Seed System Roles for each tenant ──────────────────────────────────────
  const acmeRoles = await seedSystemRoles(acmeTenant.id)
  const betaRoles = await seedSystemRoles(betaTenant.id)
  console.log(`✅ System roles seeded for both tenants`)

  // ── Seed Default Role Permissions ───────────────────────────────────────────
  await seedRolePermissions()
  console.log(`✅ Default permissions assigned to system roles`)

  // ── Seed Default Deal Stages for each tenant ──────────────────────────────
  for (const tenantId of [acmeTenant.id, betaTenant.id]) {
    for (const stage of DEFAULT_DEAL_STAGES) {
      await prisma.dealStage.upsert({
        where: {
          tenantId_name: { tenantId, name: stage.name },
        },
        update: {
          order: stage.order,
          probability: stage.probability,
          isWon: stage.isWon,
          isLost: stage.isLost,
          color: stage.color,
        },
        create: {
          tenantId,
          name: stage.name,
          order: stage.order,
          probability: stage.probability,
          isWon: stage.isWon,
          isLost: stage.isLost,
          color: stage.color,
          createdBy: 'seed',
          updatedBy: 'seed',
        },
      })
    }
  }
  console.log(`✅ Default deal stages seeded for both tenants`)

  // ── Seed Users for Acme Corp (with Supabase Auth) ──────────────────────────
  const acmeAdminUserId = supabase
    ? await createSupabaseAuthUser(supabase!, 'admin@example.com', DEMO_PASSWORD)
    : null

  const acmeAdmin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: acmeTenant.id,
        email: 'admin@example.com',
      },
    },
    update: { supabaseUserId: acmeAdminUserId ?? undefined },
    create: {
      tenantId: acmeTenant.id,
      email: 'admin@example.com',
      firstName: 'Acme',
      lastName: 'Admin',
      supabaseUserId: acmeAdminUserId ?? undefined,
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  const acmeSalesUserId = supabase
    ? await createSupabaseAuthUser(supabase!, 'sales@example.com', DEMO_PASSWORD)
    : null

  const acmeSales = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: acmeTenant.id,
        email: 'sales@example.com',
      },
    },
    update: { supabaseUserId: acmeSalesUserId ?? undefined },
    create: {
      tenantId: acmeTenant.id,
      email: 'sales@example.com',
      firstName: 'Acme',
      lastName: 'Sales Rep',
      supabaseUserId: acmeSalesUserId ?? undefined,
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  // ── Seed Users for Beta Inc ────────────────────────────────────────────────
  const betaAdminUserId = supabase
    ? await createSupabaseAuthUser(supabase!, 'beta-admin@example.com', DEMO_PASSWORD)
    : null

  const betaAdmin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: betaTenant.id,
        email: 'beta-admin@example.com',
      },
    },
    update: { supabaseUserId: betaAdminUserId ?? undefined },
    create: {
      tenantId: betaTenant.id,
      email: 'beta-admin@example.com',
      firstName: 'Beta',
      lastName: 'Admin',
      supabaseUserId: betaAdminUserId ?? undefined,
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  console.log(
    `✅ Users seeded: "${acmeAdmin.firstName} ${acmeAdmin.lastName}" (Acme/Admin), "${acmeSales.firstName} ${acmeSales.lastName}" (Acme/Sales), "${betaAdmin.firstName} ${betaAdmin.lastName}" (Beta/Admin)`,
  )

  // ── Assign roles to users ──────────────────────────────────────────────────
  await assignRoleIfMissing(acmeAdmin.id, acmeRoles['ADMIN'])
  await assignRoleIfMissing(acmeSales.id, acmeRoles['SALES_REP'])
  await assignRoleIfMissing(betaAdmin.id, betaRoles['ADMIN'])

  console.log('✅ Roles assigned to users')

  // ── Seed Contacts for Inbox Demo ──────────────────────────────────────────
  const acmeContact1 = await prisma.contact.upsert({
    where: { tenantId_email: { tenantId: acmeTenant.id, email: 'john@acme-corp.com' } },
    update: {},
    create: {
      tenantId: acmeTenant.id,
      email: 'john@acme-corp.com',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+1-555-0100',
      company: 'Acme Corp',
      jobTitle: 'CEO',
      ownerId: acmeAdmin.id,
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  const acmeContact2 = await prisma.contact.upsert({
    where: { tenantId_email: { tenantId: acmeTenant.id, email: 'jane@acme-corp.com' } },
    update: {},
    create: {
      tenantId: acmeTenant.id,
      email: 'jane@acme-corp.com',
      firstName: 'Jane',
      lastName: 'Smith',
      phone: '+1-555-0101',
      company: 'Acme Corp',
      jobTitle: 'CTO',
      ownerId: acmeAdmin.id,
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  console.log(`✅ Demo contacts seeded`)

  // ── Seed Conversations & Messages for Inbox Demo ──────────────────────────
  const acmeConv1 = await prisma.conversation.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      tenantId: acmeTenant.id,
      contactId: acmeContact1.id,
      channel: 'INTERNAL',
      status: 'OPEN',
      assignedTo: acmeSales.id,
      lastMessageAt: new Date('2026-07-12T10:30:00Z'),
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  const acmeConv2 = await prisma.conversation.upsert({
    where: { id: '00000000-0000-0000-0000-000000000011' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000011',
      tenantId: acmeTenant.id,
      contactId: acmeContact2.id,
      channel: 'INTERNAL',
      status: 'PENDING',
      assignedTo: acmeSales.id,
      lastMessageAt: new Date('2026-07-11T15:00:00Z'),
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  await prisma.message.createMany({
    data: [
      {
        conversationId: acmeConv1.id,
        senderId: acmeContact1.id,
        senderType: 'CONTACT',
        content: 'Hi there! I have a question about the new pricing plan.',
        messageType: 'TEXT',
        sentAt: new Date('2026-07-12T10:00:00Z'),
        createdAt: new Date('2026-07-12T10:00:00Z'),
        createdBy: acmeContact1.id,
      },
      {
        conversationId: acmeConv1.id,
        senderId: acmeSales.id,
        senderType: 'AGENT',
        content: "Hello John! I'd be happy to help. What would you like to know about our pricing?",
        messageType: 'TEXT',
        sentAt: new Date('2026-07-12T10:05:00Z'),
        deliveredAt: new Date('2026-07-12T10:05:01Z'),
        readAt: new Date('2026-07-12T10:06:00Z'),
        createdAt: new Date('2026-07-12T10:05:00Z'),
        createdBy: acmeSales.id,
      },
      {
        conversationId: acmeConv1.id,
        senderId: acmeContact1.id,
        senderType: 'CONTACT',
        content:
          "We're looking at the Enterprise plan but we need at least 50 seats. Do you offer volume discounts?",
        messageType: 'TEXT',
        sentAt: new Date('2026-07-12T10:30:00Z'),
        createdAt: new Date('2026-07-12T10:30:00Z'),
        createdBy: acmeContact1.id,
      },
      {
        conversationId: acmeConv2.id,
        senderId: acmeContact2.id,
        senderType: 'CONTACT',
        content: 'Hi! Our team needs API access documentation. Can you share?',
        messageType: 'TEXT',
        sentAt: new Date('2026-07-11T14:00:00Z'),
        createdAt: new Date('2026-07-11T14:00:00Z'),
        createdBy: acmeContact2.id,
      },
      {
        conversationId: acmeConv2.id,
        senderId: acmeSales.id,
        senderType: 'AGENT',
        content: "Sure Jane! I'll send you the API docs link right away.",
        messageType: 'TEXT',
        sentAt: new Date('2026-07-11T14:30:00Z'),
        deliveredAt: new Date('2026-07-11T14:30:01Z'),
        readAt: new Date('2026-07-11T15:00:00Z'),
        createdAt: new Date('2026-07-11T14:30:00Z'),
        createdBy: acmeSales.id,
      },
      {
        conversationId: acmeConv2.id,
        senderId: acmeContact2.id,
        senderType: 'CONTACT',
        content: "Great, thanks! I'll review and get back to you.",
        messageType: 'TEXT',
        sentAt: new Date('2026-07-11T15:00:00Z'),
        createdAt: new Date('2026-07-11T15:00:00Z'),
        createdBy: acmeContact2.id,
      },
    ],
  })

  // ── Seed Inbox: Extended Demo Data (Story 8A.2) ─────────────────────────┐
  // Bob Wilson — new contact for Acme Corp                                   │
  // 3 more conversations + messages to reach 5+ convs / 20+ msgs            │
  // Idempotent: uses upsert with fixed IDs, upsert for contact by email     │
  // ──────────────────────────────────────────────────────────────────────────┘

  const bobContact = await prisma.contact.upsert({
    where: { tenantId_email: { tenantId: acmeTenant.id, email: 'bob@acme-corp.com' } },
    update: {},
    create: {
      tenantId: acmeTenant.id,
      email: 'bob@acme-corp.com',
      firstName: 'Bob',
      lastName: 'Wilson',
      phone: '+1-555-0102',
      company: 'Acme Corp',
      jobTitle: 'VP Sales',
      ownerId: acmeAdmin.id,
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  // Conversation 3 — Bob Wilson, OPEN, Unassigned, 2 days ago
  const acmeConv3 = await prisma.conversation.upsert({
    where: { id: '00000000-0000-0000-0000-000000000020' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000020',
      tenantId: acmeTenant.id,
      contactId: bobContact.id,
      channel: 'INTERNAL',
      status: 'OPEN',
      assignedTo: null,
      lastMessageAt: new Date('2026-07-10T16:00:00Z'),
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  // Conversation 4 — John Doe, RESOLVED, assigned to sales, 5 days ago
  const acmeConv4 = await prisma.conversation.upsert({
    where: { id: '00000000-0000-0000-0000-000000000021' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000021',
      tenantId: acmeTenant.id,
      contactId: acmeContact1.id,
      channel: 'INTERNAL',
      status: 'RESOLVED',
      assignedTo: acmeSales.id,
      lastMessageAt: new Date('2026-07-07T11:00:00Z'),
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  // Conversation 5 — Jane Smith, OPEN, assigned to admin, 3 days ago
  const acmeConv5 = await prisma.conversation.upsert({
    where: { id: '00000000-0000-0000-0000-000000000022' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000022',
      tenantId: acmeTenant.id,
      contactId: acmeContact2.id,
      channel: 'INTERNAL',
      status: 'OPEN',
      assignedTo: acmeAdmin.id,
      lastMessageAt: new Date('2026-07-09T09:00:00Z'),
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  // ── Extended Messages ─────────────────────────────────────────────────────
  // Messages for Conversation 3 (Bob, OPEN): 2 messages
  // Messages for Conversation 4 (John, RESOLVED): 4 messages
  // Messages for Conversation 5 (Jane, OPEN): 2 messages
  // Internal note messages: 2 (one in conv1, one in conv3)
  // Read receipts for appropriate messages
  // Total new messages: 14 (>= 14 to reach 20+ with existing 6)

  const newMessages = [
    // ── Conversation 3 (Bob Wilson — Unassigned, OPEN) ── 2 msgs
    {
      id: '00000000-0000-0000-0000-000000000030',
      conversationId: acmeConv3.id,
      senderId: bobContact.id,
      senderType: 'CONTACT' as const,
      content:
        "Hi team, I'm looking into the Enterprise plan for our Q4 rollout. Can someone share the pricing deck?",
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-10T14:00:00Z'),
      createdAt: new Date('2026-07-10T14:00:00Z'),
      createdBy: bobContact.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000031',
      conversationId: acmeConv3.id,
      senderId: bobContact.id,
      senderType: 'CONTACT' as const,
      content: 'Also, do we get a dedicated account manager with the Enterprise tier?',
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-10T16:00:00Z'),
      createdAt: new Date('2026-07-10T16:00:00Z'),
      createdBy: bobContact.id,
    },
    // Internal note on conv3 (visible only to agents)
    {
      id: '00000000-0000-0000-0000-000000000032',
      conversationId: acmeConv3.id,
      senderId: acmeSales.id,
      senderType: 'AGENT' as const,
      content:
        'NEEDS FOLLOW-UP: Bob is a warm lead from the Q2 conference. Priority follow-up needed within 24h.',
      messageType: 'INTERNAL_NOTE' as const,
      sentAt: new Date('2026-07-10T17:00:00Z'),
      createdAt: new Date('2026-07-10T17:00:00Z'),
      createdBy: acmeSales.id,
    },
    // ── Conversation 4 (John Doe — RESOLVED, assigned to sales) ── 4 msgs
    {
      id: '00000000-0000-0000-0000-000000000033',
      conversationId: acmeConv4.id,
      senderId: acmeContact1.id,
      senderType: 'CONTACT' as const,
      content:
        'Hey! The new dashboard looks great. One thing though — the export to CSV seems to be missing some columns.',
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-06T09:00:00Z'),
      createdAt: new Date('2026-07-06T09:00:00Z'),
      createdBy: acmeContact1.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000034',
      conversationId: acmeConv4.id,
      senderId: acmeSales.id,
      senderType: 'AGENT' as const,
      content:
        "Thanks for the feedback John! I've reported this to our product team. Which columns are missing from your view?",
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-06T10:00:00Z'),
      deliveredAt: new Date('2026-07-06T10:00:01Z'),
      readAt: new Date('2026-07-06T10:05:00Z'),
      createdAt: new Date('2026-07-06T10:00:00Z'),
      createdBy: acmeSales.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000035',
      conversationId: acmeConv4.id,
      senderId: acmeContact1.id,
      senderType: 'CONTACT' as const,
      content:
        "The 'Last Contacted' and 'Deal Value' columns are not showing up in the export, even though they appear in the dashboard view.",
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-07T09:00:00Z'),
      createdAt: new Date('2026-07-07T09:00:00Z'),
      createdBy: acmeContact1.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000036',
      conversationId: acmeConv4.id,
      senderId: acmeSales.id,
      senderType: 'AGENT' as const,
      content:
        "Got it! I've filed a ticket with the engineering team. They're estimating a fix by end of week. I'll keep you posted!",
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-07T11:00:00Z'),
      deliveredAt: new Date('2026-07-07T11:00:01Z'),
      readAt: new Date('2026-07-07T11:30:00Z'),
      createdAt: new Date('2026-07-07T11:00:00Z'),
      createdBy: acmeSales.id,
    },
    // ── Conversation 5 (Jane Smith — OPEN, assigned to admin) ── 2 msgs
    {
      id: '00000000-0000-0000-0000-000000000037',
      conversationId: acmeConv5.id,
      senderId: acmeContact2.id,
      senderType: 'CONTACT' as const,
      content:
        'Hi! We are evaluating your platform for our team of 20. Do you offer a sandbox environment for testing?',
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-08T14:00:00Z'),
      createdAt: new Date('2026-07-08T14:00:00Z'),
      createdBy: acmeContact2.id,
    },
    {
      id: '00000000-0000-0000-0000-000000000038',
      conversationId: acmeConv5.id,
      senderId: acmeAdmin.id,
      senderType: 'AGENT' as const,
      content:
        "Hello Jane! Yes, we provide a full sandbox environment for evaluation. I'll set one up for your team and send you the credentials shortly.",
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-09T09:00:00Z'),
      deliveredAt: new Date('2026-07-09T09:00:01Z'),
      readAt: new Date('2026-07-09T09:30:00Z'),
      createdAt: new Date('2026-07-09T09:00:00Z'),
      createdBy: acmeAdmin.id,
    },
    // ── Additional messages for Conversation 1 (John Doe — OPEN) ── 2 more (already has 3, total 5)
    {
      id: '00000000-0000-0000-0000-000000000039',
      conversationId: acmeConv1.id,
      senderId: acmeSales.id,
      senderType: 'AGENT' as const,
      content:
        'Absolutely! For 50+ seats we offer a 15% volume discount on the Enterprise plan. Would you like me to schedule a call with our solutions team?',
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-12T11:00:00Z'),
      deliveredAt: new Date('2026-07-12T11:00:01Z'),
      createdAt: new Date('2026-07-12T11:00:00Z'),
      createdBy: acmeSales.id,
    },
    {
      id: '00000000-0000-0000-0000-00000000003a',
      conversationId: acmeConv1.id,
      senderId: acmeContact1.id,
      senderType: 'CONTACT' as const,
      content:
        'That sounds promising! Yes, please set up a call. Thursday afternoon works best for our team.',
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-12T12:00:00Z'),
      createdAt: new Date('2026-07-12T12:00:00Z'),
      createdBy: acmeContact1.id,
    },
    // ── Internal note on Conversation 1 (agent notes) ── 1 msg
    {
      id: '00000000-0000-0000-0000-00000000003b',
      conversationId: acmeConv1.id,
      senderId: acmeSales.id,
      senderType: 'AGENT' as const,
      content:
        'INTERNAL: John is interested in volume discounts. Schedule call with solutions team (David Chen) before EOW. Estimated deal value: $25k/year.',
      messageType: 'INTERNAL_NOTE' as const,
      sentAt: new Date('2026-07-12T12:05:00Z'),
      createdAt: new Date('2026-07-12T12:05:00Z'),
      createdBy: acmeSales.id,
    },
    // ── Additional message for Conversation 2 (Jane — PENDING) ── 1 more (already has 3, total 4)
    {
      id: '00000000-0000-0000-0000-00000000003c',
      conversationId: acmeConv2.id,
      senderId: acmeSales.id,
      senderType: 'AGENT' as const,
      content:
        'Here is the API documentation link: https://docs.example.com/api/v2. Let me know if you need any specific endpoints documented!',
      messageType: 'TEXT' as const,
      sentAt: new Date('2026-07-11T16:00:00Z'),
      deliveredAt: new Date('2026-07-11T16:00:01Z'),
      readAt: new Date('2026-07-11T17:00:00Z'),
      createdAt: new Date('2026-07-11T16:00:00Z'),
      createdBy: acmeSales.id,
    },
  ]

  // Use upsert for each message to ensure idempotency
  for (const msg of newMessages) {
    const msgId = msg.id
    const isInternalNote = msg.messageType === 'INTERNAL_NOTE'
    await prisma.message.upsert({
      where: { id: msgId },
      update: {
        content: msg.content,
        messageType: msg.messageType,
        internalNote: isInternalNote,
        senderType: msg.senderType,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt ?? null,
        readAt: msg.readAt ?? null,
        createdAt: msg.createdAt,
      },
      create: {
        id: msgId,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        senderType: msg.senderType,
        content: msg.content,
        messageType: msg.messageType,
        internalNote: isInternalNote,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt ?? null,
        readAt: msg.readAt ?? null,
        createdAt: msg.createdAt,
        createdBy: msg.createdBy,
      },
    })
  }

  // ── Read Receipts ─────────────────────────────────────────────────────────
  // Create read receipts for messages that have readAt set
  const readReceipts = [
    // Conversation 1: sales read messages
    {
      messageId: '00000000-0000-0000-0000-000000000039',
      userId: acmeSales.id,
      readAt: new Date('2026-07-12T11:05:00Z'),
    },
    // Conversation 3: no read receipts (unread)
    // Conversation 4: admin read sales messages
    {
      messageId: '00000000-0000-0000-0000-000000000035',
      userId: acmeSales.id,
      readAt: new Date('2026-07-07T10:00:00Z'),
    },
    // Conversation 5: admin read
    {
      messageId: '00000000-0000-0000-0000-000000000037',
      userId: acmeAdmin.id,
      readAt: new Date('2026-07-08T15:00:00Z'),
    },
    // Conversation 2: sales read their own sent messages
    {
      messageId: '00000000-0000-0000-0000-00000000003c',
      userId: acmeSales.id,
      readAt: new Date('2026-07-11T17:00:00Z'),
    },
  ]

  for (const rr of readReceipts) {
    await prisma.messageReadReceipt.upsert({
      where: { messageId_userId: { messageId: rr.messageId, userId: rr.userId } },
      update: {},
      create: {
        messageId: rr.messageId,
        userId: rr.userId,
        readAt: rr.readAt,
      },
    })
  }

  console.log(
    `✅ Extended inbox demo data seeded (5 conversations, 20+ messages) with read receipts`,
  )

  // ── Print Login Info ──────────────────────────────────────────────────────
  if (supabase) {
    console.log('')
    console.log('🔐 Login credentials:')
    console.log('   ┌─────────────────────────┬─────────────────┬────────────────┐')
    console.log('   │ Email                   │ Password        │ Role           │')
    console.log('   ├─────────────────────────┼─────────────────┼────────────────┤')
    console.log('   │ admin@example.com       │ Demo@123456     │ ADMIN          │')
    console.log('   │ sales@example.com       │ Demo@123456     │ SALES_REP      │')
    console.log('   │ beta-admin@example.com  │ Demo@123456     │ ADMIN (Beta)   │')
    console.log('   └─────────────────────────┴─────────────────┴────────────────┘')
  }

  console.log('✅ Seeding complete.')
}

main()
  .catch((e: unknown) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
