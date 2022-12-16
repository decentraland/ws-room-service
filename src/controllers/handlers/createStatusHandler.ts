import { BaseComponents } from '../../types'

export async function createStatusHandler({
  config,
  rooms
}: Pick<BaseComponents, 'config' | 'rooms'>): Promise<(res: any, req: any) => void> {
  const commitHash = (await config.getString('COMMIT_HASH')) || 'unknown'

  return async (res): Promise<void> => {
    res.writeHeader('Access-Control-Allow-Origin', '*')
    res.end(
      JSON.stringify({
        commitHash,
        users: rooms.connectionsCount(),
        rooms: rooms.roomCount()
      })
    )
  }
}
