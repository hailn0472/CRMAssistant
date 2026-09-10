/**
 * Pure dependency-graph logic (Story 4.6, AC 11-14).
 *
 * Framework-free — no NestJS, no Prisma imports. Takes plain edge tuples and
 * returns plain answers. This is mandatory for coverage: `*.graphql.ts` is
 * excluded from API unit coverage (`jest.config.ts:15-23`), so non-trivial
 * logic in a resolver is untested and invisible to the 80% gate. Same
 * rationale that produced `productivity-buckets.ts` and
 * `task-subscription-visibility.ts`.
 */

export type DependencyEdge = {
  taskId: string
  dependsOnTaskId: string
}

export class DependencyGraphOverflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DependencyGraphOverflowError'
  }
}

/** Maximum number of nodes to traverse before rejecting. */
export const MAX_DEPENDENCY_NODES = 500

/** Maximum traversal depth before rejecting. */
export const MAX_DEPENDENCY_DEPTH = 50

/**
 * BFS over `taskId → dependsOnTaskId` edges, collecting every task that
 * transitively blocks `startTaskId`. Bounded by MAX_DEPENDENCY_NODES and
 * MAX_DEPENDENCY_DEPTH — throws DependencyGraphOverflowError on overflow.
 *
 * A `visited` set ensures cycle-safe traversal: a pre-existing cycle
 * terminates instead of hanging the request (AC 14).
 */
export function collectTransitiveBlockers(
  startTaskId: string,
  edges: DependencyEdge[],
): Set<string> {
  const blockers = new Set<string>()

  // Build adjacency: taskId → [dependsOnTaskId, ...]
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const existing = adjacency.get(edge.taskId) ?? []
    existing.push(edge.dependsOnTaskId)
    adjacency.set(edge.taskId, existing)
  }

  // BFS queue: each entry is [taskId, depth]
  const queue: Array<[string, number]> = []
  const visited = new Set<string>()

  // Seed: direct blockers of startTaskId
  const direct = adjacency.get(startTaskId) ?? []
  for (const blocker of direct) {
    queue.push([blocker, 1])
    visited.add(blocker)
    blockers.add(blocker)
  }

  let nodeCount = blockers.size

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!

    if (depth > MAX_DEPENDENCY_DEPTH) {
      throw new DependencyGraphOverflowError(
        `Dependency graph is too large to validate (limit: ${MAX_DEPENDENCY_NODES} tasks / depth ${MAX_DEPENDENCY_DEPTH})`,
      )
    }

    const children = adjacency.get(current) ?? []
    for (const child of children) {
      if (visited.has(child)) continue
      visited.add(child)
      blockers.add(child)
      nodeCount++

      if (nodeCount > MAX_DEPENDENCY_NODES) {
        throw new DependencyGraphOverflowError(
          `Dependency graph is too large to validate (limit: ${MAX_DEPENDENCY_NODES} tasks / depth ${MAX_DEPENDENCY_DEPTH})`,
        )
      }

      queue.push([child, depth + 1])
    }
  }

  return blockers
}

/**
 * Returns true when adding the edge `taskId → dependsOnTaskId` would create
 * a cycle. That is: `taskId` is already a transitive blocker of
 * `dependsOnTaskId` (i.e. `dependsOnTaskId` already depends on `taskId`).
 */
export function wouldCreateCycle(
  taskId: string,
  dependsOnTaskId: string,
  edges: DependencyEdge[],
): boolean {
  // Self-edge is also a cycle (AC 11)
  if (taskId === dependsOnTaskId) return true

  const transitiveBlockers = collectTransitiveBlockers(dependsOnTaskId, edges)
  return transitiveBlockers.has(taskId)
}
