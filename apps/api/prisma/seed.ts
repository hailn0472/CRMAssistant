/**
 * Prisma Seed Script
 *
 * Creates sample tenant and user data for local development.
 * Uses upsert (idempotent) — safe to run multiple times without creating duplicates.
 *
 * Run with: pnpm --filter=api prisma:seed
 *   or via Prisma seed config: npx prisma db seed
 *
 * IMPORTANT: Do not use real credentials or production PII here.
 * Auth fields (passwords, etc.) belong in Story 1.7.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  console.log('🌱 Seeding database...')

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

  // ── Seed Users for Acme Corp ───────────────────────────────────────────────
  // Note: email is unique per tenant — same email can exist in different tenants (Story 1.6 AC #3).
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
      name: 'Acme Admin',
      createdBy: 'system',
      updatedBy: 'system',
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
      name: 'Acme Sales Rep',
      createdBy: 'system',
      updatedBy: 'system',
    },
  })

  // ── Seed Users for Beta Inc ────────────────────────────────────────────────
  // Demonstrates same email in a different tenant is allowed (AC #3, #9)
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
      name: 'Beta Admin',
      createdBy: 'system',
      updatedBy: 'system',
    },
  })

  console.log(
    `✅ Users seeded: "${acmeAdmin.name}" (Acme), "${acmeSales.name}" (Acme), "${betaAdmin.name}" (Beta)`,
  )

  // ── Demonstrate tenant-filtered query ─────────────────────────────────────
  const acmeUsersOnly = await prisma.user.findMany({
    where: { tenantId: acmeTenant.id },
    select: { id: true, email: true, name: true },
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
