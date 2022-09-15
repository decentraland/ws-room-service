import { upgradeWebSocketResponse } from '@well-known-components/http-server/dist/ws'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { WebSocket } from 'ws'
import { GlobalContext } from '../../types'
import { WsPacket } from '../../proto/ws.gen'
import { verify } from 'jsonwebtoken'
import { Reader } from 'protobufjs/minimal'

type Peer = {
  ws: WebSocket
  alias: number
}

const connectionsPerRoom = new Map<string, Set<Peer>>()

function getConnectionsList(roomId: string): Set<Peer> {
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

const aliasToIdentity = new Map<number, string>()

export async function websocketRoomHandler(
  context: IHttpServerComponent.DefaultContext<GlobalContext> & IHttpServerComponent.PathAwareContext<GlobalContext>
) {
  const { metrics, config, logs } = context.components
  const logger = logs.getLogger('Websocket Room Handler')
  logger.info('Websocket')
  const roomId = context.params.roomId
  const connections = getConnectionsList(roomId)

  const secret = await config.requireString('WS_ROOM_SERVICE_SECRET')

  return upgradeWebSocketResponse((socket) => {
    logger.info('Websocket connected')
    let isAlive = true
    // TODO fix ws types
    const ws = socket as any as WebSocket
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

    const token = context.url.searchParams.get('access_token') as string

    let identity: string
    try {
      // TODO: validate audience
      const decodedToken = verify(token, secret) as any
      identity = decodedToken['peerId'] as string
    } catch (err) {
      logger.error(err as Error)
      ws.close()
      return
    }

    const alias = ++connectionCounter
    aliasToIdentity.set(alias, identity)

    const peer = { ws, alias }
    connections.add(peer)

    ws.on('error', (error) => {
      logger.error(error)
      ws.close()
    })

    ws.on('close', () => {
      logger.debug('Websocket closed')
      clearInterval(pingInterval)
      connections.delete(peer)
      aliasToIdentity.delete(alias)
      reportStatus(context)
    })

    const broadcast = (payload: Uint8Array) => {
      // Reliable/unreliable data
      connections.forEach(($) => {
        if (peer !== $) {
          $.ws.send(payload)
          metrics.increment('dcl_ws_rooms_out_messages')
          metrics.increment('dcl_ws_rooms_out_bytes', {}, payload.byteLength)
        }
      })
    }

    const peerIdentities: Record<number, string> = {}
    for (const peer of connections) {
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
