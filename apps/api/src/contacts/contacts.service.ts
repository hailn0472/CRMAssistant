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
}

export type UpdateContactInput = {
  email?: string
  firstName?: string
  lastName?: string
  phone?: string | null
  company?: string | null
  jobTitle?: string | null
}

export type ContactFilterInput = {
  search?: string
  company?: string
  jobTitle?: string
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
  owner: { select: { id: true, firstName: true, lastName: true, email: true } },
  tags: {
    select: {
      tag: { select: { id: true, name: true, color: true } },
    },
  },
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
          ownerId: userId,
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
      include: { owner: { select: { id: true, firstName: true, lastName: true, email: true } } },
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

  async findMany(
    tenantId: string,
    userId: string,
    filter: ContactFilterInput = {},
    pagination: ContactPaginationInput = {},
  ): Promise<ContactConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const search = filter.search?.trim()
    const company = filter.company?.trim()
    const jobTitle = filter.jobTitle?.trim()
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
      items: items.map((c) => ({ ...c, sharedWithMe: sharedIds.includes(c.id) })),
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
}
