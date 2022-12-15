import { upgradeWebSocketResponse } from '@well-known-components/http-server/dist/ws'
import { handleSocketLinearProtocol } from '../../logic/handle-linear-protocol'
import { HandlerContextWithPath, InternalWebSocket } from '../../types'

let connectionCounter = 0

export async function websocketHandler(
  context: HandlerContextWithPath<'logs' | 'ethereumProvider' | 'rooms' | 'config' | 'server' | 'metrics', '/rooms/:roomId'>
) {
  const logger = context.components.logs.getLogger('Websocket Handler')

  return upgradeWebSocketResponse((socket) => {
    logger.debug('Websocket connected')
    const ws = socket as any as InternalWebSocket

    ws.on('error', (error) => {
      logger.error(error)
      try {
        ws.end()
      } catch {}
    })

    ws.on('close', () => {
      logger.debug('Websocket closed')
    })

    ws.alias = ++connectionCounter
    ws.roomId = context.params.roomId

    handleSocketLinearProtocol(context.components, ws).then(() => {
      context.components.rooms.addSocketToRoom(ws)
    }).catch((err) => {
      logger.info(err)
      try {
        ws.end()
      } catch {}
    })
  })
}
