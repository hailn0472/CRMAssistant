# NestJS Framework Rules

## Module Structure

### Standard Module Pattern

```typescript
// contact.module.ts
import { Module } from '@nestjs/common'
import { ContactController } from './contact.controller'
import { ContactService } from './contact.service'
import { PrismaModule } from '@/prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [ContactController],
  providers: [ContactService],
  exports: [ContactService], // Export if used by other modules
})
export class ContactModule {}
```

### Module Organization

```
src/
├── contacts/
│   ├── dto/
│   │   ├── create-contact.dto.ts
│   │   └── update-contact.dto.ts
│   ├── entities/
│   │   └── contact.entity.ts
│   ├── contact.controller.ts
│   ├── contact.service.ts
│   ├── contact.module.ts
│   └── contact.service.spec.ts
```

## Dependency Injection

### Constructor Injection (Preferred)

```typescript
// ✅ Good
@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}
}

// ❌ Bad - property injection
@Injectable()
export class ContactService {
  @Inject(PrismaService)
  private prisma: PrismaService
}
```

### Use Interfaces for Abstraction

```typescript
// ✅ Good
export interface IContactRepository {
  findAll(): Promise<Contact[]>
  findById(id: string): Promise<Contact | null>
  create(data: CreateContactDto): Promise<Contact>
}

@Injectable()
export class ContactService {
  constructor(
    @Inject('IContactRepository')
    private readonly repository: IContactRepository,
  ) {}
}
```

## Controllers

### RESTful Controller Pattern

```typescript
@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  async findAll(@Query() query: PaginationDto): Promise<Contact[]> {
    return this.contactService.findAll(query)
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Contact> {
    const contact = await this.contactService.findOne(id)
    if (!contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`)
    }
    return contact
  }

  @Post()
  async create(@Body() dto: CreateContactDto): Promise<Contact> {
    return this.contactService.create(dto)
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto): Promise<Contact> {
    return this.contactService.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.contactService.remove(id)
  }
}
```

### Controller Best Practices

- **Keep controllers thin** - Business logic belongs in services
- **Use DTOs for validation** - Never trust raw request data
- **Use proper HTTP status codes** - 200, 201, 204, 400, 404, etc.
- **Use guards for authentication** - Apply at controller or method level
- **Use interceptors for transformation** - Response formatting, logging
- **Use pipes for validation** - ValidationPipe, ParseIntPipe, etc.

## Services

### Service Pattern

```typescript
@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async findAll(query: PaginationDto): Promise<Contact[]> {
    const { page = 1, limit = 20 } = query

    return this.prisma.contact.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string): Promise<Contact | null> {
    return this.prisma.contact.findUnique({
      where: { id },
    })
  }

  async create(dto: CreateContactDto): Promise<Contact> {
    try {
      return await this.prisma.contact.create({
        data: dto,
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Email already exists')
        }
      }
      throw error
    }
  }

  async update(id: string, dto: UpdateContactDto): Promise<Contact> {
    try {
      return await this.prisma.contact.update({
        where: { id },
        data: dto,
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`Contact with ID ${id} not found`)
        }
      }
      throw error
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.contact.delete({
        where: { id },
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`Contact with ID ${id} not found`)
        }
      }
      throw error
    }
  }
}
```

### Service Best Practices

- **Single Responsibility** - One service per domain entity
- **Use transactions** - For operations affecting multiple tables
- **Handle Prisma errors** - Convert to NestJS exceptions
- **Log important operations** - Use LoggerService
- **Return domain objects** - Not Prisma models directly (if using entities)

## DTOs (Data Transfer Objects)

### DTO Pattern with class-validator

```typescript
// create-contact.dto.ts
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  firstName: string

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  lastName: string

  @IsEmail()
  @IsNotEmpty()
  email: string

  @IsString()
  @IsOptional()
  phone?: string

  @IsString()
  @IsOptional()
  company?: string
}
```

### Update DTO Pattern

```typescript
// update-contact.dto.ts
import { PartialType } from '@nestjs/mapped-types'
import { CreateContactDto } from './create-contact.dto'

// ✅ Good - reuse CreateContactDto with all fields optional
export class UpdateContactDto extends PartialType(CreateContactDto) {}
```

### DTO Best Practices

- **Use class-validator decorators** - @IsString(), @IsEmail(), etc.
- **Use PartialType for update DTOs** - DRY principle
- **Use PickType/OmitType** - Select/exclude specific fields
- **Transform data** - Use @Transform() decorator when needed
- **Validate nested objects** - Use @ValidateNested()

## Exception Handling

### Use Built-in HTTP Exceptions

```typescript
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common'

// ✅ Good
if (!contact) {
  throw new NotFoundException(`Contact with ID ${id} not found`)
}

if (existingEmail) {
  throw new ConflictException('Email already exists')
}
```

### Custom Exception Filters

```typescript
// http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common'
import { Response } from 'express'

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      message:
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message,
    })
  }
}
```

## Guards

### Authentication Guard

```typescript
// jwt-auth.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context)
  }
}
```

### Authorization Guard

```typescript
// roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler())
    if (!requiredRoles) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user = request.user

    return requiredRoles.some((role) => user.roles?.includes(role))
  }
}
```

### Use Guards

```typescript
// Apply globally
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactController {}

// Apply to specific routes
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Delete(':id')
async remove(@Param('id') id: string) {}
```

## Interceptors

### Logging Interceptor

```typescript
// logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const method = request.method
    const url = request.url
    const now = Date.now()

    return next.handle().pipe(
      tap(() => {
        const responseTime = Date.now() - now
        console.log(`${method} ${url} - ${responseTime}ms`)
      }),
    )
  }
}
```

### Transform Interceptor

```typescript
// transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

export interface Response<T> {
  data: T
  timestamp: string
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => ({
        data,
        timestamp: new Date().toISOString(),
      })),
    )
  }
}
```

## Pipes

### Validation Pipe (Global)

```typescript
// main.ts
import { ValidationPipe } from '@nestjs/common'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error for extra properties
      transform: true, // Auto-transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Auto-convert types
      },
    }),
  )

  await app.listen(3000)
}
```

### Custom Pipe

```typescript
// parse-uuid.pipe.ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { validate as isUUID } from 'uuid';

@Injectable()
export class ParseUUIDPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUUID(value)) {
      throw new BadRequestException('Invalid UUID format');
    }
    return value;
  }
}

// Usage
@Get(':id')
async findOne(@Param('id', ParseUUIDPipe) id: string) {}
```

## Middleware

### Logger Middleware

```typescript
// logger.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
    next()
  }
}

// Apply in module
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*')
  }
}
```

## Configuration

### Environment Variables

```typescript
// config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
  vertexAi: {
    projectId: process.env.VERTEX_AI_PROJECT_ID,
    location: process.env.VERTEX_AI_LOCATION,
  },
})
```

### Use ConfigModule

```typescript
// app.module.ts
import { ConfigModule } from '@nestjs/config'
import configuration from './config/configuration'

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
})
export class AppModule {}
```

### Use ConfigService

```typescript
@Injectable()
export class SomeService {
  constructor(private configService: ConfigService) {}

  getPort(): number {
    return this.configService.get<number>('port')
  }
}
```

## Testing

### Unit Test Pattern

```typescript
// contact.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing'
import { ContactService } from './contact.service'
import { PrismaService } from '@/prisma/prisma.service'

describe('ContactService', () => {
  let service: ContactService
  let prisma: PrismaService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        {
          provide: PrismaService,
          useValue: {
            contact: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile()

    service = module.get<ContactService>(ContactService)
    prisma = module.get<PrismaService>(PrismaService)
  })

  describe('findAll', () => {
    it('should return an array of contacts', async () => {
      const mockContacts = [{ id: '1', name: 'John' }]
      jest.spyOn(prisma.contact, 'findMany').mockResolvedValue(mockContacts)

      const result = await service.findAll({ page: 1, limit: 20 })

      expect(result).toEqual(mockContacts)
      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      })
    })
  })
})
```

### Integration Test Pattern

```typescript
// contact.controller.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '@/app.module'

describe('ContactController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /contacts', () => {
    it('should return 200 and array of contacts', () => {
      return request(app.getHttpServer())
        .get('/contacts')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true)
        })
    })
  })
})
```

## Critical Rules for AI Agents

1. **Keep controllers thin** - Business logic in services only
2. **Use DTOs with class-validator** - Never trust raw input
3. **Handle Prisma errors** - Convert to NestJS exceptions
4. **Use dependency injection** - Constructor injection preferred
5. **Apply guards for auth** - JwtAuthGuard on protected routes
6. **Use ValidationPipe globally** - Automatic DTO validation
7. **Log important operations** - Use LoggerService
8. **Use transactions** - For multi-table operations
9. **Return proper HTTP status codes** - 200, 201, 204, 400, 404, etc.
10. **Test services and controllers** - Unit and integration tests
