import {
  collectTransitiveBlockers,
  wouldCreateCycle,
  DependencyGraphOverflowError,
  MAX_DEPENDENCY_NODES,
  MAX_DEPENDENCY_DEPTH,
} from '../task-dependency-graph'
import type { DependencyEdge } from '../task-dependency-graph'

describe('task-dependency-graph', () => {
  describe('collectTransitiveBlockers', () => {
    it('returns empty set when there are no edges', () => {
      const result = collectTransitiveBlockers('task-a', [])
      expect(result.size).toBe(0)
    })

    it('returns empty set when startTaskId has no blockers', () => {
      const edges: DependencyEdge[] = [{ taskId: 'task-b', dependsOnTaskId: 'task-c' }]
      const result = collectTransitiveBlockers('task-a', edges)
      expect(result.size).toBe(0)
    })

    it('collects direct blockers', () => {
      const edges: DependencyEdge[] = [{ taskId: 'task-a', dependsOnTaskId: 'task-b' }]
      const result = collectTransitiveBlockers('task-a', edges)
      expect(result).toEqual(new Set(['task-b']))
    })

    it('collects transitive blockers (A blocked by B, B blocked by C)', () => {
      const edges: DependencyEdge[] = [
        { taskId: 'task-a', dependsOnTaskId: 'task-b' },
        { taskId: 'task-b', dependsOnTaskId: 'task-c' },
      ]
      const result = collectTransitiveBlockers('task-a', edges)
      expect(result).toEqual(new Set(['task-b', 'task-c']))
    })

    it('handles diamond (A→B, A→C, B→D, C→D) without duplication', () => {
      const edges: DependencyEdge[] = [
        { taskId: 'task-a', dependsOnTaskId: 'task-b' },
        { taskId: 'task-a', dependsOnTaskId: 'task-c' },
        { taskId: 'task-b', dependsOnTaskId: 'task-d' },
        { taskId: 'task-c', dependsOnTaskId: 'task-d' },
      ]
      const result = collectTransitiveBlockers('task-a', edges)
      expect(result).toEqual(new Set(['task-b', 'task-c', 'task-d']))
    })

    it('terminates on a pre-existing cycle instead of hanging', () => {
      // A pre-existing cycle: B→C, C→B (data from before this story, or a bug)
      const edges: DependencyEdge[] = [
        { taskId: 'task-a', dependsOnTaskId: 'task-b' },
        { taskId: 'task-b', dependsOnTaskId: 'task-c' },
        { taskId: 'task-c', dependsOnTaskId: 'task-b' }, // cycle
      ]
      // collectTransitiveBlockers traverses: a→b→c→b (visited, stops)
      const result = collectTransitiveBlockers('task-a', edges)
      expect(result).toEqual(new Set(['task-b', 'task-c']))
    })

    it('throws DependencyGraphOverflowError when node limit is exceeded', () => {
      // Create a chain of MAX_DEPENDENCY_NODES + 1 nodes
      const edges: DependencyEdge[] = []
      for (let i = 0; i <= MAX_DEPENDENCY_NODES; i++) {
        // We need: task-0 depends on task-1, task-1 depends on task-2, etc.
        edges.push({ taskId: `task-${i}`, dependsOnTaskId: `task-${i + 1}` })
      }
      // Traversing from task-0 should collect task-1..task-{MAX_DEPENDENCY_NODES+1}
      // That's MAX_DEPENDENCY_NODES+1 nodes, exceeding the limit
      expect(() => collectTransitiveBlockers('task-0', edges)).toThrow(DependencyGraphOverflowError)
    })

    it('throws DependencyGraphOverflowError when depth limit is exceeded', () => {
      // Create a chain of MAX_DEPENDENCY_DEPTH + 1 levels deep
      const edges: DependencyEdge[] = []
      for (let i = 0; i <= MAX_DEPENDENCY_DEPTH; i++) {
        // task-i depends on task-(i+1)
        edges.push({ taskId: `task-${i}`, dependsOnTaskId: `task-${i + 1}` })
      }
      // Traversing from task-0 goes depth 1..MAX_DEPENDENCY_DEPTH+1
      expect(() => collectTransitiveBlockers('task-0', edges)).toThrow(DependencyGraphOverflowError)
    })
  })

  describe('wouldCreateCycle', () => {
    it('returns true for a self-edge (A→A)', () => {
      expect(wouldCreateCycle('task-a', 'task-a', [])).toBe(true)
    })

    it('returns true for a direct cycle (A→B, B→A)', () => {
      const edges: DependencyEdge[] = [{ taskId: 'task-b', dependsOnTaskId: 'task-a' }]
      expect(wouldCreateCycle('task-a', 'task-b', edges)).toBe(true)
    })

    it('returns true for a transitive cycle (A→B, B→C, C→A)', () => {
      const edges: DependencyEdge[] = [
        { taskId: 'task-a', dependsOnTaskId: 'task-b' },
        { taskId: 'task-b', dependsOnTaskId: 'task-c' },
      ]
      // Adding task-c → task-a: does A already block task-c? A→B→C, so yes
      expect(wouldCreateCycle('task-c', 'task-a', edges)).toBe(true)
    })

    it('returns false for a diamond (not a cycle)', () => {
      const edges: DependencyEdge[] = [
        { taskId: 'task-a', dependsOnTaskId: 'task-b' },
        { taskId: 'task-a', dependsOnTaskId: 'task-c' },
      ]
      // Adding task-a → task-d: A doesn't block D
      expect(wouldCreateCycle('task-a', 'task-d', edges)).toBe(false)
    })

    it('returns false when the dependency is safe', () => {
      const edges: DependencyEdge[] = [{ taskId: 'task-b', dependsOnTaskId: 'task-c' }]
      // Adding task-a → task-b: A doesn't block B
      expect(wouldCreateCycle('task-a', 'task-b', edges)).toBe(false)
    })
  })
})
