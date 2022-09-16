import { IBaseComponent } from '@well-known-components/interfaces'
import { WebSocket } from 'ws'

import { BaseComponents } from '../types'

export type CloseHandler = () => void
export type MessageHandler = (data: Uint8Array) => void

type IWebSocket = {
  send(data: Uint8Array): void
}

export type IWebSocketConnectorComponent = IBaseComponent & {
  connect(url: string, onMessage: MessageHandler, onClose: CloseHandler): Promise<IWebSocket>
}

export function createWsConnectorComponent({ logs }: Pick<BaseComponents, 'logs'>): IWebSocketConnectorComponent {
  const logger = logs.getLogger('ws connector')

  function connect(url: string, onMessage: MessageHandler, onClose: CloseHandler): Promise<IWebSocket> {
    return new Promise<IWebSocket>((resolve, reject) => {
      try {
        const ws = new WebSocket(url)
        ws.on('open', () => {
          resolve(ws)
        })

        ws.on('error', (err) => {
          logger.error(`WS Error: ${err.toString()}`)
        })

        ws.on('close', onClose)
        ws.on('message', onMessage)
      } catch (err) {
        return reject(err)
      }
    })
  }

  return {
    connect
  }
}
