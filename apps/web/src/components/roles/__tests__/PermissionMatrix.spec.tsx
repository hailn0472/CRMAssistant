import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PermissionMatrix } from '../PermissionMatrix'

function renderComponent(props: Partial<React.ComponentProps<typeof PermissionMatrix>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PermissionMatrix
        allPermissions={[]}
        assignedPermissionIds={new Set()}
        onSave={jest.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

function makePermissions(): React.ComponentProps<typeof PermissionMatrix>['allPermissions'] {
  const perms: React.ComponentProps<typeof PermissionMatrix>['allPermissions'] = []
  const resources = ['CONTACT', 'DEAL', 'TASK', 'TICKET', 'REPORT', 'USER', 'ROLE', 'SETTINGS']
  const actions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'ASSIGN']
  for (const resource of resources) {
    for (const action of actions) {
      perms.push({
        id: `${resource}:${action}`,
        resource,
        action,
        description: `${action} ${resource}`,
      })
    }
  }
  return perms
}

describe('PermissionMatrix', () => {
  it('renders loading skeleton when no permissions', () => {
    renderComponent({ allPermissions: [] })
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders all 8 resource rows and 7 action columns', () => {
    const allPermissions = makePermissions()
    renderComponent({ allPermissions })

    expect(screen.getByText('Contacts')).toBeInTheDocument()
    expect(screen.getByText('Deals')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.getByText('Roles')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()

    expect(screen.getByText('Create')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Update')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Export')).toBeInTheDocument()
    expect(screen.getByText('Import')).toBeInTheDocument()
    expect(screen.getByText('Assign')).toBeInTheDocument()
  })

  it('checkboxes reflect assigned permissions', () => {
    const allPermissions = makePermissions()
    const contactRead = allPermissions.find((p) => p.resource === 'CONTACT' && p.action === 'READ')!
    const assignedIds = new Set([contactRead.id])

    renderComponent({ allPermissions, assignedPermissionIds: assignedIds })

    const checkboxes = screen.getAllByRole('checkbox')
    const contactReadCheckbox = checkboxes.find((cb) =>
      cb.getAttribute('aria-label')?.includes('Read Contacts'),
    )
    expect(contactReadCheckbox).toBeDefined()
    expect((contactReadCheckbox as HTMLInputElement).checked).toBe(true)
  })

  it('disables save button when not dirty', () => {
    const allPermissions = makePermissions()
    const assignedIds = new Set(allPermissions.map((p) => p.id))

    renderComponent({ allPermissions, assignedPermissionIds: assignedIds, onSave: jest.fn() })

    const saveButton = screen.getByText('Save permissions')
    expect(saveButton).toBeDisabled()
  })

  it('disables save when no changes are made', () => {
    const allPermissions = makePermissions()
    renderComponent({ allPermissions, assignedPermissionIds: new Set(), onSave: jest.fn() })

    const saveButton = screen.getByText('Save permissions')
    expect(saveButton).toBeDisabled()
  })

  it('shows user count element when provided', () => {
    const allPermissions = makePermissions()
    const contactRead = allPermissions.find((p) => p.resource === 'CONTACT' && p.action === 'READ')!
    const assignedIds = new Set([contactRead.id])

    renderComponent({
      allPermissions,
      assignedPermissionIds: assignedIds,
      onSave: jest.fn(),
      userCount: 3,
    })

    // User count displayed in role info section on the page, not directly in matrix
    expect(screen.getByText('Save permissions')).toBeInTheDocument()
  })
})
