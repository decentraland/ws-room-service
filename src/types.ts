import { HTTPProvider } from 'eth-connect'
import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import { IWebSocketConnectorComponent } from './adapters/ws-connector'
import { RoomComponent } from './adapters/rooms'
import * as uWS from 'uWebSockets.js'
import { Emitter } from 'mitt'

export type GlobalContext = {
  app: uWS.TemplatedApp
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  fetch: IFetchComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  wsConnector: IWebSocketConnectorComponent
  rooms: RoomComponent
  ethereumProvider: HTTPProvider
}

// components used in runtime
export type AppComponents = BaseComponents

// components used in tests
export type TestComponents = BaseComponents & {
  // A fetch component that only hits the test server
  localFetch: IFetchComponent
}

export type IWsTestComponent = {
  createWs(relativeUrl: string): WebSocket
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = any> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>

export enum Stage {
  LINEAR,
  READY
}

export type WsEvents = {
  message: any
  error: any
  close: any
}

export type WebSocketReader = Pick<uWS.WebSocket, 'end' | 'close'> & Emitter<WsEvents>

export type WebSocket = Pick<uWS.WebSocket, 'subscribe'> &
  WebSocketReader & {
    stage: Stage
    roomId: string
    address?: string
    alias: number

    // NOTE(hugo): I prefer to override this ones to make isBinary not default
    send: (data: Uint8Array, isBinary: boolean) => number
    publish: (topic: string, data: Uint8Array, isBinary: boolean) => number
  }
