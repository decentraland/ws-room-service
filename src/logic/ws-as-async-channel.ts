import { AsyncQueue } from '@well-known-components/pushable-channel'
import { WsPacket } from '@dcl/protocol/out-js/decentraland/kernel/comms/rfc5/ws_comms.gen'

import { InternalWebSocket } from '../types'

export function wsAsAsyncChannel(socket: Pick<InternalWebSocket, 'on' | 'emit' | 'off' | 'end'>) {
  // Wire the socket to a pushable channel
  const channel = new AsyncQueue<WsPacket>((queue, action) => {
    if (action === 'close') {
      socket.off('message')
      socket.off('close', closeChannel)
    }
  })
  function processMessage(data: ArrayBuffer) {
    try {
      channel.enqueue(WsPacket.decode(new Uint8Array(data)))
    } catch (error: any) {
      socket.emit('error', error)
      try {
        socket.end()
      } catch {}
    }
  }
  function closeChannel() {
    channel.close()
  }
  socket.on('message', processMessage)
  socket.on('close', closeChannel)
  socket.on('error', closeChannel)
  return Object.assign(channel, {
    async yield(timeoutMs: number, error?: string): Promise<WsPacket> {
      if (timeoutMs) {
        const next: any = (await Promise.race([channel.next(), timeout(timeoutMs, error)])) as any
        if (next.done) throw new Error('Cannot consume message from closed AsyncQueue. ' + error)
        return next.value
      } else {
        const next = await channel.next()
        if (next.done) throw new Error('Cannot consume message from closed AsyncQueue.' + error)
        return next.value
      }
    }
  })
}

function timeout(ms: number, error = 'Timed out') {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(error)), ms)
  })
}
