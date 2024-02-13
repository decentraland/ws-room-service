import { HTTPProvider } from 'eth-connect'
import type {
  IConfigComponent,
  ILoggerComponent,
  IMetricsComponent,
  IFetchComponent
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import { IWebSocketConnectorComponent } from './adapters/ws-connector'
import { RoomComponent } from './adapters/rooms'
import {
  IUWsComponent,
  WebSocket as UWsWebSocket,
  HttpRequest,
  HttpResponse
} from '@well-known-components/uws-http-server'

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  wsConnector: IWebSocketConnectorComponent
  rooms: RoomComponent
  ethereumProvider: HTTPProvider
  server: IUWsComponent
  fetch: IFetchComponent
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

export type JsonBody = Record<string, any>
export type ResponseBody = JsonBody | string

export type IHandlerResult = {
  status?: number
  headers?: Record<string, string>
  body?: ResponseBody
}

export type IHandler = {
  path: string
  f: (res: HttpResponse, req: HttpRequest) => Promise<IHandlerResult>
}

export enum Stage {
  HANDSHAKE_START,
  HANDSHAKE_CHALLENGE_SENT,
  HANDSHAKE_COMPLETED
}

export type WsUserDataBasic = {
  timeout?: NodeJS.Timeout
  roomId: string
  alias: number
  address?: string
}

export type WsUserDataHanshakeStart = {
  stage: Stage.HANDSHAKE_START
}

export type WsUserDataHanshakeChallengeSent = {
  stage: Stage.HANDSHAKE_CHALLENGE_SENT
  challengeToSign: string
}

export type WsUserDataHanshakeCompleted = {
  stage: Stage.HANDSHAKE_COMPLETED
  address: string
}

export type WsUserDataExtra = WsUserDataHanshakeStart | WsUserDataHanshakeChallengeSent | WsUserDataHanshakeCompleted
export type WsUserData = WsUserDataBasic & WsUserDataExtra

export type WebSocket = UWsWebSocket<WsUserData>
export type WebSocketHandshakeCompleted = UWsWebSocket<WsUserData & WsUserDataHanshakeCompleted>
