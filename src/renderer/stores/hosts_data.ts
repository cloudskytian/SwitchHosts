/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import version from '@/version.json'
import { IHostsBasicData, IHostsListObject } from '@common/data'
import { atom } from 'jotai'

export const hosts_data_atom = atom<IHostsBasicData>({
  list: [],
  trashcan: [],
  version,
})

export const current_hosts_atom = atom<IHostsListObject | null>(null)
