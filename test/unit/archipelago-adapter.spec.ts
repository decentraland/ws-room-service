// import { createTestMetricsComponent } from '@well-known-components/metrics'
// import { metricDeclarations } from '../../src/metrics'
// import { websocketRoomHandler } from '../../src/controllers/handlers/ws-room-handler'
import { createLogComponent } from '@well-known-components/logger'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createArchipelagoAdapter } from '../../src/controllers/archipelago-adapter'
import { CloseHandler, MessageHandler } from '../../src/ports/ws-connector'
import {
  TransportAuthorizationResponse,
  TransportHeartbeat,
  TransportInit,
  TransportMessage,
  TransportType
} from '../../src/proto/archipelago.gen'
import { future } from 'fp-future'
import { createRoomsRegistryComponent } from '../../src/ports/connections-registry'

describe('archipelago-adapter', () => {
  it('ok', async () => {
    const logs = createLogComponent()
    const config = createConfigComponent({
      ARCHIPELAGO_TRANSPORT_REGISTRATION_URL: 'ws://archipelago',
      ARCHIPELAGO_TRANSPORT_REGISTRATION_SECRET: '123456',
      WS_ROOM_SERVICE_URL: 'ws://ws-room-service',
      WS_ROOM_SERVICE_SECRET: '123456'
    })

    let onMessageListener: MessageHandler
    let onCloseListener: CloseHandler

    const init = future<TransportInit>()
    const authResponse = future<TransportAuthorizationResponse>()
    const heartbeat = future<TransportHeartbeat>()

    const wsConnector = {
      connect: async (_: string, _onMessage: MessageHandler, _onClose: CloseHandler) => {
        onMessageListener = _onMessage
        onCloseListener = _onClose
        return {
          send(msg: Uint8Array) {
            const { message } = TransportMessage.decode(msg)
            switch (message.$case) {
              case 'init':
                init.resolve(message.init)
                break
              case 'heartbeat':
                heartbeat.resolve(message.heartbeat)
                break
              case 'authResponse':
                authResponse.resolve(message.authResponse)
                break
            }
          }
        }
      }
    }

    const roomsRegistry = createRoomsRegistryComponent()
    await createArchipelagoAdapter({ logs, config, wsConnector, roomsRegistry })

    expect((await init).type).toBe(TransportType.TRANSPORT_WS)
    expect((await init).maxIslandSize).toBe(100)

    onMessageListener(
      TransportMessage.encode({
        message: {
          $case: 'authRequest',
          authRequest: {
            requestId: 'request1',
            userIds: ['user1', 'user2'],
            roomId: 'I1'
          }
        }
      }).finish()
    )

    const { requestId, connStrs } = await authResponse
    expect(requestId).toEqual('request1')
    expect(connStrs.user1).toEqual(expect.stringContaining('ws-room:ws://ws-room-service/ws-rooms/I1?access_token='))
    expect(connStrs.user2).toEqual(expect.stringContaining('ws-room:ws://ws-room-service/ws-rooms/I1?access_token='))

    expect((await heartbeat).availableSeats).toEqual(150)
    expect((await heartbeat).usersCount).toEqual(0)

    onCloseListener()
  })
})
