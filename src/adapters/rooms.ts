import { AppComponents, WebSocketHandshakeCompleted } from '../types'
import { craftMessage } from '../logic/craft-message'

export type RoomComponent = {
  connectionsCount(): number
  roomCount(): number
  roomsWithCounts(): { roomName: string; count: number }[]
  addSocketToRoom(ws: WebSocketHandshakeCompleted): void
  removeFromRoom(ws: WebSocketHandshakeCompleted): void
  isAddressConnected(address: string): boolean
  getSocket(address: string): WebSocketHandshakeCompleted | undefined
  getRoom(room: string): Set<WebSocketHandshakeCompleted>
  getRoomSize(room: string): number
}

export function createRoomsComponent(components: Pick<AppComponents, 'logs' | 'metrics' | 'server'>): RoomComponent {
  const { server, logs } = components
  const rooms = new Map<string, Set<WebSocketHandshakeCompleted>>()
  const addressToSocket = new Map<string, WebSocketHandshakeCompleted>()
  const logger = logs.getLogger('RoomsComponent')

  // gets or creates a room
  function getRoom(room: string): Set<WebSocketHandshakeCompleted> {
    let r = rooms.get(room)
    if (!r) {
      logger.debug('Creating room', { room })
      r = new Set<WebSocketHandshakeCompleted>()
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
  function removeFromRoom(socket: WebSocketHandshakeCompleted) {
    const userData = socket.getUserData()
    const roomInstance = getRoom(userData.roomId)
    logger.debug('Disconnecting user', {
      room: userData.roomId,
      address: userData.address,
      alias: userData.alias,
      count: addressToSocket.size
    })
    roomInstance.delete(socket)
    if (userData.address) {
      addressToSocket.delete(userData.address)
    }
    if (roomInstance.size === 0) {
      logger.debug('Destroying room', {
        room: userData.roomId,
        count: rooms.size
      })
      rooms.delete(userData.roomId)
      observeRoomCount()
    }
    observeConnectionCount()

    // inform the room about the peer that left it
    server.app.publish(
      userData.roomId,
      craftMessage({
        message: {
          $case: 'peerLeaveMessage',
          peerLeaveMessage: { alias: userData.alias }
        }
      }),
      true
    )
  }

  // receives an authenticated socket and adds it to a room
  function addSocketToRoom(ws: WebSocketHandshakeCompleted) {
    const userData = ws.getUserData()
    const address = userData.address

    logger.debug('Connecting user', {
      room: userData.roomId,
      address,
      alias: userData.alias
    })

    const roomInstance = getRoom(userData.roomId)

    // disconnect previous session
    const kicked = getSocket(address)

    if (kicked) {
      logger.info('Kicking user', {
        room: userData.roomId,
        address,
        alias: kicked.getUserData().alias
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
        room: userData.roomId,
        address,
        alias: kicked.getUserData().alias
      })
      components.metrics.increment('dcl_ws_rooms_kicks_total')
    }

    // 0. before anything else, add the user to the room and hook the 'close' and 'message' events
    roomInstance.add(ws)
    addressToSocket.set(address, ws)

    observeConnectionCount()

    // 1. tell the user about their identity and the neighbouring peers,
    //    and disconnect other peers if the address is repeated
    const peerIdentities: Record<number, string> = {}
    for (const peer of roomInstance) {
      const peerUserData = peer.getUserData()
      if (peer !== ws && peerUserData.address) {
        peerIdentities[peerUserData.alias] = peerUserData.address
      }
    }

    const welcomeMessage = craftMessage({
      message: {
        $case: 'welcomeMessage',
        welcomeMessage: { alias: userData.alias, peerIdentities }
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
        peerJoinMessage: { alias: userData.alias, address }
      }
    })
    server.app.publish(userData.roomId, joinedMessage, true)
    ws.subscribe(userData.roomId)

    components.metrics.increment('dcl_ws_rooms_connections_total')
  }

  function isAddressConnected(address: string): boolean {
    return addressToSocket.has(address)
  }

  function getSocket(address: string): WebSocketHandshakeCompleted | undefined {
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
