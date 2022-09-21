import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createFetchComponent } from './ports/fetch'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { createWsComponent } from './ports/ws'
import { createWsConnectorComponent } from './ports/ws-connector'
import { createRoomsComponent } from './adapters/rooms'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })

  const logs = await createLogComponent({})
  const ws = await createWsComponent({ logs })
  const server = await createServerComponent<GlobalContext>(
    { config, logs, ws: ws.ws },
    {
      cors: {
        maxAge: 36000
      }
    }
  )
  const statusChecks = await createStatusCheckComponent({ server, config })
  const fetch = await createFetchComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const wsConnector = createWsConnectorComponent({ logs })
  const rooms = createRoomsComponent({ logs, metrics })
  await instrumentHttpServerWithMetrics({ metrics, config, server })

  return {
    config,
    logs,
    server,
    statusChecks,
    fetch,
    ws,
    metrics,
    wsConnector,
    rooms
  }
}
