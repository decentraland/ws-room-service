import { test } from '../components'

test('http endpoints', ({ components }) => {
  it('responds /status', async () => {
    const { localFetch } = components
    const r = await localFetch.fetch('/status')
    expect(r.status).toEqual(200)
    expect(await r.json()).toMatchObject({
      commitHash: 'unknown',
      users: 0
    })
  })
})
