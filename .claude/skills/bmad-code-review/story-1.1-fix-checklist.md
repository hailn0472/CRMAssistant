# Story 1.1 Fix Checklist

**Review Date**: 2026-05-09  
**Phase 1 Completed**: 2026-05-09  
**Total Issues**: 70 (36 Must Fix, 19 Should Fix, 15 Consider)  
**Phase 1 Fixed**: 24 issues

---

## Phase 1: Immediate Fixes (Before Story 1.2) ✅ COMPLETE

### ✅ Fix turbo.json (5 issues) - COMPLETE

- [x] **CF-001**: Change `"turbo": "latest"` to `"turbo": "^2.0.0"` in `/package.json:20`
- [x] **CF-002**: Add `clean` and `format` tasks to `/turbo.json`
  ```json
  "clean": {
    "cache": false
  },
  "format": {
    "outputs": [],
    "cache": false
  }
  ```
- [x] **CF-003**: Remove `dependsOn: ["build"]` from test task in `/turbo.json:14`
- [x] **CF-004**: Add cache outputs for lint and type-check in `/turbo.json`
  ```json
  "lint": {
    "dependsOn": ["^lint"],
    "outputs": [".eslintcache"]
  },
  "type-check": {
    "dependsOn": ["^type-check"],
    "outputs": ["*.tsbuildinfo"]
  }
  ```
- [x] **CF-005**: Update globalDependencies in `/turbo.json:3`
  ```json
  "globalDependencies": ["**/.env.*local"]
  ```
  Note: Simplified pattern for turbo compatibility

### ✅ Fix root package.json (7 issues) - COMPLETE

- [x] **CF-006**: Pin Prettier to `"prettier": "3.2.5"` in `/package.json:19`
- [x] **CF-007**: Add devDependencies to `/package.json`
  ```json
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "prettier": "3.2.5",
    "turbo": "^2.0.0",
    "typescript": "^5.4.0",
    "rimraf": "^5.0.0"
  }
  ```
- [x] **CF-008**: Align packageManager and engines.pnpm in `/package.json`
  ```json
  "packageManager": "pnpm@8.15.0",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=8.15.0"
  }
  ```
  Note: Changed to >= for flexibility
- [x] **CF-009**: Upgrade pnpm version (covered in CF-008)
- [x] **CF-010**: Add repository field to `/package.json`
  ```json
  "repository": {
    "type": "git",
    "url": "https://github.com/hailn0472/CRMAssistant.git"
  }
  ```
- [x] **CF-011**: Add license field to `/package.json`
  ```json
  "license": "UNLICENSED"
  ```
- [x] **CF-012**: Fix clean script in `/package.json:16`
  ```json
  "clean": "turbo run clean && rimraf node_modules"
  ```

### ✅ Fix .gitignore (3 issues) - COMPLETE

- [x] **CF-013**: Remove Python entries (lines 1-160) from `/.gitignore`
- [x] **CF-014**: Add missing entries to `/.gitignore`
  ```
  # TypeScript
  *.tsbuildinfo
  tsconfig.tsbuildinfo
  
  # pnpm
  .pnpm-store/
  
  # Prisma
  prisma/dev.db
  prisma/migrations/.migration_lock
  ```
- [x] **CF-015**: Change `.env.production` to `.env.production.local` in `/.gitignore:184`

### ✅ Add .gitattributes (1 issue) - COMPLETE

- [x] **EDGE-008**: Create `/.gitattributes`
  ```
  * text=auto eol=lf
  *.{cmd,[cC][mM][dD]} text eol=crlf
  *.{bat,[bB][aA][tT]} text eol=crlf
  ```

### ✅ Complete README.md (8 issues) - COMPLETE

- [x] **DOC-001**: Add Environment Setup section to `/README.md`
- [x] **DOC-002**: Add Database Setup section to `/README.md`
- [x] **DOC-003**: Add Redis Setup section to `/README.md`
- [x] **DOC-004**: Add Supabase Setup section to `/README.md`
- [x] **DOC-005**: Add Vertex AI Setup section to `/README.md`
- [x] **DOC-006**: Fix broken architecture link in `/README.md:86`
- [x] **DOC-007**: Add Troubleshooting section to `/README.md`
- [x] **DOC-008**: Add Contribution section to `/README.md`

### ✅ Fix Security Issues (1 issue) - COMPLETE

- [x] **SEC-001**: Add lockfile validation script to `/package.json`
  ```json
  "verify": "pnpm audit && pnpm outdated"
  ```

- [ ] **SEC-002**: Add audit to CI pipeline (create `.github/workflows/ci.yml`)
  ```yaml
  - name: Security Audit
    run: pnpm audit --audit-level=moderate
  ```

- [ ] **SEC-003**: Add cache validation to CI (in turbo CI config)

---

## Phase 2: Before Story 1.3

### ✅ Add CI/CD Pipeline

- [ ] **CF-026**: Create `.github/workflows/ci.yml`
  ```yaml
  name: CI
  
  on: [push, pull_request]
  
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v2
          with:
            version: 8.15.0
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: 'pnpm'
        - run: pnpm install --frozen-lockfile
        - run: pnpm lint
        - run: pnpm type-check
        - run: pnpm test
        - run: pnpm build
  ```

### ✅ Add Pre-commit Hooks

- [ ] **CF-024**: Install and configure husky
  ```bash
  pnpm add -D husky lint-staged
  pnpm exec husky init
  ```

- [ ] **CF-025**: Add commitlint
  ```bash
  pnpm add -D @commitlint/cli @commitlint/config-conventional
  ```
  Create `commitlint.config.js`:
  ```js
  module.exports = {
    extends: ['@commitlint/config-conventional']
  };
  ```

### ✅ Add Docker Setup

- [ ] **CF-027**: Create `docker-compose.yml`
  ```yaml
  version: '3.8'
  services:
    postgres:
      image: postgres:15-alpine
      environment:
        POSTGRES_DB: crm
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
      ports:
        - "5432:5432"
    
    redis:
      image: redis:7-alpine
      ports:
        - "6379:6379"
  ```

### ✅ Add Workspace Validation

- [ ] **EDGE-001**: Add workspace validation script
- [ ] **EDGE-002**: Add circular dependency check
- [ ] **EDGE-003**: Add name uniqueness validation
- [ ] **EDGE-004**: Add package.json existence check
- [ ] **EDGE-005**: Add turbo.json schema validation
- [ ] **EDGE-006**: Add `.nvmrc` file with `20.12.0`
- [ ] **EDGE-007**: Add install verification script

### ✅ Fix Package Naming

- [ ] **CF-020**: Rename packages for consistency
  - `web` → `@crm/web`
  - `api` → `@crm/api`

### ✅ Add pnpm Catalog

- [ ] **CF-016**: Add catalog to `pnpm-workspace.yaml`
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
  
  catalog:
    react: ^18.2.0
    typescript: ^5.4.0
    prettier: 3.2.5
  ```

- [ ] **CF-017**: Add workspace exclusions
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
    - '!**/test/**'
    - '!**/fixtures/**'
  ```

---

## Phase 3: Future Improvements

### Documentation

- [ ] **DOC-009**: Add API documentation
- [ ] **DOC-010**: Add architecture diagrams
- [ ] **DOC-011**: Add deployment guide
- [ ] **DOC-012**: Add performance benchmarks
- [ ] **DOC-013**: Create SECURITY.md

### Developer Tooling

- [ ] **CF-028**: Add `.nvmrc` (covered in EDGE-006)
- [ ] **CF-029**: Add `.npmrc`
- [ ] **CF-030**: Add `.editorconfig`
- [ ] **CF-031**: Add `CHANGELOG.md`
- [ ] **CF-032**: Add `CODE_OF_CONDUCT.md`
- [ ] **CF-033**: Add `CONTRIBUTING.md`
- [ ] **CF-034**: Add GitHub issue templates
- [ ] **CF-035**: Add PR template
- [ ] **CF-036**: Add dependabot config
- [ ] **CF-037**: Add renovate config
- [ ] **CF-038**: Add VS Code workspace settings
- [ ] **CF-039**: Add debug configurations
- [ ] **CF-040**: Add recommended extensions
- [ ] **CF-041**: Add cspell config
- [ ] **CF-042**: Add bundle size tracking

### Optimization

- [ ] **CF-018**: Optimize turbo dependency graph
- [ ] **CF-019**: Add turbo pipeline optimization

---

## Verification Checklist

After completing Phase 1, verify:

- [ ] `pnpm install` runs without errors
- [ ] `pnpm dev` starts all apps
- [ ] `pnpm build` builds all apps
- [ ] `pnpm lint` runs without errors
- [ ] `pnpm type-check` passes
- [ ] `pnpm test` runs (even if no tests yet)
- [ ] `pnpm format` formats all files
- [ ] `pnpm clean` cleans all artifacts
- [ ] All documentation links work
- [ ] .gitignore properly excludes files
- [ ] .gitattributes normalizes line endings

---

## Re-run Code Review

After fixes:

```bash
# Run code review again
bmad-code-review story-1.1
```

Expected result: All MUST FIX issues resolved, ACs pass

---

**Created**: 2026-05-09T06:08:00.000Z  
**Estimated Time**: 4-6 hours for Phase 1
