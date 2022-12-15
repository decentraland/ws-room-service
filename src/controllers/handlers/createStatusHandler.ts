import { BaseComponents } from '../../types'

export async function createStatusHandler({
  config,
  rooms
}: Pick<BaseComponents, 'config' | 'rooms'>): Promise<(res: any, req: any) => void> {
  const commitHash = (await config.getString('COMMIT_HASH')) || 'unknown'

  return async (res): Promise<void> => {
    res.end(
      JSON.stringify({
        commitHash,
        users: rooms.connectionsCount()
      })
    )
  }
}
