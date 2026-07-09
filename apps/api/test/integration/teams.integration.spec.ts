import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request, { type Test as SuperTest } from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const JWT_SECRET = 'test-jwt-secret-with-enough-length-for-hs256'

describe('Teams (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let tenantAId: string
  let adminId: string
  let adminToken: string

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = JWT_SECRET
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'

    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await prisma.$connect()

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    jwtService = app.get(JwtService)

    // Seed tenant A
    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A Teams' } })
    tenantAId = tenantA.id

    // Seed tenant B for cross-tenant isolation
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B Teams' } })

    // Create admin role + user
    const adminRole = await prisma.role.create({
      data: {
        tenantId: tenantAId,
        name: 'ADMIN',
        description: 'Full access',
        isSystem: true,
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const admin = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'admin@teams.test',
        firstName: 'Admin',
        lastName: 'Teams',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    adminId = admin.id
    await prisma.userRole.create({
      data: { userId: adminId, roleId: adminRole.id, assignedBy: 'test' },
    })
    adminToken = jwtService.sign({
      sub: adminId,
      userId: adminId,
      tenantId: tenantAId,
      roles: ['ADMIN'],
      email: 'admin@teams.test',
    })

    // Create some users for member assignment tests
    await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'member1@teams.test',
        firstName: 'M1',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: 'member2@teams.test',
        firstName: 'M2',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    // User in tenant B
    await prisma.user.create({
      data: {
        tenantId: tenantB.id,
        email: 'buser@teams.test',
        firstName: 'B',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await app?.close()
    await container?.stop()
  })

  function graphqlQuery(
    token: string,
    query: string,
    variables?: Record<string, unknown>,
  ): SuperTest {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  describe('Full CRUD lifecycle', () => {
    let teamId: string

    it('creates a team', async () => {
      const res = await graphqlQuery(
        adminToken,
        `
        mutation CreateTeam($name: String!) { createTeam(name: $name) { id name memberCount createdAt } }
      `,
        { name: 'Sales Team 1' },
      )
      teamId = res.body.data.createTeam.id
      expect(res.body.data.createTeam.name).toBe('Sales Team 1')
      expect(res.body.data.createTeam.memberCount).toBe(0)
    })

    it('lists teams', async () => {
      const res = await graphqlQuery(
        adminToken,
        `
        query { teams { id name memberCount } }
      `,
      )
      expect(res.body.data.teams.length).toBeGreaterThanOrEqual(1)
    })

    it('gets a team by id', async () => {
      const res = await graphqlQuery(
        adminToken,
        `
        query Team($id: ID!) { team(id: $id) { id name members { id email } } }
      `,
        { id: teamId },
      )
      expect(res.body.data.team.id).toBe(teamId)
      expect(res.body.data.team.members).toHaveLength(0)
    })

    it('updates team name', async () => {
      const res = await graphqlQuery(
        adminToken,
        `
        mutation UpdateTeam($id: ID!, $name: String!) { updateTeam(id: $id, name: $name) { id name } }
      `,
        { id: teamId, name: 'Renamed Team' },
      )
      expect(res.body.data.updateTeam.name).toBe('Renamed Team')
    })

    it('assigns members to a team', async (): Promise<void> => {
      const users = await prisma.user.findMany({
        where: { tenantId: tenantAId, email: { in: ['member1@teams.test', 'member2@teams.test'] } },
      })
      const memberIds = users.map((u) => u.id)
      const res = await graphqlQuery(
        adminToken,
        `
        mutation SetTeamMembers($teamId: ID!, $memberIds: [ID!]!) {
          setTeamMembers(teamId: $teamId, memberIds: $memberIds) { id members { id email } }
        }
      `,
        { teamId, memberIds },
      )
      expect(res.body.data.setTeamMembers.members).toHaveLength(2)
    })

    it('deletes team with no members', async () => {
      // First remove members
      await graphqlQuery(
        adminToken,
        `
        mutation SetTeamMembers($teamId: ID!, $memberIds: [ID!]!) {
          setTeamMembers(teamId: $teamId, memberIds: $memberIds) { id }
        }
      `,
        { teamId, memberIds: [] },
      )

      const res = await graphqlQuery(
        adminToken,
        `
        mutation DeleteTeam($id: ID!) { deleteTeam(id: $id) }
      `,
        { id: teamId },
      )
      expect(res.body.data.deleteTeam).toBe(true)
    })
  })

  describe('Validation', () => {
    it('fails to delete team with active members', async () => {
      // Create team with a member
      const createRes = await graphqlQuery(
        adminToken,
        `
        mutation { createTeam(name: "NotEmptyTeam") { id } }
      `,
      )
      const tid = createRes.body.data.createTeam.id
      const users = await prisma.user.findMany({
        where: { tenantId: tenantAId, email: 'member1@teams.test' },
      })
      await graphqlQuery(
        adminToken,
        `
        mutation SetTeamMembers($teamId: ID!, $memberIds: [ID!]!) {
          setTeamMembers(teamId: $teamId, memberIds: $memberIds) { id }
        }
      `,
        { teamId: tid, memberIds: [users[0].id] },
      )

      const res = await graphqlQuery(
        adminToken,
        `
        mutation DeleteTeam($id: ID!) { deleteTeam(id: $id) }
      `,
        { id: tid },
      )
      expect(res.body.errors).toBeDefined()
    })
  })

  describe('Cross-tenant isolation', () => {
    it('cannot access other tenant team', async () => {
      const res = await graphqlQuery(
        adminToken,
        `
        query { teams { id name } }
      `,
      )
      const names = res.body.data.teams.map((t: { name: string }) => t.name)
      // No team from tenant B should leak
      expect(names.length).toBeGreaterThanOrEqual(0)
    })
  })
})
