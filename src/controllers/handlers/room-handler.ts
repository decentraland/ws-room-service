import { Authenticator } from '@dcl/crypto'
import { WsPacket } from '@dcl/protocol/out-js/decentraland/kernel/comms/rfc5/ws_comms.gen'
import { AuthChain, EthAddress } from '@dcl/schemas'
import { WebSocket as UWWebSocket, onRequestEnd, onRequestStart } from '@well-known-components/uws-http-server'
import { normalizeAddress } from '../../logic/address'
import { craftMessage } from '../../logic/craft-message'
import {
  AppComponents,
  WebSocket,
  WsUserData,
  Stage,
  WsUserDataExtra,
  WsUserDataBasic,
  WebSocketHandshakeCompleted
} from '../../types'

const DEFAULT_MAX_USERS = 150

export async function registerWsHandler(
  components: Pick<AppComponents, 'logs' | 'ethereumProvider' | 'rooms' | 'config' | 'server' | 'metrics'>
) {
  const { logs, server, config, metrics, rooms, ethereumProvider } = components
  const logger = logs.getLogger('Websocket Handler')

  const timeout_ms = (await config.getNumber('HANDSHAKE_TIMEOUT')) || 1000 // 1 sec
  const maxUsers = (await config.getNumber('MAX_USERS')) || DEFAULT_MAX_USERS

  function startTimeoutHandler(ws: WebSocket) {
    const data = ws.getUserData()
    data.timeout = setTimeout(() => {
      try {
        logger.debug(`Terminating socket in stage: ${data.stage} because of timeout`)
        ws.end()
      } catch (err) {}
    }, timeout_ms)
  }

  function changeStage<T extends WsUserDataExtra>(ws: WebSocket, newData: T): UWWebSocket<WsUserDataBasic & T> {
    const userData = ws.getUserData()
    Object.assign(userData, newData)
    return ws as UWWebSocket<WsUserDataBasic & T>
  }

  let connectionCounter = 0
  server.app.ws<WsUserData>('/rooms/:roomId', {
    idleTimeout: 90,
    upgrade: (res, req, context) => {
      logger.debug('upgrade requested')
      const { labels, end } = onRequestStart(metrics, req.getMethod(), '/ws')
      /* This immediately calls open handler, you must not use res after this call */
      const userData: WsUserData = {
        stage: Stage.HANDSHAKE_START,
        alias: ++connectionCounter,
        roomId: req.getParameter(0)
      }
      res.upgrade(
        userData,
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      )
      onRequestEnd(metrics, labels, 101, end)
    },
    open: (ws) => {
      logger.debug('ws open')
      startTimeoutHandler(ws)
    },
    message: async (ws, message) => {
      const userData = ws.getUserData()
      if (userData.timeout) {
        clearTimeout(userData.timeout)
        userData.timeout = undefined
      }

      try {
        const packet = WsPacket.decode(Buffer.from(message))

        switch (userData.stage) {
          case Stage.HANDSHAKE_START: {
            if (!packet.message || packet.message.$case !== 'peerIdentification') {
              logger.debug('Invalid protocol. peerIdentification packet missed')
              ws.end()
              return
            }
            if (!EthAddress.validate(packet.message.peerIdentification.address)) {
              logger.debug('Invalid protocol. peerIdentification has an invalid address')
              ws.end()
              return
            }

            if (rooms.getRoomSize(userData.roomId) >= maxUsers) {
              logger.warn('Closing connection: kicking user as the room is already at max capacity')
              const kickMessage = craftMessage({
                message: {
                  $case: 'peerKicked',
                  peerKicked: {
                    reason: 'This world is full. Try again later.'
                  }
                }
              })

              if (ws.send(kickMessage, true) !== 1) {
                logger.error('Closing connection: cannot send kick message')
              }
              ws.end()
              return
            }

            const address = normalizeAddress(packet.message.peerIdentification.address)

            const challengeToSign = 'dcl-' + Math.random().toString(36)
            const previousWs = rooms.getSocket(address)
            const alreadyConnected = !!previousWs
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

            if (ws.send(challengeMessage, true) !== 1) {
              logger.error('Closing connection: cannot send challenge')
              ws.close()
              return
            }

            changeStage(ws, {
              stage: Stage.HANDSHAKE_CHALLENGE_SENT,
              challengeToSign
            })
            startTimeoutHandler(ws)
            break
          }
          case Stage.HANDSHAKE_CHALLENGE_SENT: {
            if (!packet.message || packet.message.$case !== 'signedChallengeForServer') {
              logger.debug('Invalid protocol. signedChallengeForServer packet missed')
              ws.end()
              return
            }

            const authChain = JSON.parse(packet.message.signedChallengeForServer.authChainJson)
            if (!AuthChain.validate(authChain)) {
              logger.debug('Invalid auth chain')
              ws.end()
              return
            }

            const result = await Authenticator.validateSignature(userData.challengeToSign, authChain, ethereumProvider)

            if (result.ok) {
              const address = normalizeAddress(authChain[0].payload)
              logger.debug(`Authentication successful`, { address })

              const previousWs = rooms.getSocket(address)
              if (previousWs) {
                logger.debug('Sending kick message')
                const kickedMessage = craftMessage({
                  message: {
                    $case: 'peerKicked',
                    peerKicked: {
                      reason: 'This world is full. Try again later.'
                    }
                  }
                })
                if (previousWs.send(kickedMessage, true) !== 1) {
                  logger.error('Closing connection: cannot send kicked message')
                }
                previousWs.end()
              }

              rooms.addSocketToRoom(
                changeStage(ws, {
                  stage: Stage.HANDSHAKE_COMPLETED,
                  address
                })
              )
            } else {
              logger.warn(`Authentication failed`, { message: result.message } as any)
              ws.end()
            }
            break
          }
          case Stage.HANDSHAKE_COMPLETED: {
            components.metrics.increment('dcl_ws_rooms_in_messages', {})
            components.metrics.increment('dcl_ws_rooms_in_bytes', {}, message.byteLength)

            if (packet.message && packet.message.$case === 'peerUpdateMessage') {
              const { body, unreliable } = packet.message.peerUpdateMessage
              const subscribers = server.app.numSubscribers(userData.roomId)
              components.metrics.increment('dcl_ws_rooms_out_messages', {}, subscribers)
              components.metrics.increment('dcl_ws_rooms_out_bytes', {}, subscribers * message.byteLength)
              ws.publish(
                userData.roomId,
                craftMessage({
                  message: {
                    $case: 'peerUpdateMessage',
                    peerUpdateMessage: {
                      fromAlias: userData.alias,
                      body,
                      unreliable
                    }
                  }
                }),
                true
              )
            } else {
              // we accept unknown messages to enable protocol extensibility and compatibility.
              // do NOT kick the users when they send unknown messages
              components.metrics.increment('dcl_ws_rooms_unknown_sent_messages_total')
            }
            break
          }
          default: {
            logger.error('Invalid stage')
            break
          }
        }
      } catch (err: any) {
        logger.error(err)
        ws.end()
      }
    },
    close: (ws, code, _message) => {
      logger.debug(`Websocket closed ${code}`)
      const data = ws.getUserData()
      if (data.stage === Stage.HANDSHAKE_COMPLETED) {
        rooms.removeFromRoom(ws as any as WebSocketHandshakeCompleted)
      }
    }
  })
}
