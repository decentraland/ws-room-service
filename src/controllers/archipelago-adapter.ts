import { WebSocket } from 'ws'
import { TransportMessage, TransportType } from '../proto/archipelago.gen'
import { Reader } from 'protobufjs/minimal'
import { sign } from 'jsonwebtoken'

import { BaseComponents } from '../types'

const HEARTBEAT_INTERVAL_MS = 10 * 1000 // 10sec
const RETRY_MS = 1000 // 1sec

export async function createArchipelagoAdapter(components: Pick<BaseComponents, 'logs' | 'config'>) {
  const { config, logs } = components

  const logger = logs.getLogger('Archipelago Adapter')

  const registrationURL = await config.requireString('ARCHIPELAGO_TRANSPORT_REGISTRATION_URL')
  const registrationSecret = await config.requireString('ARCHIPELAGO_TRANSPORT_REGISTRATION_SECRET')
  const baseURL = await config.requireString('WS_ROOM_SERVICE_URL')
  const secret = await config.requireString('WS_ROOM_SERVICE_SECRET')

  let heartbeatInterval: undefined | NodeJS.Timer = undefined

  function connect() {
    logger.info(`Connecting to ${registrationURL}`)
    const registrationAccessToken = sign({}, registrationSecret, {
      audience: registrationURL
    })
    const ws = new WebSocket(`${registrationURL}?access_token=${registrationAccessToken}`)
    ws.on('open', () => {
      logger.info('ws open')
      ws.send(
        TransportMessage.encode({
          message: {
            $case: 'init',
            init: {
              type: TransportType.TRANSPORT_WS,
              maxIslandSize: 100
            }
          }
        }).finish()
      )

      heartbeatInterval = setInterval(() => {
        ws.send(
          // TODO
          TransportMessage.encode({
            message: {
              $case: 'heartbeat',
              heartbeat: {
                availableSeats: 100,
                usersCount: 0
              }
            }
          }).finish()
        )
      }, HEARTBEAT_INTERVAL_MS)
    })

    ws.on('message', (message) => {
      const transportMessage = TransportMessage.decode(Reader.create(message as Buffer))

      switch (transportMessage.message?.$case) {
        case 'authRequest': {
          const {
            authRequest: { requestId, userIds, roomId }
          } = transportMessage.message

          logger.info(`authRequest for ${JSON.stringify(userIds)} ${roomId}`)

          const connStrs: Record<string, string> = {}
          const audience = `${baseURL}/ws-rooms/${roomId}`
          for (const peerId of userIds) {
            const accessToken = sign({ peerId }, secret, {
              audience
            })

            connStrs[peerId] = `ws-room:${baseURL}/ws-rooms/${roomId}?access_token=${accessToken}`
          }

          ws.send(
            TransportMessage.encode({
              message: {
                $case: 'authResponse',
                authResponse: {
                  requestId,
                  connStrs
                }
              }
            }).finish()
          )
          break
        }
      }
    })

    ws.on('error', (err) => {
      logger.error(`WS Error: ${err.toString()}, re-trying in ${RETRY_MS}`)
    })

    ws.on('close', () => {
      logger.info(`Socket closed, re-trying in ${RETRY_MS}`)
      clearInterval(heartbeatInterval)
      setTimeout(connect, RETRY_MS)
    })
  }

  connect()
}
