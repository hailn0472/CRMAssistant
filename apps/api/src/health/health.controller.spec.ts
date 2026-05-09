import { HealthController } from './health.controller'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(() => {
    controller = new HealthController()
  })

  describe('getHealth', () => {
    it('should return status ok', () => {
      const result = controller.getHealth()

      expect(result).toEqual({ status: 'ok' })
    })

    it('should return an object with status property', () => {
      const result = controller.getHealth()

      expect(result).toHaveProperty('status')
    })

    it('should always return ok status (idempotent)', () => {
      const result1 = controller.getHealth()
      const result2 = controller.getHealth()

      expect(result1).toEqual(result2)
    })
  })
})
