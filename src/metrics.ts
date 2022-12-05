import { IMetricsComponent } from '@well-known-components/interfaces'
import { getDefaultHttpMetrics, validateMetricsDeclaration } from '@well-known-components/metrics'
import { roomsMetrics } from './adapters/rooms'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...roomsMetrics,
  test_ping_counter: {
    help: 'Count calls to ping',
    type: IMetricsComponent.CounterType,
    labelNames: ['pathname']
  },
  dcl_ws_rooms_in_messages: {
    help: 'Number of incoming messages',
    type: IMetricsComponent.CounterType
  },
  dcl_ws_rooms_in_bytes: {
    help: 'Number of bytes from incoming messages',
    type: IMetricsComponent.CounterType
  },
  dcl_ws_rooms_out_messages: {
    help: 'Number of outgoing messages',
    type: IMetricsComponent.CounterType
  },
  dcl_ws_rooms_out_bytes: {
    help: 'Number of bytes from outgoing messages',
    type: IMetricsComponent.CounterType
  },
  ws_room_service_build_info: {
    help: 'WS room service build info.',
    type: IMetricsComponent.GaugeType,
    labelNames: ['commitHash', 'ethNetwork']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
