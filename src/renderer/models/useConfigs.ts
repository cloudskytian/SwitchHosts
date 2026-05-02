/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import { ConfigsType } from '@common/default_configs'
import { actions } from '@renderer/core/agent'
import { configsAtom } from '@renderer/stores/configs'
import { useAtom } from 'jotai'

export default function useConfigs() {
  const [configs, setConfigs] = useAtom(configsAtom)

  const loadConfigs = async () => {
    setConfigs(await actions.configAll())
  }

  const updateConfigs = async (kv: Partial<ConfigsType>) => {
    if (!configs) return
    // console.log('update configs:', kv)
    const newConfigs = { ...configs, ...kv }
    setConfigs(newConfigs)
    await actions.configUpdate(newConfigs)
  }

  return {
    configs,
    loadConfigs,
    updateConfigs,
  }
}
