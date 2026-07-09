/**
 * Seed default admin account.
 *
 * Creates (or skips if exists) a Supabase Auth user + DB User with ADMIN role.
 * Requires SUPABASE_SERVICE_ROLE_KEY — run via infisical:
 *
 *   infisical run --env=dev --path=/apps/api -- npx ts-node prisma/seed-admin.ts
 */
import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'Admin@123456'
const ADMIN_FIRST_NAME = 'System'
const ADMIN_LAST_NAME = 'Admin'
const TENANT_NAME = 'Default Workspace'

async function main(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL']
  const supabaseServiceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  const databaseUrl = process.env['DATABASE_URL']

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    process.exit(1)
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  })

  // 1. Ensure tenant exists
  let tenant = await prisma.tenant.findFirst({ where: { name: TENANT_NAME } })
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } })
    console.log(`✅ Tenant created: "${tenant.name}" (${tenant.id})`)
  } else {
    console.log(`ℹ️  Tenant exists: "${tenant.name}" (${tenant.id})`)
  }

  // 2. Check if admin user already exists in DB
  const existingUser = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: ADMIN_EMAIL, deletedAt: null },
  })

  if (existingUser) {
    console.log(`ℹ️  Admin DB user exists: ${existingUser.email}`)
  } else {
    // 3. Create Supabase Auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    })

    if (authError) {
      if (authError.message?.includes('already been registered')) {
        console.log('ℹ️  Supabase Auth user already exists, looking up...')
      } else {
        console.error('❌ Supabase Auth error:', authError.message)
        process.exit(1)
      }
    }

    let supabaseUserId = authData?.user?.id

    // If already registered, find by email
    if (!supabaseUserId) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers()
      const found = users?.users?.find((u) => u.email === ADMIN_EMAIL)
      supabaseUserId = found?.id
    }

    if (!supabaseUserId) {
      console.error('❌ Could not find or create Supabase Auth user')
      process.exit(1)
    }

    // 4. Create DB User + assign ADMIN role
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: tenant!.id,
          email: ADMIN_EMAIL,
          firstName: ADMIN_FIRST_NAME,
          lastName: ADMIN_LAST_NAME,
          isActive: true,
          supabaseUserId,
          createdBy: 'seed',
          updatedBy: 'seed',
        },
      })

      // Assign ADMIN role (create if doesn't exist)
      let adminRole = await tx.role.findFirst({
        where: { tenantId: tenant!.id, name: 'ADMIN', deletedAt: null },
      })
      if (!adminRole) {
        adminRole = await tx.role.create({
          data: {
            tenantId: tenant!.id,
            name: 'ADMIN',
            description: 'Full system access',
            isSystem: true,
            createdBy: 'seed',
            updatedBy: 'seed',
          },
        })
      }

      await tx.userRole.create({
        data: {
          userId: created.id,
          roleId: adminRole.id,
          assignedBy: 'seed',
        },
      })
    })

    console.log(`✅ Admin created:`)
    console.log(`   Email:    ${ADMIN_EMAIL}`)
    console.log(`   Password: ${ADMIN_PASSWORD}`)
    console.log(`   Tenant:   ${TENANT_NAME} (${tenant!.id})`)
  }

  await prisma.$disconnect()
}

main().catch((e: unknown) => {
  console.error('❌ Seed failed:', e)
  process.exit(1)
})
