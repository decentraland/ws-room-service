import { wsAsAsyncChannel } from './ws-as-async-channel'
import { createIdentity } from 'eth-crypto'
import { test } from '../components'
import { future } from 'fp-future'
import { WebSocket } from 'ws'
import { craftMessage } from '../../src/adapters/rooms'
import { TestComponents } from '../../src/types'
import { sha512 } from 'ethereum-cryptography/sha512'
import { utf8ToBytes } from 'ethereum-cryptography/utils'
import { sign } from 'jsonwebtoken'

function normalizeAddress(address: string) {
  return address.toLowerCase()
}

export function createEphemeralIdentity(entropy: string) {
  const theRealEntropy = Buffer.concat([sha512(utf8ToBytes(entropy)), sha512(utf8ToBytes(entropy))])
  return createIdentity(theRealEntropy).address
}

test('end to end test', ({ components }) => {
  const aliceIdentity = createEphemeralIdentity('alice')
  const bobIdentity = createEphemeralIdentity('bob')
  const cloheIdentity = createEphemeralIdentity('clohe')

  it('connects two the websocket and share messages', async () => {
    const alice = await connectSocket(components, aliceIdentity, 'testRoom')
    const bob = await connectSocket(components, bobIdentity, 'testRoom')

    // when bob joins the room, the welcome message contains alice's information
    expect(bob.welcomeMessage.peerIdentities).toEqual({
      [alice.welcomeMessage.alias]: normalizeAddress(alice.address)
    })

    console.log(alice.address, alice.welcomeMessage.alias)
    console.log(bob.address, bob.welcomeMessage.alias)
    // when bob connects alice receives peerJoinMessage
    const { message } = await alice.channel.yield(1000, 'when bob connects alice receives peerJoinMessage')
    expect(message).toEqual(
      expect.objectContaining({
        $case: 'peerJoinMessage',
        peerJoinMessage: {
          address: normalizeAddress(bob.address),
          alias: bob.welcomeMessage.alias
        }
      })
    )

    {
      // alice sends a message that needs to reach bob
      await socketSend(
        alice,
        craftMessage({
          message: { $case: 'peerUpdateMessage', peerUpdateMessage: { fromAlias: 0, body: Uint8Array.from([1, 2, 3]) } }
        })
      )
      const { message } = await bob.channel.yield(1000, 'alice awaits message from bob')
      expect(message).toEqual(
        expect.objectContaining({
          $case: 'peerUpdateMessage',
          peerUpdateMessage: {
            body: Uint8Array.from([1, 2, 3]),
            fromAlias: alice.welcomeMessage.alias
          }
        })
      )
    }

    {
      // when a new peer is connected to another room it does not ring any bell on the connected peers
      const clohe = await connectSocket(components, cloheIdentity, 'another-room')
      clohe.close()
    }

    {
      // bob sends a message that needs to reach alice
      await socketSend(
        bob,
        craftMessage({
          message: { $case: 'peerUpdateMessage', peerUpdateMessage: { fromAlias: 0, body: Uint8Array.from([3, 2, 3]) } }
        })
      )
      const { message } = await alice.channel.yield(1000, 'alice awaits message from bob')
      expect(message).toEqual(
        expect.objectContaining({
          $case: 'peerUpdateMessage',
          peerUpdateMessage: {
            body: Uint8Array.from([3, 2, 3]),
            fromAlias: bob.welcomeMessage.alias
          }
        })
      )
    }

    {
      // then clohe joins the room and leaves, sends a message and leaves
      const clohe = await connectSocket(components, cloheIdentity, 'testRoom')

      {
        // clohe receives welcome with bob and alice
        expect(clohe.welcomeMessage.peerIdentities).toEqual({
          [alice.welcomeMessage.alias]: normalizeAddress(alice.address),
          [bob.welcomeMessage.alias]: normalizeAddress(bob.address)
        })
      }

      {
        // alice receives peerJoinMessage
        const { message } = await alice.channel.yield(1000, 'alice receives peerJoinMessage')
        expect(message.$case).toEqual('peerJoinMessage')
        // expect(peerJoinMessage.address).toEqual(normalizeAddress(clohe.address))
        // expect(peerJoinMessage.alias).toEqual(clohe.welcomeMessage.alias)
      }

      {
        // bob receives peerJoinMessage
        const { message } = await bob.channel.yield(1000, 'bob receives peerJoinMessage')
        expect(message.$case).toEqual('peerJoinMessage')
        // expect(peerJoinMessage.address).toEqual(normalizeAddress(clohe.address))
        // expect(peerJoinMessage.alias).toEqual(clohe.welcomeMessage.alias)
      }
      {
        // then send a message
        await socketSend(
          clohe,
          craftMessage({
            message: { $case: 'peerUpdateMessage', peerUpdateMessage: { fromAlias: 0, body: Uint8Array.from([6]) } }
          })
        )

        {
          // alice receives update
          const { message } = await alice.channel.yield(1000, 'alice receives update')
          expect(message.$case).toEqual('peerUpdateMessage')
          // expect(peerUpdateMessage.fromAlias).toEqual(clohe.welcomeMessage.alias)
          // expect(Uint8Array.from(peerUpdateMessage.body)).toEqual(Uint8Array.from([6]))
        }

        {
          // bob receives update
          const { message } = await bob.channel.yield(1000, 'bob receives update')
          expect(message.$case).toEqual('peerUpdateMessage')
          // expect(peerUpdateMessage.fromAlias).toEqual(clohe.welcomeMessage.alias)
          // expect(Uint8Array.from(peerUpdateMessage.body)).toEqual(Uint8Array.from([6]))
        }
      }
      {
        // clohe leaves
        clohe.close()

        {
          // alice receives leave
          const { message } = await alice.channel.yield(1000, 'alice receives leave')
          expect(message.$case).toEqual('peerLeaveMessage')
          // expect(peerLeaveMessage.alias).toEqual(clohe.welcomeMessage.alias)
        }

        {
          // bob receives leave
          const { message } = await bob.channel.yield(1000, 'bob receives leave')
          expect(message.$case).toEqual('peerLeaveMessage')
          // expect(peerLeaveMessage.alias).toEqual(clohe.welcomeMessage.alias)
        }
      }
    }

    // and finally alice leaves
    alice.close()

    {
      // bob receives leave
      const { message } = await bob.channel.yield(1000, 'bob receives leave 2')
      expect(message.$case).toEqual('peerLeaveMessage')
      // expect(peerLeaveMessage.alias).toEqual(alice.welcomeMessage.alias)
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

async function connectSocket(components: TestComponents, address: string, room: string) {
  const secret = await components.config.requireString('WS_ROOM_SERVICE_SECRET')
  const accessToken = sign({ peerId: address }, secret, {
    audience: '/rooms/' + room
  })

  const url = '/rooms/' + room + '?access_token=' + accessToken
  console.log(url)

  const ws = components.createLocalWebSocket.createWs(url)
  const channel = wsAsAsyncChannel(ws)

  await socketConnected(ws)

  // expect welcome message from server
  const { message } = await channel.yield(0, 'welcome message did not arrive for ' + address)

  if (message.$case !== 'welcomeMessage') {
    throw new Error('welcome message did not arrive')
  }

  const welcomeMessage = message.welcomeMessage
  return Object.assign(ws, { welcomeMessage, channel, address })
}
