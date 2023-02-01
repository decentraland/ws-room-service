import { AppComponents, InternalWebSocket } from '../types'
import { validateMetricsDeclaration } from '@well-known-components/metrics'
import { craftMessage } from '../logic/craft-message'
import { WsPacket } from '@dcl/protocol/out-js/decentraland/kernel/comms/rfc5/ws_comms.gen'

export type RoomComponent = {
  connectionsCount(): number
  roomCount(): number
  roomsWithCounts(): { roomName: string; count: number }[]
  addSocketToRoom(ws: InternalWebSocket): void
  removeFromRoom(ws: InternalWebSocket): void
  isAddressConnected(address: string): boolean
  getSocket(address: string): InternalWebSocket | undefined
  getRoom(room: string): Set<InternalWebSocket>
  getRoomSize(room: string): number
}

export const roomsMetrics = validateMetricsDeclaration({
  dcl_ws_rooms_count: {
    help: 'Current amount of rooms',
    type: 'gauge'
  },
  dcl_ws_rooms_connections: {
    help: 'Current amount of connections',
    type: 'gauge'
  },
  dcl_ws_rooms_connections_total: {
    help: 'Total amount of connections',
    type: 'counter'
  },
  dcl_ws_rooms_kicks_total: {
    help: 'Total amount of kicked players',
    type: 'counter'
  },
  dcl_ws_rooms_unknown_sent_messages_total: {
    help: 'Total amount of unkown messages',
    type: 'counter'
  }
})

export function createRoomsComponent(
  components: Pick<AppComponents, 'logs' | 'metrics'>,
  broadcast: (roomId: string, message: Uint8Array) => void
): RoomComponent {
  const rooms = new Map<string, Set<InternalWebSocket>>()
  const addressToSocket = new Map<string, InternalWebSocket>()
  const logger = components.logs.getLogger('RoomsComponent')

  // gets or creates a room
  function getRoom(room: string): Set<InternalWebSocket> {
    let r = rooms.get(room)
    if (!r) {
      logger.debug('Creating room', { room })
      r = new Set<InternalWebSocket>()
      rooms.set(room, r)
    }
    observeRoomCount()
    return r
  }

  function observeRoomCount() {
    components.metrics.observe('dcl_ws_rooms_count', {}, rooms.size)
  }
  function observeConnectionCount() {
    components.metrics.observe('dcl_ws_rooms_connections', {}, addressToSocket.size)
  }

  // Removes a socket from a room in the data structure and also forwards the
  // message to the rest of the room.
  // Deletes the room if it becomes empty
  function removeFromRoom(socket: InternalWebSocket) {
    const roomInstance = getRoom(socket.roomId)
    logger.debug('Disconnecting user', {
      room: socket.roomId,
      address: socket.address!,
      alias: socket.alias,
      count: addressToSocket.size
    })
    roomInstance.delete(socket)
    if (socket.address) {
      addressToSocket.delete(socket.address)
    }
    if (roomInstance.size === 0) {
      logger.debug('Destroying room', {
        room: socket.roomId,
        count: rooms.size
      })
      rooms.delete(socket.roomId)
      observeRoomCount()
    }
    observeConnectionCount()

    socket.off('message')

    // inform the room about the peer that left it
    broadcast(
      socket.roomId,
      craftMessage({
        message: {
          $case: 'peerLeaveMessage',
          peerLeaveMessage: { alias: socket.alias }
        }
      })
    )
  }

  // receives an authenticated socket and adds it to a room
  function addSocketToRoom(ws: InternalWebSocket) {
    if (!ws.address) throw new Error('Socket did not contain address')
    if (!ws.roomId) throw new Error('Socket did not contain roomId')
    if (!ws.alias) throw new Error('Socket did not contain alias')

    const address = ws.address

    logger.debug('Connecting user', {
      room: ws.roomId,
      address,
      alias: ws.alias
    })

    const roomInstance = getRoom(ws.roomId)

    // disconnect previous session
    const kicked = getSocket(address)

    if (kicked) {
      logger.info('Kicking user', {
        room: ws.roomId,
        address,
        alias: kicked.alias
      })
      kicked.send(
        craftMessage({
          message: {
            $case: 'peerKicked',
            peerKicked: { reason: 'Already connected' }
          }
        }),
        true
      )
      kicked.close()
      removeFromRoom(kicked)
      logger.info('Kicked user', {
        room: ws.roomId,
        address,
        alias: kicked.alias
      })
      components.metrics.increment('dcl_ws_rooms_kicks_total')
    }

    // 0. before anything else, add the user to the room and hook the 'close' and 'message' events
    roomInstance.add(ws)
    addressToSocket.set(address, ws)
    ws.on('error', (err) => {
      logger.error(err)
      removeFromRoom(ws)
    })
    ws.on('close', () => removeFromRoom(ws))
    ws.on('message', (data) => {
      components.metrics.increment('dcl_ws_rooms_in_messages', {})
      components.metrics.increment('dcl_ws_rooms_in_bytes', {}, data.byteLength)

      // if (!isBinary) {
      //   logger.log('protocol error: data is not binary')
      //   return
      // }

      const { message } = WsPacket.decode(Buffer.from(data))

      if (!message || message.$case !== 'peerUpdateMessage') {
        // we accept unknown messages to enable protocol extensibility and compatibility.
        // do NOT kick the users when they send unknown messages
        components.metrics.increment('dcl_ws_rooms_unknown_sent_messages_total')
        return
      }

      const { body, unreliable } = message.peerUpdateMessage

      const subscribers = roomInstance.size
      components.metrics.increment('dcl_ws_rooms_out_messages', {}, subscribers)
      components.metrics.increment('dcl_ws_rooms_out_bytes', {}, subscribers * data.byteLength)
      ws.publish(
        ws.roomId,
        craftMessage({
          message: {
            $case: 'peerUpdateMessage',
            peerUpdateMessage: {
              fromAlias: ws.alias,
              body,
              unreliable
            }
          }
        }),
        true
      )
    })

    observeConnectionCount()

    // 1. tell the user about their identity and the neighbouring peers,
    //    and disconnect other peers if the address is repeated
    const peerIdentities: Record<number, string> = {}
    for (const peer of roomInstance) {
      if (peer !== ws && peer.address) {
        peerIdentities[peer.alias] = peer.address
      }
    }

    const welcomeMessage = craftMessage({
      message: {
        $case: 'welcomeMessage',
        welcomeMessage: { alias: ws.alias, peerIdentities }
      }
    })

    if (ws.send(welcomeMessage, true) !== 1) {
      logger.error('Closing connection: cannot send welcome message')
      try {
        ws.end()
      } catch {}
      return
    }

    // 2. broadcast to all room that this user is joining them
    const joinedMessage = craftMessage({
      message: {
        $case: 'peerJoinMessage',
        peerJoinMessage: { alias: ws.alias, address }
      }
    })
    broadcast(ws.roomId, joinedMessage)
    ws.subscribe(ws.roomId)

    components.metrics.increment('dcl_ws_rooms_connections_total')
  }

  function isAddressConnected(address: string): boolean {
    return addressToSocket.has(address)
  }

  function getSocket(address: string): InternalWebSocket | undefined {
    return addressToSocket.get(address)
  }

  function connectionsCount(): number {
    return addressToSocket.size
  }

  function roomCount(): number {
    return rooms.size
  }

  function roomsWithCounts(): { roomName: string; count: number }[] {
    return [...rooms.keys()].map((value) => ({
      roomName: value,
      count: rooms.get(value)!.size
    }))
  }

  function getRoomSize(room: string): number {
    return rooms.get(room)?.size || 0
  }

  return {
    connectionsCount,
    roomCount,
    roomsWithCounts,
    getRoom,
    addSocketToRoom,
    isAddressConnected,
    getSocket,
    removeFromRoom,
    getRoomSize
  }
}
