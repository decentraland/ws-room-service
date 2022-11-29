import mitt from 'mitt'
import { verify } from 'jsonwebtoken'
import * as uWS from 'uWebSockets.js'
import { GlobalContext, Stage, WebSocket } from '../types'
import { WsPacket } from '../proto/ws_comms.gen'
import { handleSocketLinearProtocol } from '../logic/handle-linear-protocol'
import { craftMessage } from '../logic/craft-message'

let connectionCounter = 0

export async function setupRouter({ app, components }: GlobalContext): Promise<void> {
  const { logs, metrics, config } = components
  const logger = logs.getLogger('rooms')

  const commitHash = await config.getString('COMMIT_HASH')
  const status = JSON.stringify({ commitHash })

  const secret = await config.getString('WS_ROOM_SERVICE_SECRET')
  if (!secret) {
    logger.warn('No secret defined, no access token will be required')
  }

  const isAuthorized = (req: uWS.HttpRequest): boolean => {
    if (!secret) {
      return true
    }
    const qs = new URLSearchParams(req.getQuery())
    const token = qs.get('access_token')

    if (!token) {
      return false
    }

    try {
      const decodedToken = verify(token, secret) as any
      const audience = decodedToken['audience'] as string
      return audience !== req.getUrl()
    } catch (err) {
      logger.error(err as Error)
      return false
    }
  }

  app
    .get('/status', async (res) => {
      res.end(status)
    })
    .get('/metrics', async (res) => {
      const body = await (metrics as any).registry.metrics()
      res.end(body)
    })
    .ws('/rooms/:roomId', {
      compression: uWS.DISABLED,
      upgrade: (res, req, context) => {
        if (!isAuthorized(req)) {
          res.writeStatus('401 Not Authorized')
          res.end()
          return
        }

        const roomId = req.getParameter(0)
        res.upgrade(
          {
            // NOTE: this is user data
            url: req.getUrl(),
            roomId,
            ...mitt()
          },
          /* Spell these correctly */
          req.getHeader('sec-websocket-key'),
          req.getHeader('sec-websocket-protocol'),
          req.getHeader('sec-websocket-extensions'),
          context
        )
      },
      open: (_ws) => {
        const ws = _ws as any as WebSocket
        ws.stage = Stage.LINEAR
        ws.alias = ++connectionCounter
        handleSocketLinearProtocol(components, ws)
          .then(() => {
            ws.stage = Stage.READY
          })
          .catch((err: any) => {
            logger.error(err)
            try {
              ws.close()
            } catch {}
          })
      },
      message: (_ws, data, isBinary) => {
        if (!isBinary) {
          logger.log('protocol error: data is not binary')
          return
        }

        const ws = _ws as any as WebSocket

        switch (ws.stage) {
          case Stage.LINEAR: {
            _ws.emit('message', Buffer.from(data))
            break
          }
          case Stage.READY: {
            const { message } = WsPacket.decode(Buffer.from(data))
            if (!message || message.$case !== 'peerUpdateMessage') {
              // we accept unknown messages to enable protocol extensibility and compatibility.
              // do NOT kick the users when they send unknown messages
              metrics.increment('dcl_ws_rooms_unknown_sent_messages_total')
              return
            }

            const { body, unreliable } = message.peerUpdateMessage
            ws.publish(
              ws.roomId,
              craftMessage({
                message: {
                  $case: 'peerUpdateMessage',
                  peerUpdateMessage: {
                    fromAlias: ws.alias,
                    body,
                    unreliable
                  }
                }
              }),
              true
            )

            break
          }
        }
      },
      close: (_ws) => {
        logger.log('WS closed')

        const ws = _ws as any as WebSocket
        components.rooms.removeFromRoom(ws)
        app.publish(
          ws.roomId,
          craftMessage({ message: { $case: 'peerLeaveMessage', peerLeaveMessage: { alias: ws.alias } } }),
          true
        )
      }
    })
}
