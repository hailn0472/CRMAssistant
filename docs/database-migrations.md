# Database Migrations

## Quy trình bình thường

Mỗi lần thay đổi Prisma schema, tạo migration mới — **không reset, không mất data**:

```bash
cd apps/api

# Sửa schema.prisma → tạo migration mới
infisical run --env=dev --path=/apps/api -- pnpm exec prisma migrate dev --name mieu_ta_thay_doi

# Migration mới chỉ chứa delta (thay đổi mới), xếp chồng lên các migration trước đó
```

Migration file **không bao giờ sửa sau khi đã chạy**. Mỗi thay đổi = một file migration mới.

## Reset DB & Re-seed (dev only)

Chỉ dùng khi:

- Sửa nội dung migration đã apply (rất hiếm, tránh nếu có thể)
- Schema thay đổi quá lớn, tạo migration mới phức tạp hơn reset
- Dev DB có vấn đề cần làm sạch hoàn toàn

```bash
# 1. Reset DB — xóa hết data, chạy lại toàn bộ migration từ đầu
infisical run --env=dev --path=/apps/api -- pnpm exec prisma migrate reset --force

# 2. Seed admin user (tạo tenant + admin account qua Supabase Auth)
infisical run --env=dev --path=/apps/api -- pnpm exec ts-node prisma/seed-admin.ts

# 3. Seed dữ liệu mẫu (system roles, users, contacts cho cả 2 tenant)
infisical run --env=dev --path=/apps/api -- pnpm exec ts-node prisma/seed.ts
```

> `prisma migrate reset` xóa **toàn bộ data** trong DB. Chỉ dùng trong môi trường dev.

## Migration đã có

| Migration                                             | Mô tả                                                |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `20260510080000_add_multi_tenancy_patterns`           | Tenant model + multi-tenancy                         |
| `20260510090000_add_auth_fields`                      | Supabase Auth integration                            |
| `20260513120000_add_contact_table`                    | Contact model                                        |
| `20260629000000_extend_user_model`                    | User profile fields (firstName, lastName, avatar...) |
| `20260629080000_drop_legacy_name_column`              | Xóa cột `name` cũ trên User                          |
| `20260705153843_add_rbac_models`                      | Role, UserRole, AuditLog models (Story 2.2)          |
| `20260705163445_fix_user_firstname_lastname_defaults` | Fix default values firstName/lastName                |
