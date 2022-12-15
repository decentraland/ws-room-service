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
import { WsUserData } from '@well-known-components/http-server/dist/uws'

export type GlobalContext = {
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
  server: IHttpServerComponent<GlobalContext>
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

export type InternalWebSocket = WsUserData & {
  address: string
  alias: number
  roomId: string
}
