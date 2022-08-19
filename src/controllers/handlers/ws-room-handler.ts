import { upgradeWebSocketResponse } from '@well-known-components/http-server/dist/ws'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { WebSocket } from 'ws'
import { GlobalContext } from '../../types'
import { WsMessage } from '../../proto/ws.gen'
import { verify } from 'jsonwebtoken'
import { Reader } from 'protobufjs/minimal'

const connectionsPerRoom = new Map<string, Set<WebSocket>>()

function getConnectionsList(roomId: string): Set<WebSocket> {
  let set = connectionsPerRoom.get(roomId)
  if (!set) {
    set = new Set()
    connectionsPerRoom.set(roomId, set)
  }
  return set
}

function reportStatus(context: IHttpServerComponent.DefaultContext<GlobalContext>): void {
  const metrics = context.components.metrics
  let roomsCount = 0
  let connectionsCount = 0
  connectionsPerRoom.forEach((connections) => {
    connectionsCount += connections.size
    if (connections.size) {
      roomsCount += 1
    }
  })

  metrics.observe('dcl_ws_rooms_connections', {}, connectionsCount)
  metrics.observe('dcl_ws_rooms', {}, roomsCount)
}

let connectionCounter = 0

const aliasToUserId = new Map<number, string>()

export async function websocketRoomHandler(
  context: IHttpServerComponent.DefaultContext<GlobalContext> & IHttpServerComponent.PathAwareContext<GlobalContext>
) {
  const metrics = context.components.metrics
  const logger = context.components.logs.getLogger('Websocket Room Handler')
  logger.info('Websocket')
  const roomId = context.params.roomId
  const connections = getConnectionsList(roomId)

  const secret = process.env.WS_ROOM_SERVICE_SECRET

  if (!secret) {
    throw new Error('Missing ws room service auth secret')
  }

  return upgradeWebSocketResponse((socket) => {
    logger.info('Websocket connected')
    let isAlive = true
    // TODO fix ws types
    const ws = socket as any as WebSocket
    connections.add(ws)
    reportStatus(context)

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

    ws.on('error', (error) => {
      logger.error(error)
      ws.close()
    })

    ws.on('close', () => {
      logger.debug('Websocket closed')
      clearInterval(pingInterval)
      connections.delete(ws)
      reportStatus(context)
    })

    const token = context.url.searchParams.get('access_token') as string

    let userId: string
    try {
      // TODO: validate audience
      const decodedToken = verify(token, secret) as any
      userId = decodedToken['peerId'] as string
    } catch (err) {
      logger.error(err as Error)
      ws.close()
      return
    }

    const alias = ++connectionCounter
    aliasToUserId.set(alias, userId)

    const broadcast = (payload: Uint8Array) => {
      // Reliable/unreliable data
      connections.forEach(($) => {
        if (ws !== $) {
          $.send(payload)
          metrics.increment('dcl_ws_rooms_out_messages')
          metrics.increment('dcl_ws_rooms_out_bytes', {}, payload.byteLength)
        }
      })
    }

    ws.on('message', (rawMessage: Buffer) => {
      metrics.increment('dcl_ws_rooms_in_messages')
      metrics.increment('dcl_ws_rooms_in_bytes', {}, rawMessage.byteLength)
      let message: WsMessage
      try {
        message = WsMessage.decode(Reader.create(rawMessage))
      } catch (e: any) {
        logger.error(`cannot process ws message ${e.toString()}`)
        return
      }

      if (!message.data) {
        return
      }

      const { $case } = message.data

      switch ($case) {
        case 'systemMessage': {
          const { systemMessage } = message.data
          systemMessage.fromAlias = alias

          const d = WsMessage.encode({
            data: {
              $case: 'systemMessage',
              systemMessage
            }
          }).finish()

          broadcast(d)
          break
        }
        case 'identityMessage': {
          const { identityMessage } = message.data
          identityMessage.fromAlias = alias
          identityMessage.identity = userId

          const d = WsMessage.encode({
            data: {
              $case: 'identityMessage',
              identityMessage
            }
          }).finish()

          broadcast(d)
          break
        }
        default: {
          logger.log(`ignoring msg with ${$case}`)
        }
      }
    })
  })
}
