import { agent } from '@renderer/core/agent'
import { useEffect } from 'react'

type EventHandler = (...args: any[]) => void

const useOnBroadcast = (
  event: string,
  handler: EventHandler,
  deps: any[] = [],
) => {
  // agent.on will return an off function for clean up
  useEffect(() => agent.on(event, handler), deps)
}

export default useOnBroadcast
