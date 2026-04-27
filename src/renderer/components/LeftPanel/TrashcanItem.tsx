/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import { ITrashcanListObject } from '@common/data'
import ConfirmModal from '@renderer/components/ConfirmModal'
import ItemIcon from '@renderer/components/ItemIcon'
import list_item_styles from '@renderer/components/List/ListItem.module.scss'
import { actions } from '@renderer/core/agent'
import {
  getErrorMessage,
  showErrorNotification,
  showSuccessNotification,
} from '@renderer/core/notify'
import { PopupMenu } from '@renderer/core/PopupMenu'
import useHostsData from '@renderer/models/useHostsData'
import useI18n from '@renderer/models/useI18n'
import clsx from 'clsx'
import { useState } from 'react'
import styles from './TrashcanItem.module.scss'

interface Props {
  data: ITrashcanListObject
}

const TrashcanItem = (props: Props) => {
  const { data } = props
  const { lang } = useI18n()
  const { hosts_data, loadHostsData } = useHostsData()
  const [is_delete_confirm_open, setIsDeleteConfirmOpen] = useState(false)
  const [is_clear_confirm_open, setIsClearConfirmOpen] = useState(false)

  const onSelect = (i: any) => {
    console.log(i)
  }

  const doPermanentDelete = () => {
    actions
      .deleteItemFromTrashcan(data.id)
      .then(async (success: boolean) => {
        if (!success) {
          showErrorNotification({ title: lang.hosts_delete, message: lang.fail })
          return
        }
        await loadHostsData()
        showSuccessNotification({ title: lang.hosts_delete, message: lang.success })
      })
      .catch((e: unknown) => {
        showErrorNotification({
          title: lang.hosts_delete,
          message: getErrorMessage(e, lang.fail),
        })
      })
  }

  const doRestore = () => {
    actions
      .restoreItemFromTrashcan(data.id)
      .then(async (success: boolean) => {
        if (!success) {
          showErrorNotification({ title: lang.trashcan_restore, message: lang.fail })
          return
        }
        await loadHostsData()
        showSuccessNotification({ title: lang.trashcan_restore, message: lang.success })
      })
      .catch((e: unknown) => {
        showErrorNotification({
          title: lang.trashcan_restore,
          message: getErrorMessage(e, lang.fail),
        })
      })
  }

  const doClearTrashcan = () => {
    actions
      .clearTrashcan()
      .then(async () => {
        await loadHostsData()
        showSuccessNotification({ title: lang.trashcan_clear, message: lang.success })
      })
      .catch((e: unknown) => {
        showErrorNotification({
          title: lang.trashcan_clear,
          message: getErrorMessage(e, lang.fail),
        })
      })
  }

  const menu_for_all = new PopupMenu([
    {
      label: lang.trashcan_clear,
      enabled: hosts_data.trashcan.length > 0,
      click() {
        setIsClearConfirmOpen(true)
      },
    },
  ])

  const menu_for_item = new PopupMenu([
    {
      label: lang.trashcan_restore,
      click() {
        doRestore()
      },
    },
    {
      type: 'separator',
    },
    {
      label: lang.hosts_delete,
      click() {
        setIsDeleteConfirmOpen(true)
      },
    },
  ])

  return (
    <div
      className={clsx(styles.root, data.is_root && styles.trashcan_title)}
      onContextMenu={(e) => {
        if (data.is_root) {
          menu_for_all.show()
        } else {
          menu_for_item.show()
        }

        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className={styles.title} onClick={onSelect}>
        <span className={list_item_styles.icon}>
          <ItemIcon type={data.type} is_collapsed={true} />
        </span>

        {data.data.title || lang.untitled}

        {data.is_root ? <span className={styles.count}>{data.children?.length || 0}</span> : null}
      </div>

      <ConfirmModal
        opened={is_delete_confirm_open}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={doPermanentDelete}
        title={lang.hosts_delete}
        message={lang.trashcan_delete_confirm}
        confirmLabel={lang.delete}
        danger
      />

      <ConfirmModal
        opened={is_clear_confirm_open}
        onClose={() => setIsClearConfirmOpen(false)}
        onConfirm={doClearTrashcan}
        title={lang.trashcan_clear}
        message={lang.trashcan_clear_confirm}
        confirmLabel={lang.delete}
        danger
      />
    </div>
  )
}

export default TrashcanItem
