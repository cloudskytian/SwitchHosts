import { ActionIcon, Indicator, Stack, Tooltip } from '@mantine/core'
import ConfigMenu from '@renderer/components/TopBar/ConfigMenu'
import useHostsData from '@renderer/models/useHostsData'
import useI18n from '@renderer/models/useI18n'
import { left_panel_view_atom } from '@renderer/stores/ui'
import { IconList, IconTrash } from '@tabler/icons-react'
import { useAtom } from 'jotai'
import styles from './index.module.scss'

const LeftSidebar = () => {
  const { lang } = useI18n()
  const { hosts_data } = useHostsData()
  const [view, setView] = useAtom(left_panel_view_atom)

  return (
    <div className={styles.root}>
      <Stack gap={20} align="center" pt={8}>
        <Tooltip label={'Hosts'} position="right">
          <ActionIcon
            variant={view === 'list' ? 'filled' : 'subtle'}
            color="gray"
            size={28}
            onClick={() => setView('list')}
            aria-label={'Hosts'}
          >
            <IconList size={18} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={lang.trashcan} position="right">
          <Indicator
            label={hosts_data.trashcan.length}
            size={14}
            disabled={hosts_data.trashcan.length === 0}
            color="gray"
            offset={4}
          >
            <ActionIcon
              variant={view === 'trashcan' ? 'filled' : 'subtle'}
              color="gray"
              size={28}
              onClick={() => setView('trashcan')}
              aria-label={lang.trashcan}
            >
              <IconTrash size={18} stroke={1.5} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Stack>

      <div className={styles.spacer} />

      <Stack gap={20} align="center">
        <ConfigMenu
          size={28}
          iconSize={18}
          menuPosition="right-end"
          tooltip={lang.settings}
        />
      </Stack>
    </div>
  )
}

export default LeftSidebar
