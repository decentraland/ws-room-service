import { Middleware } from '@well-known-components/http-server/dist/middleware'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { GlobalContext } from '../../types'
import { verify } from 'jsonwebtoken'

export const isAuthenticatedMiddleware: Middleware<IHttpServerComponent.DefaultContext<GlobalContext>> = async (
  context,
  next
) => {
  const secret = await context.components.config.getString('WS_ROOM_SERVICE_SECRET')

  if (!secret) {
    return next()
  }

  const token = context.url.searchParams.get('access_token')

  if (!token) {
    return {
      status: 401
    }
  }

  try {
    const decodedToken = verify(token, secret) as any
    const audience = decodedToken['audience'] as string
    if (audience === context.url.toString()) {
      return next()
    }
    return {
      status: 401
    }
  } catch (err) {
    return {
      status: 401
    }
  }
}
