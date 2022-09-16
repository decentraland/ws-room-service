import { upgradeWebSocketResponse } from '@well-known-components/http-server/dist/ws'
import { WebSocket } from 'ws'
import { AppComponents, HandlerContextWithPath } from '../../types'
import { WsPacket } from '../../proto/ws.gen'
import { verify } from 'jsonwebtoken'
import { Reader } from 'protobufjs/minimal'

function reportStatus({ metrics, roomsRegistry }: Pick<AppComponents, 'metrics' | 'roomsRegistry'>): void {
  metrics.observe('dcl_ws_rooms_connections', {}, roomsRegistry.connectionsCount())
  metrics.observe('dcl_ws_rooms', {}, roomsRegistry.roomsCount())
}

let connectionCounter = 0

const aliasToIdentity = new Map<number, string>()

export async function websocketRoomHandler(
  context: Pick<
    HandlerContextWithPath<'metrics' | 'config' | 'logs' | 'roomsRegistry', '/ws-room/:roomId'>,
    'url' | 'components' | 'params'
  >
) {
  const { metrics, config, logs, roomsRegistry } = context.components
  const logger = logs.getLogger('Websocket Room Handler')
  logger.info('Websocket')
  const roomId = context.params.roomId

  const secret = await config.requireString('WS_ROOM_SERVICE_SECRET')

  return upgradeWebSocketResponse((socket) => {
    logger.info('Websocket connected')
    let isAlive = true
    const ws = socket as any as WebSocket
    reportStatus(context.components)

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

    const alias = ++connectionCounter
    aliasToIdentity.set(alias, identity)

    const peer = { ws, alias }
    roomsRegistry.addPeer(roomId, peer)

    ws.on('error', (error) => {
      logger.error(error)
      ws.close()
    })

    ws.on('close', () => {
      logger.debug('Websocket closed')
      clearInterval(pingInterval)
      roomsRegistry.removePeer(roomId, peer)
      aliasToIdentity.delete(alias)
      reportStatus(context.components)
    })

    const broadcast = (payload: Uint8Array) => {
      // Reliable/unreliable data
      roomsRegistry.getPeers(roomId).forEach(($) => {
        if (peer !== $) {
          $.ws.send(payload)
          metrics.increment('dcl_ws_rooms_out_messages')
          metrics.increment('dcl_ws_rooms_out_bytes', {}, payload.byteLength)
        }
      })
    }

    const peerIdentities: Record<number, string> = {}
    for (const peer of roomsRegistry.getPeers(roomId)) {
      peerIdentities[peer.alias] = aliasToIdentity.get(peer.alias)!
    }

    ws.send(
      WsPacket.encode({
        message: {
          $case: 'welcomeMessage',
          welcomeMessage: {
            alias,
            peerIdentities
          }
        }
      }).finish()
    )

    broadcast(
      WsPacket.encode({
        message: {
          $case: 'peerJoinMessage',
          peerJoinMessage: {
            alias,
            identity
          }
        }
      }).finish()
    )

    ws.on('message', (rawPacket: Buffer) => {
      metrics.increment('dcl_ws_rooms_in_messages')
      metrics.increment('dcl_ws_rooms_in_bytes', {}, rawPacket.byteLength)
      let packet: WsPacket
      try {
        packet = WsPacket.decode(Reader.create(rawPacket))
      } catch (e: any) {
        logger.error(`cannot process ws packet ${e.toString()}`)
        return
      }

      if (!packet.message) {
        return
      }

      const { $case } = packet.message

      switch ($case) {
        case 'peerUpdateMessage': {
          const { peerUpdateMessage } = packet.message
          peerUpdateMessage.fromAlias = alias

          const d = WsPacket.encode({
            message: {
              $case: 'peerUpdateMessage',
              peerUpdateMessage
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
