import { Writer } from 'protobufjs/minimal'
import * as proto from '../proto/ws-comms-rfc-5.gen'
import { WebSocket } from 'ws'
import { AppComponents } from '../types'
import { validateMetricsDeclaration } from '@well-known-components/metrics'

export type RoomComponent = {
  addSocketToRoom(ws: WebSocket, address: string, room: string): void
  isAddressConnected(address: string): boolean
  connectionsCount(): number
}

export type RoomSocket = {
  ws: WebSocket
  address: string
  alias: number
  room: string
}

export const roomsMetrics = validateMetricsDeclaration({
  dcl_ws_rooms_count: {
    help: 'Current amount of rooms',
    type: 'gauge'
  },
  dcl_ws_rooms_sent_messages_total: {
    help: 'Amount of user sent messages',
    type: 'counter'
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

// we use a shared writer to reduce allocations and leverage its allocation pool
const writer = new Writer()
export function craftMessage(packet: proto.WsPacket): Uint8Array {
  writer.reset()
  proto.WsPacket.encode(packet as any, writer)
  return writer.finish()
}

export function createRoomsComponent(components: Pick<AppComponents, 'logs' | 'metrics'>): RoomComponent {
  const rooms = new Map<string, Set<RoomSocket>>()
  const addressToSocket = new Map<string, RoomSocket>()
  const logger = components.logs.getLogger('RoomsComponent')

  let connectionCounter = 0

  // gets or creates a room
  function getRoom(room: string) {
    let r = rooms.get(room)
    if (!r) {
      logger.debug('Creating room', { room })
      r = new Set()
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

  function connectionsCount(): number {
    let count = 0
    for (const [_, connections] of rooms) {
      count += connections.size
    }
    return count
  }

  // Removes a socket from a room in the data structure and also forwards the
  // message to the rest of the room.
  // Deletes the room if it becomes empty
  function removeFromRoom(roomSocket: RoomSocket) {
    const roomInstance = getRoom(roomSocket.room)
    logger.debug('Disconnecting user', {
      room: roomSocket.room,
      address: roomSocket.address,
      alias: roomSocket.alias,
      count: addressToSocket.size
    })
    roomInstance.delete(roomSocket)
    addressToSocket.delete(roomSocket.address)
    if (roomInstance.size === 0) {
      logger.debug('Destroying room', { room: roomSocket.room, count: rooms.size })
      rooms.delete(roomSocket.room)
      observeRoomCount()
    } else {
      broadcastToRoom(
        roomInstance,
        craftMessage({ message: { $case: 'peerLeaveMessage', peerLeaveMessage: { alias: roomSocket.alias } } }),
        roomSocket
      )
    }
    observeConnectionCount()
  }

  // simply sends a message to a socket. disconnects the socket upon failure
  function sendMessage(socket: WebSocket, message: Uint8Array) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message, (err) => {
        if (err) {
          logger.error(err)
          socket.close()
        }
      })
    }
  }

  // broadcasts a message to a room. optionally it can skip one socket
  function broadcastToRoom(roomSockets: Set<RoomSocket>, message: Uint8Array, excludePeer: RoomSocket) {
    for (const peer of roomSockets) {
      if (peer === excludePeer) continue
      sendMessage(peer.ws, message)
    }
  }

  // receives an authenticated socket and adds it to a room
  function addSocketToRoom(ws: WebSocket, address: string, room: string) {
    const alias = ++connectionCounter
    const newRoomSocket: RoomSocket = {
      ws,
      alias,
      address,
      room
    }
    logger.debug('Connecting user', { room, address, alias })

    // disconnect previous session
    const kicked = addressToSocket.get(newRoomSocket.address)

    if (kicked) {
      logger.info('Kicking user', { room, address, alias: kicked.alias })
      sendMessage(kicked.ws, craftMessage({ message: { $case: 'peerKicked', peerKicked: {} } }))
      kicked.ws.close()
      removeFromRoom(kicked)
      logger.info('Kicked user', { room, address, alias: kicked.alias })
      components.metrics.increment('dcl_ws_rooms_kicks_total')
    }

    const roomInstance = getRoom(room)
    // 0. before anything else, add the user to the room and hook the 'close' and 'message' events
    roomInstance.add(newRoomSocket)
    addressToSocket.set(newRoomSocket.address, newRoomSocket)
    newRoomSocket.ws.on('close', () => removeFromRoom(newRoomSocket))
    newRoomSocket.ws.on('message', (body) => {
      const { message } = proto.WsPacket.decode(body as any)
      if (message?.$case === 'peerUpdateMessage') {
        const body = message.peerUpdateMessage.body
        broadcastToRoom(
          roomInstance,
          craftMessage({
            message: {
              $case: 'peerUpdateMessage',
              peerUpdateMessage: { fromAlias: newRoomSocket.alias, body }
            }
          }),
          newRoomSocket
        )
        components.metrics.increment('dcl_ws_rooms_sent_messages_total')
      } else {
        // we accept unknown messages to enable protocol extensibility and compatibility.
        // do NOT kick the users when they send unknown messages
        components.metrics.increment('dcl_ws_rooms_unknown_sent_messages_total')
      }
    })

    observeConnectionCount()

    // 1. tell the user about their identity and the neighbouring peers,
    //    and disconnect other peers if the address is repeated
    const peerIdentities: Record<number, string> = {}
    for (const peer of roomInstance) {
      if (peer.address !== newRoomSocket.address) {
        peerIdentities[peer.alias] = peer.address
      }
    }
    const welcomeMessage = craftMessage({
      message: {
        $case: 'welcomeMessage',
        welcomeMessage: { alias: newRoomSocket.alias, peerIdentities }
      }
    })
    sendMessage(ws, welcomeMessage)

    // 2. broadcast to all room that this user is joining them
    const joinedMessage = craftMessage({
      message: {
        $case: 'peerJoinMessage',
        peerJoinMessage: { alias: newRoomSocket.alias, address: newRoomSocket.address }
      }
    })
    broadcastToRoom(roomInstance, joinedMessage, newRoomSocket)

    components.metrics.increment('dcl_ws_rooms_connections_total')
  }

  function isAddressConnected(address: string): boolean {
    return addressToSocket.has(address)
  }

  return {
    addSocketToRoom,
    isAddressConnected,
    connectionsCount
  }
}
