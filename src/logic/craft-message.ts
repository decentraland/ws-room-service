import { Writer } from 'protobufjs/minimal'
import { WsPacket } from '@dcl/protocol/out-js/decentraland/kernel/comms/rfc5/ws_comms.gen'
import { TransportMessage } from '@dcl/protocol/out-js/decentraland/kernel/comms/v3/archipelago.gen'

// we use a shared writer to reduce allocations and leverage its allocation pool
const writer = new Writer()

export function craftMessage(packet: WsPacket): Uint8Array {
  writer.reset()
  WsPacket.encode(packet, writer)
  return writer.finish()
}

export function craftTransportMessage(packet: TransportMessage): Uint8Array {
  writer.reset()
  TransportMessage.encode(packet, writer)
  return writer.finish()
}
