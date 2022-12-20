import { HandlerContextWithPath } from '../../types'

export async function statusHandler({
  components: { config, rooms }
}: Pick<HandlerContextWithPath<'config' | 'rooms', '/status'>, 'url' | 'components'>) {
  const commitHash = (await config.getString('COMMIT_HASH')) || 'unknown'

  return {
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    body: {
      commitHash: commitHash,
      users: rooms.connectionsCount(),
      rooms: rooms.roomCount()
    }
  }
}
