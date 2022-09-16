import { IBaseComponent } from '@well-known-components/interfaces'

import { Peer } from '../types'

export type IRoomsRegistryComponent = IBaseComponent & {
  getPeers(roomId: string): Set<Peer>
  addPeer(roomId: string, peer: Peer): void
  removePeer(roomId: string, peer: Peer): void
  connectionsCount(): number
  roomsCount(): number
}

export function createRoomsRegistryComponent(): IRoomsRegistryComponent {
  const peersByRoom = new Map<string, Set<Peer>>()

  function getPeers(roomId: string): Set<Peer> {
    let set = peersByRoom.get(roomId)
    if (!set) {
      set = new Set()
      peersByRoom.set(roomId, set)
    }
    return set
  }

  function addPeer(roomId: string, p: Peer) {
    const room = peersByRoom.get(roomId) || new Set<Peer>()
    room.add(p)
    peersByRoom.set(roomId, room)
  }

  function removePeer(roomId: string, p: Peer) {
    const room = peersByRoom.get(roomId)
    if (room) {
      room.delete(p)
      if (room.size === 0) {
        peersByRoom.delete(roomId)
      }
    }
  }

  function connectionsCount() {
    let count = 0
    for (const [_, peers] of peersByRoom) {
      count += peers.size
    }
    return count
  }

  function roomsCount() {
    return peersByRoom.size
  }

  return {
    getPeers,
    addPeer,
    removePeer,
    connectionsCount,
    roomsCount
  }
}
