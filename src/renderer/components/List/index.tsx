/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import { IHostsListObject } from '@common/data'
import events from '@common/events'
import { findItemById, flatten, getNextSelectedItem, setOnStateOfItem } from '@common/hostsFn'
import { IFindShowSourceParam } from '@common/types'
import { IHostsWriteOptions } from '@common/types'
import ItemIcon from '@renderer/components/ItemIcon'
import { Tree } from '@renderer/components/Tree'
import { actions, agent } from '@renderer/core/agent'
import useOnBroadcast from '@renderer/core/useOnBroadcast'
import useConfigs from '@renderer/models/useConfigs'
import useHostsData from '@renderer/models/useHostsData'
import useI18n from '@renderer/models/useI18n'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { BiChevronRight } from 'react-icons/bi'
import styles from './index.module.scss'
import ListItem from './ListItem'

interface Props {
  isTray?: boolean
}

const List = (props: Props) => {
  const { isTray } = props
  const { hosts_data, loadHostsData, setList, current_hosts, setCurrentHosts } = useHostsData()
  const { configs } = useConfigs()
  const { lang } = useI18n()
  const [selectedIds, setSelectedIds] = useState<string[]>([current_hosts?.id || '0'])
  const [showList, setShowList] = useState<IHostsListObject[]>([])

  useEffect(() => {
    if (!isTray) {
      setShowList([
        {
          id: '0',
          title: lang.system_hosts,
          is_sys: true,
        },
        ...hosts_data.list,
      ])
    } else {
      setShowList([...hosts_data.list])
    }
  }, [hosts_data])

  useEffect(() => {
    if (isTray || !current_hosts) return
    if (!hosts_data.trashcan.find((item) => item.data.id === current_hosts.id)) return

    setSelectedIds([])
  }, [current_hosts, hosts_data.trashcan, isTray])

  const onToggleItem = async (id: string, on: boolean) => {
    console.log(`writeMode: ${configs?.write_mode}`)
    console.log(`toggle hosts #${id} as ${on ? 'on' : 'off'}`)

    if (!configs?.write_mode) {
      agent.broadcast(events.show_set_write_mode, { id, on })
      return
    }

    const newList = setOnStateOfItem(
      hosts_data.list,
      id,
      on,
      configs?.choice_mode ?? 0,
      configs?.multi_chose_folder_switch_all ?? false,
    )
    const success = await writeHostsToSystem(newList)
    if (success) {
      console.log(lang.success)
      agent.broadcast(events.set_hosts_on_status, id, on)
    } else {
      agent.broadcast(events.set_hosts_on_status, id, !on)
    }
  }

  const writeHostsToSystem = async (
    list?: IHostsListObject[],
    options?: IHostsWriteOptions,
  ): Promise<boolean> => {
    if (!Array.isArray(list)) {
      list = hosts_data.list
    }

    const content: string = await actions.getContentOfList(list)
    const result = await actions.setSystemHosts(content, options)
    if (result.success) {
      setList(list).catch((e) => console.error(e))
      // new Notification(lang.success, {
      //   body: lang.hosts_updated,
      // })

      if (current_hosts) {
        const hosts = findItemById(list, current_hosts.id)
        if (hosts) {
          agent.broadcast(events.set_hosts_on_status, current_hosts.id, hosts.on)
        }
      }
    } else {
      console.log(result)
      loadHostsData().catch((e) => console.log(e))
      let errDesc = lang.fail

      // let body: string = lang.no_access_to_hosts
      if (result.code === 'no_access') {
        if (agent.platform === 'darwin' || agent.platform === 'linux') {
          agent.broadcast(events.show_sudo_password_input, list)
        }
        // } else {
        // body = result.message || 'Unknown error!'
        errDesc = lang.no_access_to_hosts
      }

      // new Notification(lang.fail, {
      //   body,
      // })
      console.error(errDesc)
    }

    agent.broadcast(events.tray_list_updated)

    return result.success
  }

  if (!isTray) {
    useOnBroadcast(events.toggle_item, onToggleItem, [hosts_data, configs])
    useOnBroadcast(events.write_hosts_to_system, writeHostsToSystem, [hosts_data])
  } else {
    useOnBroadcast(events.tray_list_updated, loadHostsData)
  }

  useOnBroadcast(
    events.move_to_trashcan,
    async (ids: string[]) => {
      console.log(`move_to_trashcan: #${ids}`)
      await actions.moveManyToTrashcan(ids)
      await loadHostsData()

      if (current_hosts && ids.includes(current_hosts.id)) {
        // 选中删除指定节点后的兄弟节点
        const nextItem = getNextSelectedItem(hosts_data.list, (i) => ids.includes(i.id))
        setCurrentHosts(nextItem || null)
        setSelectedIds(nextItem ? [nextItem.id] : [])
      }
    },
    [current_hosts, hosts_data],
  )

  useOnBroadcast(
    events.select_hosts,
    async (id: string, waitMs: number = 0) => {
      const hosts = findItemById(hosts_data.list, id)
      if (!hosts) {
        if (waitMs > 0) {
          setTimeout(() => {
            agent.broadcast(events.select_hosts, id, waitMs - 50)
          }, 50)
        }
        return
      }

      setCurrentHosts(hosts)
      setSelectedIds([id])
    },
    [hosts_data],
  )

  useOnBroadcast(events.reload_list, loadHostsData)

  useOnBroadcast(events.hosts_content_changed, async (hostsId: string) => {
    const list: IHostsListObject[] = await actions.getList()
    const hosts = findItemById(list, hostsId)
    if (!hosts || !hosts.on) return

    // 当前 hosts 是开启状态，且内容发生了变化
    await writeHostsToSystem(list)
  })

  useOnBroadcast(events.show_source, async (params: IFindShowSourceParam) => {
    agent.broadcast(events.select_hosts, params.item_id)
  })

  return (
    <div className={styles.root}>
      {/*<SystemHostsItem/>*/}
      <Tree
        data={showList}
        selectedIds={selectedIds}
        onChange={(list) => {
          setShowList(list)
          const newUserList = list.filter((i) => !i.is_sys)

          const enabledIdSeq = (l: IHostsListObject[]) =>
            flatten(l)
              .filter((i) => i.on)
              .map((i) => i.id)
              .join('\n')

          if (
            enabledIdSeq(hosts_data.list) !== enabledIdSeq(newUserList) &&
            configs?.write_mode
          ) {
            writeHostsToSystem(newUserList).catch((e) => console.error(e))
          } else {
            setList(newUserList).catch((e) => console.error(e))
          }
        }}
        onSelect={(ids: string[]) => {
          // console.log(ids)
          setSelectedIds(ids)
        }}
        nodeRender={(data) => (
          <ListItem key={data.id} data={data} isTray={isTray} selectedIds={selectedIds} />
        )}
        collapseArrow={
          <div
            style={{
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BiChevronRight />
          </div>
        }
        nodeAttr={(item) => {
          return {
            can_drag: !item.is_sys && !isTray,
            can_drop_before: !item.is_sys,
            can_drop_in: item.type === 'folder',
            can_drop_after: !item.is_sys,
          }
        }}
        draggingNodeRender={(data) => {
          return (
            <div className={clsx(styles.for_drag)}>
              <span className={clsx(styles.icon, data.type === 'folder' && styles.folder)}>
                <ItemIcon
                  type={data.is_sys ? 'system' : data.type}
                  isCollapsed={data.is_collapsed}
                />
              </span>
              <span>
                {data.title || lang.untitled}
                {selectedIds.length > 1 ? (
                  <span className={styles.items_count}>
                    {selectedIds.length} {lang.items}
                  </span>
                ) : null}
              </span>
            </div>
          )
        }}
        nodeClassName={styles.node}
        nodeDropInClassName={styles.node_drop_in}
        nodeSelectedClassName={styles.node_selected}
        nodeCollapseArrowClassName={styles.arrow}
        allowedMultipleSelection={true}
      />
    </div>
  )
}

export default List
