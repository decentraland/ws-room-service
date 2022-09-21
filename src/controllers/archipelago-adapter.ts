import { TransportMessage, TransportType } from '../proto/archipelago.gen'
import { Reader } from 'protobufjs/minimal'
import { sign } from 'jsonwebtoken'

import { BaseComponents } from '../types'

const HEARTBEAT_INTERVAL_MS = 10 * 1000 // 10sec
const RETRY_MS = 1000 // 1sec

const DEFAULT_MAX_USERS = 150

export async function createArchipelagoAdapter({
  config,
  logs,
  wsConnector,
  rooms
}: Pick<BaseComponents, 'logs' | 'config' | 'wsConnector' | 'rooms'>) {
  const logger = logs.getLogger('Archipelago Adapter')

  const registrationURL = await config.requireString('ARCHIPELAGO_TRANSPORT_REGISTRATION_URL')
  const registrationSecret = await config.requireString('ARCHIPELAGO_TRANSPORT_REGISTRATION_SECRET')
  const baseURL = await config.requireString('WS_ROOM_SERVICE_URL')
  const secret = await config.requireString('WS_ROOM_SERVICE_SECRET')
  const maxUsers = (await config.getNumber('MAX_USERS')) || DEFAULT_MAX_USERS

  let heartbeatInterval: undefined | NodeJS.Timer = undefined

  async function connect() {
    const onMessage = (message: Uint8Array) => {
      const transportMessage = TransportMessage.decode(Reader.create(message as Buffer))

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

    const usersCount = rooms.connectionsCount()

    function sendHeartbeat() {
      ws.send(
        TransportMessage.encode({
          message: {
            $case: 'heartbeat',
            heartbeat: {
              availableSeats: maxUsers - usersCount,
              usersCount: usersCount
            }
          }
        }).finish()
      )
    }

    heartbeatInterval = setInterval(() => {
      sendHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    sendHeartbeat()
  }

  await connect()
}
