import { upgradeWebSocketResponse } from '@well-known-components/http-server/dist/ws'
import { WebSocket } from 'ws'
import { HandlerContextWithPath } from '../../types'
import { verify } from 'jsonwebtoken'

export async function websocketRoomHandler(
  context: Pick<
    HandlerContextWithPath<'config' | 'logs' | 'rooms', '/ws-room/:roomId'>,
    'url' | 'components' | 'params'
  >
) {
  const { config, logs, rooms } = context.components
  const logger = logs.getLogger('Websocket Room Handler')
  logger.info('Websocket')
  const roomId = context.params.roomId

  const secret = await config.requireString('WS_ROOM_SERVICE_SECRET')

  return upgradeWebSocketResponse((socket) => {
    logger.info('Websocket connected')
    let isAlive = true
    const ws = socket as any as WebSocket

    ws.on('pong', () => {
      isAlive = true
    })

    const pingInterval = setInterval(function ping() {
      if (isAlive === false) {
        logger.warn(`Terminating ws because of ping timeout`)
        return ws.terminate()
      }

      isAlive = false
      ws.ping()
    }, 30000)

    const token = context.url.searchParams.get('access_token') as string

    let identity: string
    try {
      const decodedToken = verify(token, secret) as any
      identity = decodedToken['peerId'] as string
      const audience = decodedToken['audience'] as string
      // TODO: validate audience
      console.log(audience)
    } catch (err) {
      logger.error(err as Error)
      ws.close()
      return
    }

    ws.on('error', (error) => {
      logger.error(error)
      ws.close()
    })

    ws.on('close', () => {
      logger.debug('Websocket closed')
      clearInterval(pingInterval)
    })

    rooms.addSocketToRoom(ws, identity, roomId)
  })
}
