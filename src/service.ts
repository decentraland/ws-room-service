import { Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from './controllers/routes'
import * as uWS from 'uWebSockets.js'
import { AppComponents, TestComponents } from './types'
import { createArchipelagoAdapter } from './controllers/archipelago-adapter'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program

  // start ports: db, listeners, synchronizations, etc
  await startComponents()

  const app = uWS.App({})

  await createArchipelagoAdapter(components)

  await setupRouter({ app, components })
  const port = await components.config.requireNumber('HTTP_SERVER_PORT')
  const logger = components.logs.getLogger('server')
  app.listen(port, (token) => {
    if (token) {
      logger.log('Listening to port ' + port)
    } else {
      logger.log('Failed to listen to port ' + port)
    }
  })
}
