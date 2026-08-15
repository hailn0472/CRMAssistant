import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { PrismaService } from '../prisma/prisma.service'
import { ActivityService } from '../activities/activities.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { resolveSharedRecordIds } from '../common/guards/sharing-check'
import type { Contact, Prisma } from '@prisma/client'

export type CreateContactInput = {
  email: string
  firstName: string
  lastName: string
  phone?: string
  company?: string
  jobTitle?: string
  /// Defaults to the creating user when omitted.
  ownerId?: string
  // Enrichment fields
  linkedin?: string
  twitter?: string
  addressStreet?: string
  addressCity?: string
  addressCountry?: string
  department?: string
  timezone?: string
  language?: string
  source?: string
  notes?: string
}

export type UpdateContactInput = {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
  // Enrichment fields
  linkedin?: string | null
  twitter?: string | null
  addressStreet?: string | null
  addressCity?: string | null
  addressCountry?: string | null
  department?: string | null
  timezone?: string | null
  language?: string | null
  source?: string | null
  notes?: string | null
}

/** Visibility/sharing scope resolved once per list and reused across queries. */
export type ContactOwnerScope = {
  ownerConditions: Prisma.ContactWhereInput[]
  sharedIds: string[]
}

export type ContactFilterInput = {
  search?: string
  company?: string
  jobTitle?: string
  ownerId?: string
  tags?: string[]
  createdAtFrom?: string
  createdAtTo?: string
}

export type ContactPaginationInput = {
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

const contactListSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  company: true,
  jobTitle: true,
  ownerId: true,
  owner: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
  tags: {
    select: {
      tag: { select: { id: true, name: true, color: true } },
    },
  },
  // Enrichment fields
  linkedin: true,
  twitter: true,
  addressStreet: true,
  addressCity: true,
  addressCountry: true,
  department: true,
  timezone: true,
  language: true,
  source: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const

export type ContactListItem = Prisma.ContactGetPayload<{ select: typeof contactListSelect }>

export type ContactListItemWithSharing = ContactListItem & { sharedWithMe: boolean }

export type ContactConnection = {
  items: ContactListItemWithSharing[]
  total: number
  page: number
  pageSize: number
}

export type BulkAssignResult = {
  successCount: number
  failedCount: number
  errors: Array<{ contactId: string; error: string }>
}

export type ContactStats = {
  total: number
  addedThisMonth: number
  withOpenDeals: number
  unassigned: number
}

/// Sentinel owner used by schema defaults for records created without a real user.
const UNASSIGNED_OWNER_ID = 'system'

const MAX_REQUIRED_FIELD_LENGTH = 100
const MAX_OPTIONAL_FIELD_LENGTH = 200

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    throw new BadRequestException(`${fieldName} is required`)
  }
  if (normalizedValue.length > MAX_REQUIRED_FIELD_LENGTH) {
    throw new BadRequestException(
      `${fieldName} must be at most ${MAX_REQUIRED_FIELD_LENGTH} characters`,
    )
  }
  return normalizedValue
}

function normalizeOptionalString(
  value: string | null | undefined,
  fieldName: string,
): string | null | undefined {
  if (value === null) {
    return null
  }
  if (value === undefined) {
    return undefined
  }

  const normalizedValue = value.trim()
  if (!normalizedValue) {
    return null
  }
  if (normalizedValue.length > MAX_OPTIONAL_FIELD_LENGTH) {
    throw new BadRequestException(
      `${fieldName} must be at most ${MAX_OPTIONAL_FIELD_LENGTH} characters`,
    )
  }
  return normalizedValue
}

function normalizeEmail(email: string): string {
  const normalizedEmail = normalizeRequiredString(email, 'Email').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new BadRequestException('Email must be valid')
  }
  return normalizedEmail
}

function normalizeCreateInput(input: CreateContactInput): CreateContactInput {
  return {
    email: normalizeEmail(input.email),
    firstName: normalizeRequiredString(input.firstName, 'First name'),
    lastName: normalizeRequiredString(input.lastName, 'Last name'),
    phone: normalizeOptionalString(input.phone, 'Phone') ?? undefined,
    company: normalizeOptionalString(input.company, 'Company') ?? undefined,
    jobTitle: normalizeOptionalString(input.jobTitle, 'Job title') ?? undefined,
    ownerId: normalizeOptionalString(input.ownerId, 'Owner') ?? undefined,
    linkedin: normalizeOptionalString(input.linkedin, 'LinkedIn') ?? undefined,
    twitter: normalizeOptionalString(input.twitter, 'Twitter') ?? undefined,
    addressStreet: normalizeOptionalString(input.addressStreet, 'Address street') ?? undefined,
    addressCity: normalizeOptionalString(input.addressCity, 'Address city') ?? undefined,
    addressCountry: normalizeOptionalString(input.addressCountry, 'Address country') ?? undefined,
    department: normalizeOptionalString(input.department, 'Department') ?? undefined,
    timezone: normalizeOptionalString(input.timezone, 'Timezone') ?? undefined,
    language: normalizeOptionalString(input.language, 'Language') ?? undefined,
    source: normalizeOptionalString(input.source, 'Source') ?? undefined,
    notes: normalizeOptionalString(input.notes, 'Notes') ?? undefined,
  }
}

function normalizeUpdateInput(input: UpdateContactInput): UpdateContactInput {
  return {
    email: input.email === undefined ? undefined : normalizeEmail(input.email),
    firstName:
      input.firstName === undefined
        ? undefined
        : normalizeRequiredString(input.firstName, 'First name'),
    lastName:
      input.lastName === undefined
        ? undefined
        : normalizeRequiredString(input.lastName, 'Last name'),
    phone: normalizeOptionalString(input.phone, 'Phone'),
    company: normalizeOptionalString(input.company, 'Company'),
    jobTitle: normalizeOptionalString(input.jobTitle, 'Job title'),
    linkedin: normalizeOptionalString(input.linkedin, 'LinkedIn'),
    twitter: normalizeOptionalString(input.twitter, 'Twitter'),
    addressStreet: normalizeOptionalString(input.addressStreet, 'Address street'),
    addressCity: normalizeOptionalString(input.addressCity, 'Address city'),
    addressCountry: normalizeOptionalString(input.addressCountry, 'Address country'),
    department: normalizeOptionalString(input.department, 'Department'),
    timezone: normalizeOptionalString(input.timezone, 'Timezone'),
    language: normalizeOptionalString(input.language, 'Language'),
    source: normalizeOptionalString(input.source, 'Source'),
    notes: normalizeOptionalString(input.notes, 'Notes'),
  }
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  async create(tenantId: string, userId: string, input: CreateContactInput): Promise<Contact> {
    const normalizedInput = normalizeCreateInput(input)

    // An explicit owner must be a live user of the same tenant, otherwise the
    // FK would let a caller hand a contact to someone outside their tenant.
    if (normalizedInput.ownerId && normalizedInput.ownerId !== userId) {
      const owner = await this.prisma.user.findFirst({
        where: { id: normalizedInput.ownerId, tenantId, deletedAt: null },
        select: { id: true },
      })
      if (!owner) throw new NotFoundException('User not found')
    }

    try {
      const contact = await this.prisma.contact.create({
        data: {
          tenantId,
          email: normalizedInput.email,
          firstName: normalizedInput.firstName,
          lastName: normalizedInput.lastName,
          phone: normalizedInput.phone,
          company: normalizedInput.company,
          jobTitle: normalizedInput.jobTitle,
          // Enrichment fields
          linkedin: normalizedInput.linkedin,
          twitter: normalizedInput.twitter,
          addressStreet: normalizedInput.addressStreet,
          addressCity: normalizedInput.addressCity,
          addressCountry: normalizedInput.addressCountry,
          department: normalizedInput.department,
          timezone: normalizedInput.timezone,
          language: normalizedInput.language,
          source: normalizedInput.source,
          notes: normalizedInput.notes,
          ownerId: normalizedInput.ownerId ?? userId,
          createdBy: userId,
          updatedBy: userId,
        },
      })

      // Auto-log CONTACT_CREATED (non-blocking)
      await this.activityService.logSafe({
        tenantId,
        contactId: contact.id,
        type: 'CONTACT_CREATED',
        title: 'Contact created',
        description: `${contact.firstName} ${contact.lastName} (${contact.email})`,
        createdBy: userId,
      })

      return contact
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Contact email already exists')
      }
      throw error
    }
  }

  async findOne(tenantId: string, userId: string, id: string): Promise<Contact> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
      },
    })

    if (!contact) {
      throw new NotFoundException('Contact not found')
    }

    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)
    const sharedIds = await resolveSharedRecordIds(userId, tenantId, 'CONTACT')

    // Check visibility
    let hasAccess = false

    if (visibilityFilter === undefined) {
      hasAccess = true // ALL/ADMIN bypass
    } else if (typeof visibilityFilter === 'string') {
      hasAccess = contact.ownerId === visibilityFilter
    } else {
      const allowedIds = (visibilityFilter as { in: string[] }).in
      hasAccess = allowedIds.includes(contact.ownerId)
    }

    // Check sharing (OR logic)
    if (!hasAccess && sharedIds.includes(id)) {
      hasAccess = true
    }

    if (!hasAccess) {
      throw new NotFoundException('Contact not found')
    }

    return contact
  }

  /**
   * Resolves the user's effective access level for a contact.
   * - Record owner → FULL
   * - User with sharing rule → sharing rule's access level
   * - No access → throws ForbiddenException
   * Used by update() (requires EDIT) and delete() (requires FULL).
   */
  private async resolveAccessLevel(
    tenantId: string,
    userId: string,
    contact: { id: string; ownerId: string },
  ): Promise<'READ' | 'EDIT' | 'FULL'> {
    // Owner gets full access
    if (contact.ownerId === userId) return 'FULL'

    // ADMIN bypass: admin gets FULL access
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId,
        role: { tenantId, deletedAt: null },
      },
      include: { role: { select: { name: true } } },
    })
    if (userRoles.some((ur) => ur.role.name === 'ADMIN')) return 'FULL'

    // Check sharing rules for this contact (most permissive first)
    const rule = await this.prisma.sharingRule.findFirst({
      where: {
        tenantId,
        resourceType: 'CONTACT',
        resourceId: contact.id,
        deletedAt: null,
        OR: [
          { sharedWithUserId: userId },
          { sharedWithTeam: { members: { some: { id: userId } } } },
        ],
      },
      orderBy: { accessLevel: 'desc' },
      select: { accessLevel: true },
    })

    if (!rule) {
      throw new ForbiddenException('You do not have access to this record')
    }

    return rule.accessLevel
  }

  /// Resolves the owner/sharing conditions that scope a list query to what the user may see.
  /// Returns an empty condition list when the user has unrestricted visibility (ALL/ADMIN).
  private async resolveOwnerScope(tenantId: string, userId: string): Promise<ContactOwnerScope> {
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)
    const sharedIds = await resolveSharedRecordIds(userId, tenantId, 'CONTACT')

    const ownerConditions: Prisma.ContactWhereInput[] = []
    // When visibilityFilter is undefined (ALL/ADMIN bypass), no owner filter is needed
    // and the sharing filter should not be applied (user sees everything).
    // Only when visibility restricts results do we OR it with shared records.
    if (visibilityFilter !== undefined) {
      ownerConditions.push({ ownerId: visibilityFilter })
      if (sharedIds.length > 0) {
        ownerConditions.push({ id: { in: sharedIds } })
      }
    }

    return { ownerConditions, sharedIds }
  }

  /// Aggregate counters for the contacts workspace summary cards.
  /// Scoped with the same visibility/sharing rules as findMany so the totals
  /// always match what the user can actually list.
  async getStats(tenantId: string, userId: string): Promise<ContactStats> {
    // Story 6.3: the shared predicate drives the stats too — totals always
    // match what the user can actually list (findMany uses the same builder).
    const scope = await this.buildContactWhere(tenantId, userId)

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [total, addedThisMonth, withOpenDeals, unassigned] = await Promise.all([
      this.prisma.contact.count({ where: scope }),
      this.prisma.contact.count({ where: { ...scope, createdAt: { gte: monthStart } } }),
      this.prisma.contact.count({
        where: {
          ...scope,
          deals: { some: { deletedAt: null, stage: { isWon: false, isLost: false } } },
        },
      }),
      this.prisma.contact.count({
        where: {
          ...scope,
          OR: [
            { ownerId: UNASSIGNED_OWNER_ID },
            { owner: { OR: [{ deletedAt: { not: null } }, { isActive: false }] } },
          ],
        },
      }),
    ])

    return { total, addedThisMonth, withOpenDeals, unassigned }
  }

  /**
   * Shared visibility predicate for CONTACTS (Story 6.3): tenant + active +
   * own/team/all + sharing-rule scope, exactly as findMany/getStats use it.
   * Exposed so the reports engine reuses the SAME predicate — never a second
   * copy of the visibility rules.
   */
  async buildContactWhere(
    tenantId: string,
    userId: string,
    filter: ContactFilterInput = {},
    ownerScope?: ContactOwnerScope,
  ): Promise<Prisma.ContactWhereInput> {
    const search = filter.search?.trim()
    const company = filter.company?.trim()
    const jobTitle = filter.jobTitle?.trim()
    const { ownerConditions } = ownerScope ?? (await this.resolveOwnerScope(tenantId, userId))

    const where: Prisma.ContactWhereInput = {
      tenantId,
      deletedAt: null,
    }

    // Build AND conditions array to avoid OR key conflicts
    const andConditions: Prisma.ContactWhereInput[] = []

    if (company) {
      andConditions.push({ company: { contains: company, mode: 'insensitive' } })
    }

    if (jobTitle) {
      andConditions.push({ jobTitle: { contains: jobTitle, mode: 'insensitive' } })
    }

    const ownerId = filter.ownerId?.trim()
    if (ownerId) {
      andConditions.push({ ownerId })
    }

    if (filter.createdAtFrom || filter.createdAtTo) {
      const createdAtFilter: Prisma.DateTimeFilter = {}
      if (filter.createdAtFrom) {
        createdAtFilter.gte = new Date(filter.createdAtFrom)
      }
      if (filter.createdAtTo) {
        const endDate = new Date(filter.createdAtTo)
        endDate.setHours(23, 59, 59, 999)
        createdAtFilter.lte = endDate
      }
      andConditions.push({ createdAt: createdAtFilter })
    }

    if (search) {
      andConditions.push({
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (ownerConditions.length > 0) {
      andConditions.push({ OR: ownerConditions })
    }

    if (filter.tags && filter.tags.length > 0) {
      const validTags = filter.tags.filter(Boolean)
      if (validTags.length > 0) {
        andConditions.push({
          AND: validTags.map((tagName) => ({
            tags: { some: { tag: { name: tagName } } },
          })),
        })
      }
    }

    if (andConditions.length > 0) {
      where.AND = andConditions
    }

    return where
  }

  async findMany(
    tenantId: string,
    userId: string,
    filter: ContactFilterInput = {},
    pagination: ContactPaginationInput = {},
  ): Promise<ContactConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    // Resolve the visibility/sharing scope ONCE and reuse it for both the where
    // predicate and the sharedWithMe flags (no duplicate DB round-trip).
    const ownerScope = await this.resolveOwnerScope(tenantId, userId)

    const where = await this.buildContactWhere(tenantId, userId, filter, ownerScope)

    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: contactListSelect,
      }),
      this.prisma.contact.count({ where }),
    ])

    return {
      items: items.map((c) => ({ ...c, sharedWithMe: ownerScope.sharedIds.includes(c.id) })),
      total,
      page,
      pageSize,
    }
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateContactInput,
  ): Promise<Contact> {
    // Verify visibility before updating
    const contact = await this.findOne(tenantId, userId, id)

    // Check sharing access level: EDIT or FULL required
    const accessLevel = await this.resolveAccessLevel(tenantId, userId, contact)
    if (accessLevel === 'READ') {
      throw new ForbiddenException('Read-only access: cannot edit this contact')
    }

    const normalizedInput = normalizeUpdateInput(input)

    try {
      const result = await this.prisma.contact.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { ...normalizedInput, updatedBy: userId },
      })

      if (result.count === 0) {
        throw new NotFoundException('Contact not found')
      }

      const updatedContact = await this.findOne(tenantId, userId, id)

      // Detect changed fields and auto-log CONTACT_UPDATED (non-blocking)
      const changedFields = this.activityService.detectChangedFields(
        contact as unknown as Record<string, unknown>,
        updatedContact as unknown as Record<string, unknown>,
      )

      if (changedFields.length > 0) {
        await this.activityService.logSafe({
          tenantId,
          contactId: updatedContact.id,
          type: 'CONTACT_UPDATED',
          title: 'Contact updated',
          description: `Updated fields: ${changedFields.join(', ')}`,
          createdBy: userId,
        })
      }

      return updatedContact
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Contact email already exists')
      }
      throw error
    }
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Verify visibility before deleting
    const contact = await this.findOne(tenantId, userId, id)

    // Check sharing access level: FULL required for delete
    const accessLevel = await this.resolveAccessLevel(tenantId, userId, contact)
    if (accessLevel !== 'FULL') {
      throw new ForbiddenException(
        'Insufficient access: only owners or FULL-access shares can delete',
      )
    }

    const result = await this.prisma.contact.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Contact not found')
    }

    return true
  }

  /**
   * Assign a new owner to a contact.
   * Validates caller visibility/access, target user tenant, and wraps in a transaction.
   * Auto-logs CONTACT_OWNER_CHANGED activity (non-blocking).
   */
  async assignOwner(
    tenantId: string,
    userId: string,
    contactId: string,
    newOwnerId: string,
  ): Promise<Contact> {
    // Verify caller has access to this contact
    const contact = await this.findOne(tenantId, userId, contactId)

    // Check access level: EDIT or FULL required
    const accessLevel = await this.resolveAccessLevel(tenantId, userId, contact)
    if (accessLevel === 'READ') {
      throw new ForbiddenException('Read-only access: cannot reassign owner')
    }

    // No-op: same owner
    if (newOwnerId === contact.ownerId) return contact

    // Validate target user exists and belongs to same tenant
    const newOwner = await this.prisma.user.findFirst({
      where: { id: newOwnerId, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    if (!newOwner) throw new NotFoundException('User not found')

    const contactWithOwner = contact as { owner?: { firstName: string; lastName: string } }

    return this.prisma.$transaction(async (tx) => {
      const updatedContact = await tx.contact.update({
        where: { id: contactId, tenantId, deletedAt: null },
        data: { ownerId: newOwnerId, updatedBy: userId },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
        },
      })

      // Auto-log ownership change (non-blocking)
      const oldOwnerName = contactWithOwner.owner
        ? `${contactWithOwner.owner.firstName} ${contactWithOwner.owner.lastName}`
        : 'System'
      const newOwnerName = `${newOwner.firstName} ${newOwner.lastName}`

      await this.activityService.logSafe({
        tenantId,
        contactId: contact.id,
        type: 'CONTACT_OWNER_CHANGED',
        title: 'Contact owner changed',
        description: `Owner changed from ${oldOwnerName} → ${newOwnerName}`,
        createdBy: userId,
      })

      return updatedContact
    })
  }

  /**
   * Internal variant that skips redundant user validation.
   * Used by assignOwnerBulk — caller must validate the user upfront.
   * Still performs visibility check, access-level check, no-op check, and per-contact transaction.
   */
  private async assignOwnerUnsafe(
    tenantId: string,
    userId: string,
    contactId: string,
    newOwnerId: string,
  ): Promise<Contact> {
    // Verify caller has access to this contact
    const contact = await this.findOne(tenantId, userId, contactId)

    // Check access level: EDIT or FULL required
    const accessLevel = await this.resolveAccessLevel(tenantId, userId, contact)
    if (accessLevel === 'READ') {
      throw new ForbiddenException('Read-only access: cannot reassign owner')
    }

    // No-op: same owner
    if (newOwnerId === contact.ownerId) return contact

    const contactWithOwner = contact as { owner?: { firstName: string; lastName: string } }

    return this.prisma.$transaction(async (tx) => {
      const updatedContact = await tx.contact.update({
        where: { id: contactId, tenantId, deletedAt: null },
        data: { ownerId: newOwnerId, updatedBy: userId },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
        },
      })

      // Look up user info for activity log (fast path — primary key lookup)
      const newOwner = await tx.user.findUnique({
        where: { id: newOwnerId },
        select: { firstName: true, lastName: true },
      })

      const oldOwnerName = contactWithOwner.owner
        ? `${contactWithOwner.owner.firstName} ${contactWithOwner.owner.lastName}`
        : 'System'
      const newOwnerName = newOwner ? `${newOwner.firstName} ${newOwner.lastName}` : newOwnerId

      await this.activityService.logSafe({
        tenantId,
        contactId: contact.id,
        type: 'CONTACT_OWNER_CHANGED',
        title: 'Contact owner changed',
        description: `Owner changed from ${oldOwnerName} → ${newOwnerName}`,
        createdBy: userId,
      })

      return updatedContact
    })
  }

  /**
   * Assign a team to a contact.
   * Pass null to remove team assignment.
   * Validates caller visibility/access, team tenant, and no-op.
   */
  async assignTeam(
    tenantId: string,
    userId: string,
    contactId: string,
    teamId: string | null,
  ): Promise<Contact> {
    // Verify caller has access to this contact
    const contact = await this.findOne(tenantId, userId, contactId)

    // Check access level: EDIT or FULL required
    const accessLevel = await this.resolveAccessLevel(tenantId, userId, contact)
    if (accessLevel === 'READ') {
      throw new ForbiddenException('Read-only access: cannot assign team')
    }

    // No-op: same team
    if (contact.teamId === teamId) return contact

    // Validate team exists when setting (not when removing)
    if (teamId !== null) {
      const team = await this.prisma.team.findFirst({
        where: { id: teamId, tenantId, deletedAt: null },
      })
      if (!team) throw new NotFoundException('Team not found')
    }

    return this.prisma.contact.update({
      where: { id: contactId, tenantId, deletedAt: null },
      data: { teamId: teamId ?? null, updatedBy: userId },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
      },
    })
  }

  /**
   * Assign a new owner to multiple contacts in bulk.
   * Processes contacts sequentially for individual error handling.
   * User validation is done once upfront; uses assignOwnerUnsafe to avoid N+1.
   */
  async assignOwnerBulk(
    tenantId: string,
    userId: string,
    contactIds: string[],
    newOwnerId: string,
  ): Promise<BulkAssignResult> {
    // Validate target user once upfront
    const newOwner = await this.prisma.user.findFirst({
      where: { id: newOwnerId, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!newOwner) throw new NotFoundException('User not found')

    const result: BulkAssignResult = { successCount: 0, failedCount: 0, errors: [] }

    // Process each contact in sequence — assignOwnerUnsafe skips redundant user validation
    for (const contactId of contactIds) {
      try {
        await this.assignOwnerUnsafe(tenantId, userId, contactId, newOwnerId)
        result.successCount++
      } catch (error) {
        result.failedCount++
        result.errors.push({
          contactId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return result
  }
}
