import { wsAsAsyncChannel } from '../../src/logic/ws-as-async-channel'
import { test } from '../components'
import { createEphemeralIdentity } from '../helpers/identity'
import { future } from 'fp-future'
import { craftMessage } from '../../src/logic/craft-message'
import { normalizeAddress } from '../../src/logic/address'
import { WebSocket } from 'ws'
import {
  WsChallengeRequired,
  WsPacket,
  WsWelcome
} from '@dcl/protocol/out-js/decentraland/kernel/comms/rfc5/ws_comms.gen'
import { URL } from 'url'
import mitt from 'mitt'
import { InternalWebSocket } from '../../src/types'
import { WsEvents } from '@well-known-components/http-server/dist/uws'

function expectPacket<T>(packet: WsPacket, packetType: string): T {
  if (!packet.message || packet.message.$case !== packetType) {
    throw new Error(`Expected packet type ${packetType}`)
  }

  return packet.message[packetType]
}

test('end to end test', ({ components }) => {
  const aliceIdentity = createEphemeralIdentity('alice')
  const bobIdentity = createEphemeralIdentity('bob')
  const cloheIdentity = createEphemeralIdentity('clohe')

  async function createWs(relativeUrl: string): Promise<WebSocket> {
    const protocolHostAndProtocol = `ws://${await components.config.requireString(
      'HTTP_SERVER_HOST'
    )}:${await components.config.requireNumber('HTTP_SERVER_PORT')}`
    const url = new URL(relativeUrl, protocolHostAndProtocol).toString()
    const ws = new WebSocket(url) as any
    ws.end = ws.terminate
    return ws
  }

  function adaptSocket(sock: WebSocket): Pick<InternalWebSocket, 'on' | 'off' | 'emit' | 'end'> {
    const events = mitt<WsEvents>()

    sock.addEventListener('message', (evt) => {
      events.emit('message', evt.data as ArrayBuffer)
    })
    sock.addEventListener('close', (_) => {
      events.emit('close')
    })
    sock.addEventListener('error', (_) => {
      events.emit('error')
    })
    sock.addEventListener('open', (_) => {
      events.emit('open')
    })

    return {
      ...events,
      end() {
        sock.close()
      }
    }
  }

  async function connectSocket(identity: ReturnType<typeof createEphemeralIdentity>, room: string) {
    const ws = await createWs('/rooms/' + room)
    const channel = wsAsAsyncChannel(adaptSocket(ws))

    await socketConnected(ws)
    await socketSend(
      ws,
      craftMessage({
        message: {
          $case: 'peerIdentification',
          peerIdentification: { address: identity.address }
        }
      })
    )

    // get the challenge from the server
    let packet = await channel.yield(0, 'challenge message did not arrive for ' + identity.address)
    const challengeMessage = expectPacket<WsChallengeRequired>(packet, 'challengeMessage')

    // sign the challenge
    const authChainJson = JSON.stringify(await identity.sign(challengeMessage.challengeToSign))
    await socketSend(
      ws,
      craftMessage({
        message: {
          $case: 'signedChallengeForServer',
          signedChallengeForServer: { authChainJson }
        }
      })
    )

    // expect welcome message from server
    packet = await channel.yield(0, 'welcome message did not arrive for ' + identity.address)
    const welcomeMessage = expectPacket<WsWelcome>(packet, 'welcomeMessage')
    return Object.assign(ws, { welcomeMessage, channel, identity, challengeMessage, authChainJson })
  }

  it('connecting one socket and sending nothing should disconnect it after one second', async () => {
    const ws = await createWs('/rooms/test')
    const fut = futureWithTimeout(3000, 'The socket was not closed')

    ws.on('close', fut.resolve) // resolve on close
    ws.on('message', fut.reject) // fail on timeout and message

    await fut
  })

  it('connecting one socket and sending noise should disconnect it immediately', async () => {
    const ws = await createWs('/rooms/test')
    const fut = futureWithTimeout(3000, 'The socket was not closed')

    ws.on('close', fut.resolve) // resolve on close
    ws.on('message', fut.reject) // fail on timeout and message

    await socketConnected(ws)
    await socketSend(ws, new Uint8Array([1, 2, 3, 4, 5, 6]))
    await fut
  })

  it('connects the websocket and authenticates', async () => {
    const ws = await connectSocket(aliceIdentity, 'testRoom')
    ws.close()
  })

  it('connects the websocket and authenticates, doing it twice disconnects former connection', async () => {
    const ws1 = await connectSocket(aliceIdentity, 'testRoom')
    const ws2 = await connectSocket(aliceIdentity, 'testRoom')

    const ws1DisconnectPromise = futureWithTimeout(1000, 'Socket did not disconnect')
    ws1.on('close', ws1DisconnectPromise.resolve)

    // connect ws2 should say "alreadyConnected=true"
    expect(ws2.challengeMessage.alreadyConnected).toEqual(true)

    const packet = await ws1.channel.yield(100, 'wait for kicked message')
    expect(packet.message.$case).toEqual('peerKicked')

    // await for disconnection of ws1
    await ws1DisconnectPromise

    // cleanup
    ws2.close()
  })

  it('connects two websockets and share messages', async () => {
    const alice = await connectSocket(aliceIdentity, 'testRoom')
    const bob = await connectSocket(bobIdentity, 'testRoom')

    // when bob joins the room, the welcome message contains alice's information
    expect(bob.welcomeMessage.peerIdentities).toMatchObject({
      [alice.welcomeMessage.alias]: normalizeAddress(alice.identity.address)
    })

    // when bob connects alice receives peerJoinMessage
    let packet = await alice.channel.yield(1000, 'when bob connects alice receives peerJoinMessage')
    expect(packet.message).toMatchObject({
      $case: 'peerJoinMessage',
      peerJoinMessage: {
        address: normalizeAddress(bob.identity.address),
        alias: bob.welcomeMessage.alias
      }
    })

    {
      // alice sends a message that needs to reach bob
      await socketSend(
        alice,
        craftMessage({
          message: {
            $case: 'peerUpdateMessage',
            peerUpdateMessage: { fromAlias: 0, body: Uint8Array.from([1, 2, 3]), unreliable: false }
          }
        })
      )
      packet = await bob.channel.yield(1000, 'alice awaits message from bob')
      expect(packet.message).toMatchObject({
        $case: 'peerUpdateMessage',
        peerUpdateMessage: {
          fromAlias: alice.welcomeMessage.alias,
          body: Uint8Array.from([1, 2, 3]),
          unreliable: false
        }
      })
    }

    {
      // when a new peer is connected to another room it does not ring any bell on the connected peers
      const clohe = await connectSocket(cloheIdentity, 'another-room')
      clohe.close()
    }

    {
      // bob sends a message that needs to reach alice
      await socketSend(
        bob,
        craftMessage({
          message: {
            $case: 'peerUpdateMessage',
            peerUpdateMessage: {
              fromAlias: 0,
              body: Uint8Array.from([3, 2, 3]),
              unreliable: false
            }
          }
        })
      )
      packet = await alice.channel.yield(1000, 'alice awaits message from bob')
      expect(packet.message).toMatchObject({
        $case: 'peerUpdateMessage',
        peerUpdateMessage: {
          fromAlias: bob.welcomeMessage.alias,
          body: Uint8Array.from([3, 2, 3]),
          unreliable: false
        }
      })
    }

    {
      // then clohe joins the room and leaves, sends a message and leaves
      const clohe = await connectSocket(cloheIdentity, 'testRoom')

      {
        // clohe receives welcome with bob and alice
        expect(clohe.welcomeMessage.peerIdentities).toMatchObject({
          [alice.welcomeMessage.alias]: normalizeAddress(alice.identity.address),
          [bob.welcomeMessage.alias]: normalizeAddress(bob.identity.address)
        })
      }

      {
        // alice receives peerJoinMessage
        packet = await alice.channel.yield(1000, 'alice receives peerJoinMessage')
        expect(packet.message).toMatchObject({
          $case: 'peerJoinMessage',
          peerJoinMessage: {
            address: normalizeAddress(clohe.identity.address),
            alias: clohe.welcomeMessage.alias
          }
        })
      }

      {
        // bob receives peerJoinMessage
        packet = await bob.channel.yield(1000, 'bob receives peerJoinMessage')
        expect(packet.message).toMatchObject({
          $case: 'peerJoinMessage',
          peerJoinMessage: {
            address: normalizeAddress(clohe.identity.address),
            alias: clohe.welcomeMessage.alias
          }
        })
      }
      {
        // then send a message
        await socketSend(
          clohe,
          craftMessage({
            message: {
              $case: 'peerUpdateMessage',
              peerUpdateMessage: {
                fromAlias: 0,
                body: Uint8Array.from([6]),
                unreliable: false
              }
            }
          })
        )

        {
          // alice receives update
          packet = await alice.channel.yield(1000, 'alice receives update')
          expect(packet.message).toMatchObject({
            $case: 'peerUpdateMessage',
            peerUpdateMessage: {
              fromAlias: clohe.welcomeMessage.alias,
              body: Uint8Array.from([6]),
              unreliable: false
            }
          })
        }

        {
          // bob receives update
          packet = await bob.channel.yield(1000, 'bob receives update')
          expect(packet.message).toMatchObject({
            $case: 'peerUpdateMessage',
            peerUpdateMessage: {
              fromAlias: clohe.welcomeMessage.alias,
              body: Uint8Array.from([6]),
              unreliable: false
            }
          })
        }
      }
      {
        // clohe leaves
        clohe.close()

        {
          // alice receives leave
          packet = await alice.channel.yield(1000, 'alice receives leave')
          expect(packet.message).toMatchObject({
            $case: 'peerLeaveMessage',
            peerLeaveMessage: {
              alias: clohe.welcomeMessage.alias
            }
          })
        }

        {
          // bob receives leave
          packet = await bob.channel.yield(1000, 'bob receives leave')
          expect(packet.message).toMatchObject({
            $case: 'peerLeaveMessage',
            peerLeaveMessage: {
              alias: clohe.welcomeMessage.alias
            }
          })
        }
      }
    }

    // and finally alice leaves
    alice.close()

    {
      // bob receives leave
      packet = await bob.channel.yield(1000, 'bob receives leave 2')
      expect(packet.message).toMatchObject({
        $case: 'peerLeaveMessage',
        peerLeaveMessage: {
          alias: alice.welcomeMessage.alias
        }
      })
    }

    bob.close()
  })
})

function socketConnected(socket: WebSocket): Promise<void> {
  return new Promise((res) => socket.on('open', res))
}

function socketSend(socket: WebSocket, message: Uint8Array): Promise<void> {
  return new Promise((res, rej) => {
    socket.send(message, (err) => {
      if (err) rej(err)
      else res()
    })
  })
}

function futureWithTimeout<T = any>(ms: number, message = 'Timed out') {
  const fut = future<T>()
  const t = setTimeout(() => fut.reject(new Error(message)), ms)
  fut.finally(() => clearTimeout(t))
  return fut
}
