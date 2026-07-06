/**
 * Prisma Seed Script
 *
 * Creates sample tenant, user, and role data for local development.
 * Uses upsert (idempotent) — safe to run multiple times without creating duplicates.
 *
 * Run with: pnpm --filter=api prisma:seed
 *   or: pnpm --filter=api prisma:seed
 *
 * IMPORTANT: Do not use real credentials or production PII here.
 * Auth fields (passwords, etc.) belong in Story 1.7.
 *
 * Story 2.2: Seeds system roles per tenant, assigns users to roles.
 */

import { PrismaClient } from '@prisma/client'
import { DEFAULT_ROLE_PERMISSIONS as DEFAULT_ROLE_PERMISSIONS_SHARED } from '../src/permissions/default-role-permissions'

const prisma = new PrismaClient()

const RESOURCES = [
  'CONTACT',
  'DEAL',
  'TASK',
  'TICKET',
  'REPORT',
  'USER',
  'ROLE',
  'SETTINGS',
] as const
const ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'ASSIGN'] as const

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
  return catalog
}

const SEED_PERMISSIONS = buildPermissionCatalog()

// Seed-specific override: ADMIN gets all 56 permissions in dev seed (not needed in production
// auth.service.ts because ADMIN bypasses permission checks in code).
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
    select: { id: true, tenantId: true, name: true, _count: { select: { rolePermissions: true } } },
  })

  for (const role of roles) {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role.name]
    if (!defaults || defaults.length === 0) continue

    // Idempotent: only seed if role has no permissions yet
    if (role._count.rolePermissions > 0) continue

    const permissionIds: string[] = []
    for (const permDef of defaults) {
      const key = `${permDef.resource}:${permDef.action}`
      const perm = permMap[key]
      if (perm) {
        permissionIds.push(perm)
      }
    }

    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((pid) => ({
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

    const permissionIds: string[] = []
    for (const permDef of defaults) {
      const key = `${permDef.resource}:${permDef.action}`
      const perm = permMap[key]
      if (perm) {
        permissionIds.push(perm)
      }
    }

    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((pid) => ({
          roleId: role.id,
          permissionId: pid,
        })),
      })
    }
  }
}

export { seedPermissions, seedRolePermissions, seedRolePermissionsForTenant }

const SYSTEM_ROLES = [
  { name: 'ADMIN', description: 'Full system access', isSystem: true },
  { name: 'SALES_MANAGER', description: 'Sales team manager', isSystem: true },
  { name: 'SALES_REP', description: 'Sales representative', isSystem: true },
  { name: 'SUPPORT_AGENT', description: 'Customer support agent', isSystem: true },
  { name: 'MARKETING_USER', description: 'Marketing team member', isSystem: true },
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

async function main(): Promise<void> {
  console.log('🌱 Seeding database...')

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

  // ── Seed Users for Acme Corp ───────────────────────────────────────────────
  const acmeAdmin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: acmeTenant.id,
        email: 'admin@example.com',
      },
    },
    update: {},
    create: {
      tenantId: acmeTenant.id,
      email: 'admin@example.com',
      firstName: 'Acme',
      lastName: 'Admin',
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  const acmeSales = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: acmeTenant.id,
        email: 'sales@example.com',
      },
    },
    update: {},
    create: {
      tenantId: acmeTenant.id,
      email: 'sales@example.com',
      firstName: 'Acme',
      lastName: 'Sales Rep',
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  // ── Seed Users for Beta Inc ────────────────────────────────────────────────
  const betaAdmin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: betaTenant.id,
        email: 'admin@example.com', // Same email, different tenant — valid!
      },
    },
    update: {},
    create: {
      tenantId: betaTenant.id,
      email: 'admin@example.com',
      firstName: 'Beta',
      lastName: 'Admin',
      createdBy: 'seed',
      updatedBy: 'seed',
    },
  })

  console.log(
    `✅ Users seeded: "${acmeAdmin.firstName} ${acmeAdmin.lastName}" (Acme), "${acmeSales.firstName} ${acmeSales.lastName}" (Acme), "${betaAdmin.firstName} ${betaAdmin.lastName}" (Beta)`,
  )

  // ── Assign roles to users ──────────────────────────────────────────────────
  await assignRoleIfMissing(acmeAdmin.id, acmeRoles['ADMIN'])
  await assignRoleIfMissing(acmeSales.id, acmeRoles['SALES_REP'])
  await assignRoleIfMissing(betaAdmin.id, betaRoles['ADMIN'])

  console.log('✅ Roles assigned to users')

  // ── Demonstrate tenant-filtered query ─────────────────────────────────────
  const acmeUsersOnly = await prisma.user.findMany({
    where: { tenantId: acmeTenant.id },
    select: { id: true, email: true, firstName: true, lastName: true },
  })

  console.log(
    `ℹ️  Acme tenant has ${acmeUsersOnly.length} user(s): ${JSON.stringify(acmeUsersOnly.map((u) => u.email))}`,
  )

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
