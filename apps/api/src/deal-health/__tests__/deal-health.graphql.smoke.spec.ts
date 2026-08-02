import { schema } from '../../graphql/schema'

describe('deal-health schema surface (smoke)', () => {
  it('registers the three queries and four mutations', () => {
    const queryType = schema.getQueryType()
    const mutationType = schema.getMutationType()

    expect(queryType?.getFields()['dealHealth']).toBeDefined()
    expect(queryType?.getFields()['atRiskDeals']).toBeDefined()
    expect(queryType?.getFields()['myReminderPreferences']).toBeDefined()
    expect(mutationType?.getFields()['snoozeDealReminder']).toBeDefined()
    expect(mutationType?.getFields()['unsnoozeDealReminder']).toBeDefined()
    expect(mutationType?.getFields()['updateReminderPreferences']).toBeDefined()
    expect(mutationType?.getFields()['runDealHealthSweep']).toBeDefined()
  })
})
