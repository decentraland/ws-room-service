import { EthAddress } from '@dcl/schemas'
import { AppComponents, WebSocket } from '../types'
import { Authenticator } from '@dcl/crypto'
import { wsAsAsyncChannel } from './ws-as-async-channel'
import { normalizeAddress } from './address'
import { craftMessage } from './craft-message'
import { DEFAULT_MAX_USERS } from '../controllers/archipelago-adapter'

export async function handleSocketLinearProtocol(
  {
    config,
    rooms,
    logs,
    ethereumProvider,
    metrics
  }: Pick<AppComponents, 'config' | 'rooms' | 'logs' | 'ethereumProvider' | 'metrics'>,
  socket: WebSocket
) {
  const maxUsers = (await config.getNumber('MAX_USERS')) || DEFAULT_MAX_USERS

  const logger = logs.getLogger('LinearProtocol')
  // Wire the socket to a pushable channel
  const channel = wsAsAsyncChannel(socket)

  try {
    // process the messages
    /// 1. the remote client sends their authentication message
    let packet = await channel.yield(1000, 'Timed out waiting for peer identification')

    if (!packet.message || packet.message.$case !== 'peerIdentification') {
      throw new Error('Invalid protocol. peerIdentification packet missed')
    }

    if (!EthAddress.validate(packet.message.peerIdentification.address))
      throw new Error('Invalid protocol. peerIdentification has an invalid address')

    const address = normalizeAddress(packet.message.peerIdentification.address)

    // Check that the max number of users in a room has not been reached
    if (rooms.getRoomSize(socket.roomId) >= maxUsers) {
      logger.error('Closing connection: kicking user as the room is already at max capacity')
      const kickMessage = craftMessage({
        message: {
          $case: 'peerKicked',
          peerKicked: {
            reason: 'This world is full. Try again later.'
          }
        }
      })
      if (socket.send(kickMessage, true) !== 1) {
        logger.error('Closing connection: cannot send kick message')
      }

      socket.end()
      return
    }

    const challengeToSign = 'dcl-' + Math.random().toString(36)
    const alreadyConnected = rooms.isAddressConnected(address)
    logger.debug('Generating challenge', {
      challengeToSign,
      address,
      alreadyConnected: alreadyConnected + ''
    })

    const challengeMessage = craftMessage({
      message: {
        $case: 'challengeMessage',
        challengeMessage: { alreadyConnected, challengeToSign }
      }
    })
    if (socket.send(challengeMessage, true) !== 1) {
      logger.error('Closing connection: cannot send challenge')
      socket.close()
      return
    }

    /// 3. wait for the confirmation message
    packet = await channel.yield(1000, 'Timed out waiting for signed challenge response')

    if (!packet.message || packet.message.$case !== 'signedChallengeForServer') {
      throw new Error('Invalid protocol. signedChallengeForServer packet missed')
    }

    const result = await Authenticator.validateSignature(
      challengeToSign,
      JSON.parse(packet.message.signedChallengeForServer.authChainJson),
      ethereumProvider
    )

    if (!result.ok) {
      logger.error(`Authentication failed`, { message: result.message } as any)
      throw new Error('Authentication failed')
    }
    logger.debug(`Authentication successful`, { address })

    // disconnect previous session
    const kicked = rooms.getSocket(address)

    if (kicked) {
      const room = socket.roomId
      logger.info('Kicking user', { room, address, alias: kicked.alias })
      kicked.send(craftMessage({ message: { $case: 'peerKicked', peerKicked: { reason: 'Already connected' } } }), true)
      kicked.close()
      rooms.removeFromRoom(kicked)
      logger.info('Kicked user', { room, address, alias: kicked.alias })
      metrics.increment('dcl_ws_rooms_kicks_total')
    }

    socket.address = address
    rooms.addSocketToRoom(socket, address)

    // 1. tell the user about their identity and the neighbouring peers,
    //    and disconnect other peers if the address is repeated
    const peerIdentities: Record<number, string> = {}
    for (const peer of rooms.getRoom(socket.roomId)) {
      if (peer !== socket && peer.address) {
        peerIdentities[peer.alias] = peer.address
      }
    }

    const welcomeMessage = craftMessage({
      message: {
        $case: 'welcomeMessage',
        welcomeMessage: { alias: socket.alias, peerIdentities }
      }
    })
    if (socket.send(welcomeMessage, true) !== 1) {
      logger.error('Closing connection: cannot send welcome message')
      socket.close()
      return
    }

    // 2. broadcast to all room that this user is joining them
    const joinedMessage = craftMessage({
      message: {
        $case: 'peerJoinMessage',
        peerJoinMessage: { alias: socket.alias, address }
      }
    })
    socket.subscribe(socket.roomId)
    socket.publish(socket.roomId, joinedMessage, true)

    metrics.increment('dcl_ws_rooms_connections_total')
  } finally {
    // close the channel to remove the listener
    channel.close()
  }
}
