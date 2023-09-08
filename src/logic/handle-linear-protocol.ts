import { EthAddress } from '@dcl/schemas'
import { AppComponents, InternalWebSocket } from '../types'
import { Authenticator } from '@dcl/crypto'
import { wsAsAsyncChannel } from './ws-as-async-channel'
import { normalizeAddress } from './address'
import { craftMessage } from './craft-message'

const DEFAULT_MAX_USERS = 150

export async function handleSocketLinearProtocol(
  {
    config,
    rooms,
    logs,
    ethereumProvider
  }: Pick<AppComponents, 'config' | 'rooms' | 'logs' | 'ethereumProvider' | 'metrics'>,
  socket: InternalWebSocket
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
      logger.warn('Closing connection: kicking user as the room is already at max capacity')
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

    if (result.ok) {
      socket.address = normalizeAddress(address)
      logger.debug(`Authentication successful`, { address: address })
    } else {
      logger.warn(`Authentication failed`, { message: result.message } as any)
      throw new Error('Authentication failed')
    }
  } finally {
    // close the channel to remove the listener
    channel.close()
  }
}
