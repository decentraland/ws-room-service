import { HTTPProvider } from 'eth-connect'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createUwsHttpServer } from '@well-known-components/http-server/dist/uws'
import { createLogComponent } from '@well-known-components/logger'
import { createFetchComponent } from './adapters/fetch'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { createWsConnectorComponent } from './adapters/ws-connector'
import { createRoomsComponent } from './adapters/rooms'
import { observeBuildInfo } from './logic/build-info'
import { getUnderlyingServer } from '@well-known-components/http-server'
import { TemplatedApp } from 'uWebSockets.js'

const DEFAULT_ETH_NETWORK = 'goerli'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env']
  })

  const ethNetwork = (await config.getString('ETH_NETWORK')) ?? DEFAULT_ETH_NETWORK

  const logs = await createLogComponent({})
  const fetch = await createFetchComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const wsConnector = createWsConnectorComponent({ logs })
  const server = await createUwsHttpServer<GlobalContext>({ config, logs }, { compression: false })
  const uws = await getUnderlyingServer<TemplatedApp>(server)

  const rooms = createRoomsComponent({ logs, metrics }, (room, message) => {
    uws.publish(room, message, true)
  })

  const ethereumProvider = new HTTPProvider(
    `https://rpc.decentraland.org/${encodeURIComponent(ethNetwork)}?project=mini-comms`,
    { fetch: fetch.fetch }
  )

  await observeBuildInfo({ config, metrics })

  await instrumentHttpServerWithMetrics({ metrics, config, server })

  return {
    server,
    config,
    logs,
    fetch,
    metrics,
    wsConnector,
    rooms,
    ethereumProvider
  }
}
