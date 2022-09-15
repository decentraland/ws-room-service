import { createTestMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from '../../src/metrics'
import { websocketRoomHandler } from '../../src/controllers/handlers/ws-room-handler'
import { createLogComponent } from '@well-known-components/logger'
import { createConfigComponent } from '@well-known-components/env-config-provider'

describe("ws-room-handler-unit", () => {

  let url;
  let config;
  let logs;
  let metrics;

  beforeEach(() => {
    url = new URL("https://github.com/well-known-components")
    config = createConfigComponent({
      "WS_ROOM_SERVICE_SECRET": "123456",
    })
    logs  = createLogComponent()
    metrics = createTestMetricsComponent(metricDeclarations)
  })


  it("must return the pathname of a URL", async () => {
    expect((await metrics.getValue("test_ping_counter")).values).toEqual([])
    let response = await websocketRoomHandler({
      params: { roomId: 'some-room-id'},
      url,
      components: { config, logs, metrics }
    })
    expect(response).toHaveProperty('status', 101)
  })
})
