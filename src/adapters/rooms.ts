import { AppComponents, WebSocket } from '../types'
import { validateMetricsDeclaration } from '@well-known-components/metrics'

export type RoomComponent = {
  connectionsCount(): number
  addSocketToRoom(ws: WebSocket, address: string): void
  removeFromRoom(ws: WebSocket): void
  isAddressConnected(address: string): boolean
  getSocket(address: string): WebSocket | undefined
  getRoom(room: string): Set<WebSocket>
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

export function createRoomsComponent(components: Pick<AppComponents, 'logs' | 'metrics'>): RoomComponent {
  const rooms = new Map<string, Set<WebSocket>>()
  const addressToSocket = new Map<string, WebSocket>()
  const logger = components.logs.getLogger('RoomsComponent')

  // gets or creates a room
  function getRoom(room: string): Set<WebSocket> {
    let r = rooms.get(room)
    if (!r) {
      logger.debug('Creating room', { room })
      r = new Set<WebSocket>()
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
  function removeFromRoom(socket: WebSocket) {
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
      logger.debug('Destroying room', { room: socket.roomId, count: rooms.size })
      rooms.delete(socket.roomId)
      observeRoomCount()
    }
    observeConnectionCount()
  }

  // receives an authenticated socket and adds it to a room
  function addSocketToRoom(ws: WebSocket, address: string) {
    logger.debug('Connecting user', { room: ws.roomId, address, alias: ws.alias })

    const roomInstance = getRoom(ws.roomId)

    // 0. before anything else, add the user to the room and hook the 'close' and 'message' events
    roomInstance.add(ws)
    addressToSocket.set(address, ws)
    observeConnectionCount()
  }

  function isAddressConnected(address: string): boolean {
    return addressToSocket.has(address)
  }

  function getSocket(address: string): WebSocket | undefined {
    return addressToSocket.get(address)
  }

  function connectionsCount(): number {
    return addressToSocket.size
  }

  function getRoomSize(room: string): number {
    return rooms.get(room)?.size || 0
  }

  return {
    connectionsCount,
    getRoom,
    addSocketToRoom,
    isAddressConnected,
    getSocket,
    removeFromRoom,
    getRoomSize
  }
}
