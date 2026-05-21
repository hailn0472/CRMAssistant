# Git Workflow & Commit Conventions

## Commit Message Format

We follow **Conventional Commits** specification for all commit messages.

### Format Structure

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Type

Must be one of the following:

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools and libraries such as documentation generation
- **ci**: Changes to CI configuration files and scripts
- **build**: Changes that affect the build system or external dependencies

### Scope

The scope should be the name of the workspace or feature affected:

**Workspace scopes:**

- `web` - Frontend (Next.js app)
- `api` - Backend (NestJS app)
- `types` - Shared types package
- `utils` - Shared utils package
- `config` - Shared config package

**Feature scopes:**

- `contacts` - Contact management
- `deals` - Deal management
- `text-to-sql` - Text-to-SQL engine
- `auth` - Authentication
- `cache` - Caching layer
- `prisma` - Database/Prisma related
- `graphql` - GraphQL schema/resolvers
- `ui` - UI components

**Infrastructure scopes:**

- `deps` - Dependencies
- `docker` - Docker configuration
- `ci` - CI/CD pipelines
- `deploy` - Deployment scripts

### Subject

The subject contains a succinct description of the change:

- Use the imperative, present tense: "change" not "changed" nor "changes"
- Don't capitalize the first letter
- No period (.) at the end
- Maximum 72 characters

### Body (Optional)

The body should include the motivation for the change and contrast this with previous behavior.

- Use the imperative, present tense
- Wrap at 72 characters
- Separate from subject with a blank line

### Footer (Optional)

The footer should contain:

- **Breaking Changes**: Start with `BREAKING CHANGE:` followed by description
- **Issue References**: `Closes #123`, `Fixes #456`, `Refs #789`
- **Co-authors**: `Co-authored-by: Name <email>`

### Examples

**Simple feature:**

```
feat(contacts): add contact search functionality
```

**Bug fix with scope:**

```
fix(text-to-sql): prevent SQL injection in query validator
```

**Breaking change:**

```
feat(api): change authentication to use JWT

BREAKING CHANGE: Session-based auth is no longer supported.
All clients must now use JWT tokens for authentication.

Closes #234
```

**Multiple scopes:**

```
refactor(web,api): standardize error response format
```

**Dependency update:**

```
chore(deps): upgrade prisma to 5.1.0
```

**Documentation:**

```
docs: update architecture decision records
```

**Performance improvement:**

```
perf(text-to-sql): add Redis caching for query results
```

**With body:**

```
fix(api): resolve race condition in contact creation

The previous implementation did not handle concurrent requests
properly, leading to duplicate contacts being created. This fix
adds a unique constraint check before insertion.

Fixes #456
```

## Branch Naming Conventions

### Format

```
<type>/<scope>/<short-description>
```

### Types

- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation changes
- `test/` - Test additions or modifications
- `chore/` - Maintenance tasks
- `hotfix/` - Urgent production fixes

### Examples

```
feature/contacts/add-search
fix/text-to-sql/sql-injection
refactor/api/graphql-schema
docs/architecture/update-adr
test/contacts/integration-tests
chore/deps/upgrade-prisma
hotfix/auth/token-expiry
```

### Branch Lifecycle

1. **Create branch from main:**

   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/contacts/add-search
   ```

2. **Work on feature with regular commits**

3. **Keep branch updated:**

   ```bash
   git checkout main
   git pull origin main
   git checkout feature/contacts/add-search
   git rebase main
   ```

4. **Push to remote:**

   ```bash
   git push origin feature/contacts/add-search
   ```

5. **Create Pull Request**

6. **After merge, delete branch:**
   ```bash
   git branch -d feature/contacts/add-search
   git push origin --delete feature/contacts/add-search
   ```

## Pull Request Guidelines

### PR Title

Follow the same format as commit messages:

```
<type>(<scope>): <description>
```

### PR Description Template

```markdown
## Summary

- Brief description of what this PR does
- List key backend/frontend/database changes when applicable
- Mention tests added or updated for the change

## Story task checklist

- [ ] Task 1 from the story
- [ ] Task 2 from the story
- [ ] Task 3 from the story

## Test plan

- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm test`

## Type of Change

- [ ] New feature
- [ ] Bug fix
- [ ] Breaking change
- [ ] Documentation update
- [ ] Refactoring
- [ ] Performance improvement

## Checklist

- [ ] Code follows project naming conventions
- [ ] TypeScript strict mode passes with no errors
- [ ] All tests pass locally
- [ ] ESLint shows no warnings
- [ ] Prettier formatting applied
- [ ] Documentation updated (if needed)
- [ ] No console.log or debugging code left
- [ ] Environment variables documented (if added)

## Related Issues

Closes #123
Refs #456

## Screenshots (if applicable)

[Add screenshots for UI changes]

## Breaking Changes

[Describe any breaking changes and migration steps]
```

### PR Story Task Checklist Requirements

Always include a `## Story task checklist` section in PR descriptions when the
work implements a story or task list. Copy the story's implementation tasks into
markdown task checkboxes and mark completed items with `[x]`, for example:

```markdown
## Story task checklist

- [x] Add Contact Prisma model and migration
- [x] Add GraphQL CRUD schema and resolver
- [x] Add contacts UI pages and form components
- [x] Add unit and integration coverage
```

If a story task is intentionally not completed, leave it unchecked and add a
short reason after the item.

### PR Test Plan Requirements

Always include a `## Test plan` section in PR descriptions. Use markdown task
checkboxes for each command so GitHub renders completed tasks clearly, for
example:

```markdown
## Test plan

- [x] `pnpm type-check`
- [x] `pnpm lint`
- [x] `pnpm test`
```

If a command is not run, leave it unchecked and add a short reason after the
command.

### PR Review Requirements

**Before requesting review:**

- [ ] All CI checks pass
- [ ] No merge conflicts
- [ ] Branch is up to date with main
- [ ] Self-review completed

**Reviewer checklist:**

- [ ] Code follows naming conventions
- [ ] Logic is clear and maintainable
- [ ] Tests cover new functionality
- [ ] No security vulnerabilities introduced
- [ ] Performance implications considered
- [ ] Documentation is adequate

### PR Size Guidelines

- **Small PR**: < 200 lines changed (preferred)
- **Medium PR**: 200-500 lines changed
- **Large PR**: > 500 lines changed (should be split if possible)

**Tips for keeping PRs small:**

- Break features into smaller, logical chunks
- Separate refactoring from feature work
- Use feature flags for incomplete features

## Commit Workflow

### When to Commit

**DO commit when:**

- A logical unit of work is complete
- All tests pass
- Code is formatted and linted
- You're about to switch tasks
- End of work session

**DON'T commit when:**

- Tests are failing
- Code doesn't compile
- Debugging code is still present
- Work is incomplete and will break others

### Commit Frequency

- Commit often (multiple times per day)
- Each commit should be atomic (one logical change)
- Commits should be revertible without breaking the codebase

### Amending Commits

**Only amend commits that haven't been pushed:**

```bash
# Fix something in the last commit
git add .
git commit --amend --no-edit

# Change the last commit message
git commit --amend -m "new message"
```

**Never amend commits that have been pushed to shared branches**

### Interactive Rebase (Cleaning History)

Before creating a PR, clean up your commit history:

```bash
# Rebase last 3 commits
git rebase -i HEAD~3

# Options:
# pick = keep commit
# reword = change commit message
# squash = combine with previous commit
# drop = remove commit
```

**Only rebase commits that haven't been pushed to shared branches**

## Protected Branches

### Main Branch Rules

**Production/Stable Projects:**

- **No direct commits** - All changes via Pull Requests
- **Require PR approval** - At least 1 reviewer
- **Require status checks** - All CI tests must pass
- **Require up-to-date branch** - Must be rebased on latest main
- **No force push** - History is immutable

**Greenfield/Setup Phase (Current):**

- **Direct commits allowed** for:
  - Initial project setup (configs, tooling, infrastructure)
  - Documentation (README, project-context, rules)
  - BMad configuration
  - Development environment setup
- **Transition to PR workflow** when:
  - First feature implementation begins
  - Multiple developers join the project
  - CI/CD pipeline is established
  - Production deployment is planned

**When to switch to strict PR workflow:**

- ✅ Project context and rules are established
- ✅ Development environment is configured
- ✅ First feature branch is created
- ✅ CI/CD pipeline is running
- ✅ Team has more than 1 active developer

### Development Branch (if used)

- Same rules as main
- Integration branch for features before main

## Merge Strategies

### Squash and Merge (Preferred)

- Combines all commits into one
- Keeps main branch history clean
- Use for feature branches

### Rebase and Merge

- Maintains individual commits
- Linear history
- Use for small, well-crafted commits

### Merge Commit

- Creates a merge commit
- Preserves full branch history
- Use for long-lived branches or releases

**Default strategy: Squash and Merge**

## Hotfix Workflow

For urgent production fixes:

1. Create hotfix branch from main:

   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/critical-bug-description
   ```

2. Make the fix and commit:

   ```bash
   git commit -m "fix(scope): critical bug description"
   ```

3. Create PR with `[HOTFIX]` prefix:

   ```
   [HOTFIX] fix(auth): resolve token expiry issue
   ```

4. Fast-track review and merge

5. Ensure fix is also applied to any active development branches

## Git Hooks (Husky)

### Pre-commit Hook

Automatically runs before each commit:

- ESLint check on staged files
- Prettier formatting on staged files
- TypeScript type check
- Unit tests for changed files

**Skip hook (use sparingly):**

```bash
git commit --no-verify -m "message"
```

### Pre-push Hook

Automatically runs before push:

- Full test suite
- Prisma migration check
- Build verification

### Commit-msg Hook

Validates commit message format:

- Checks Conventional Commits format
- Enforces type and scope rules
- Validates subject length

## Common Git Commands

### Daily Workflow

```bash
# Start new feature
git checkout main
git pull origin main
git checkout -b feature/my-feature

# Regular commits
git add .
git commit -m "feat(scope): description"

# Update with main
git fetch origin
git rebase origin/main

# Push changes
git push origin feature/my-feature

# After PR merge
git checkout main
git pull origin main
git branch -d feature/my-feature
```

### Fixing Mistakes

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Undo changes to a file
git checkout -- filename

# Stash changes temporarily
git stash
git stash pop

# Revert a commit (creates new commit)
git revert <commit-hash>
```

## Critical Rules for AI Agents

1. **Always follow Conventional Commits format** - No exceptions
2. **Never commit without tests passing** - Run tests before commit
3. **Never force push to main** - Protected branch
4. **Keep commits atomic** - One logical change per commit
5. **Write descriptive commit messages** - Future you will thank you
6. **Use appropriate scope** - Helps with changelog generation
7. **Reference issues in commits** - Maintains traceability
8. **Clean up branches after merge** - Keeps repository tidy
9. **Never commit secrets or credentials** - Use environment variables
10. **Rebase before creating PR** - Keep history clean

## Changelog Generation

Changelogs are automatically generated from commit messages using Conventional Commits:

```bash
# Generate changelog
npx conventional-changelog -p angular -i CHANGELOG.md -s
```

**This is why commit message format is critical!**
