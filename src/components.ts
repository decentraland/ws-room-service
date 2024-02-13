import { HTTPProvider } from 'eth-connect'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { AppComponents } from './types'
import { metricDeclarations } from './metrics'
import { createRoomsComponent } from './adapters/rooms'
import { observeBuildInfo } from './logic/build-info'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createUWsComponent, createMetricsComponent } from '@well-known-components/uws-http-server'

const DEFAULT_ETH_NETWORK = 'sepolia'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env']
  })

  const ethNetwork = (await config.getString('ETH_NETWORK')) ?? DEFAULT_ETH_NETWORK

  const logs = await createLogComponent({})
  const fetch = createFetchComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const server = await createUWsComponent({ config, logs })

  const rooms = createRoomsComponent({ logs, metrics, server })

  const ethereumProvider = new HTTPProvider(
    `https://rpc.decentraland.org/${encodeURIComponent(ethNetwork)}?project=mini-comms`,
    { fetch: fetch.fetch }
  )

  await observeBuildInfo({ config, metrics })

  return {
    server,
    config,
    logs,
    fetch,
    metrics,
    rooms,
    ethereumProvider
  }
}
