import { Writer } from 'protobufjs/minimal'
import { WsPacket } from '../proto/ws_comms.gen'
import { TransportMessage } from '../proto/archipelago.gen'

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
