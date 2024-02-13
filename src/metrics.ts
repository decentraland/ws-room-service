import { IMetricsComponent } from '@well-known-components/interfaces'
import { getDefaultHttpMetrics, validateMetricsDeclaration } from '@well-known-components/uws-http-server'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  dcl_ws_rooms_count: {
    help: 'Current amount of rooms',
    type: IMetricsComponent.GaugeType
  },
  dcl_ws_rooms_connections: {
    help: 'Current amount of connections',
    type: IMetricsComponent.GaugeType
  },
  dcl_ws_rooms_connections_total: {
    help: 'Total amount of connections',
    type: IMetricsComponent.CounterType
  },
  dcl_ws_rooms_kicks_total: {
    help: 'Total amount of kicked players',
    type: IMetricsComponent.CounterType
  },
  dcl_ws_rooms_unknown_sent_messages_total: {
    help: 'Total amount of unkown messages',
    type: IMetricsComponent.CounterType
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
