import { GlobalContext } from '../types'
import { statusHandler } from './handlers/status-handler'
import { Router } from '@well-known-components/http-server'
import { websocketHandler } from './handlers/room-handler'
import { isAuthenticatedMiddleware } from './middlewares/is-authenticated'

export async function setupRouter() {
  const router = new Router<GlobalContext>()

  router.get('/status', statusHandler)
  router.get('/rooms/status', statusHandler)
  router.get('/rooms/:roomId', isAuthenticatedMiddleware, websocketHandler)

  return router
}
