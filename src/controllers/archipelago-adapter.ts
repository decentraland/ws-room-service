import { WebSocket } from 'ws'
import { TransportMessage, TransportType } from '../proto/archipelago.gen'
import { Reader } from 'protobufjs/minimal'

import { BaseComponents } from '../types'

const HEARTBEAT_INTERVAL_MS = 10 * 1000 // 10sec
const RETRY_MS = 1000 // 1sec

export async function createArchipelagoAdapter(components: Pick<BaseComponents, 'logs' | 'config'>) {
  const { config, logs } = components

  const logger = logs.getLogger('Archipelago Adapter')

  const registrationURL = await config.requireString('ARCHIPELAGO_TRANSPORT_REGISTRATION_URL')
  const baseURL = 'ws://localhost:6000' // TODO

  let heartbeatInterval: undefined | NodeJS.Timer = undefined

  function connect() {
    logger.info(`Connecting to ${registrationURL}`)
    const ws = new WebSocket(registrationURL)
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
            authRequest: { userId, roomId }
          } = transportMessage.message

          logger.info(`authRequest ${userId} ${roomId}`)
          ws.send(
            TransportMessage.encode({
              message: {
                $case: 'authResponse',
                authResponse: {
                  userId,
                  roomId,
                  connectionString: `${baseURL}/ws-rooms/${roomId}`
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
