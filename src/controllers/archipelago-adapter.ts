import { TransportMessage, TransportType } from '@dcl/protocol/out-js/decentraland/kernel/comms/v3/archipelago.gen'
import { sign } from 'jsonwebtoken'

import { BaseComponents } from '../types'
import { craftTransportMessage } from '../logic/craft-message'

const HEARTBEAT_INTERVAL_MS = 10 * 1000 // 10sec
const RETRY_MS = 1000 // 1sec

export const DEFAULT_MAX_USERS = 150

export async function createArchipelagoAdapter({
  config,
  logs,
  wsConnector,
  rooms
}: Pick<BaseComponents, 'logs' | 'config' | 'wsConnector' | 'rooms'>) {
  const logger = logs.getLogger('Archipelago Adapter')

  const registrationURL = await config.getString('ARCHIPELAGO_TRANSPORT_REGISTRATION_URL')
  if (!registrationURL) {
    logger.debug(`No registration URL is defined, this transport won't register itself`)
    return
  }

  const registrationSecret = await config.requireString('ARCHIPELAGO_TRANSPORT_REGISTRATION_SECRET')
  const baseURL = await config.requireString('WS_ROOM_SERVICE_URL')
  const secret = await config.requireString('WS_ROOM_SERVICE_SECRET')
  const maxUsers = (await config.getNumber('MAX_USERS')) || DEFAULT_MAX_USERS

  let heartbeatInterval: undefined | NodeJS.Timer = undefined

  async function connect() {
    const onMessage = (message: Uint8Array) => {
      const transportMessage = TransportMessage.decode(Buffer.from(message))

      switch (transportMessage.message?.$case) {
        case 'authRequest': {
          const {
            authRequest: { requestId, userIds, roomId }
          } = transportMessage.message

          logger.info(`authRequest for ${JSON.stringify(userIds)} ${roomId}`)

          const connStrs: Record<string, string> = {}
          const url = `${baseURL}/rooms/${roomId}`
          for (const peerId of userIds) {
            const accessToken = sign({ peerId }, secret, {
              audience: url
            })

            connStrs[peerId] = `ws-room:${url}?access_token=${accessToken}`
          }

          ws.send(
            craftTransportMessage({
              message: {
                $case: 'authResponse',
                authResponse: {
                  requestId,
                  connStrs
                }
              }
            })
          )
          break
        }
      }
    }

    const onClose = () => {
      logger.info(`Socket closed, re-trying in ${RETRY_MS}`)
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
      }
      setTimeout(() => {
        connect().catch((err) => logger.error(err))
      }, RETRY_MS)
    }

    logger.info(`Connecting to ${registrationURL}`)
    const registrationAccessToken = sign({}, registrationSecret, {
      audience: registrationURL
    })
    const ws = await wsConnector.connect(
      `${registrationURL}?access_token=${registrationAccessToken}`,
      onMessage,
      onClose
    )

    logger.info('is open')
    ws.send(
      craftTransportMessage({
        message: {
          $case: 'init',
          init: {
            type: TransportType.TT_WS,
            maxIslandSize: 100
          }
        }
      })
    )

    const usersCount = rooms.connectionsCount()

    function sendHeartbeat() {
      ws.send(
        craftTransportMessage({
          message: {
            $case: 'heartbeat',
            heartbeat: {
              availableSeats: maxUsers - usersCount,
              usersCount: usersCount
            }
          }
        })
      )
    }

    heartbeatInterval = setInterval(() => {
      sendHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    sendHeartbeat()
  }

  await connect()
}
