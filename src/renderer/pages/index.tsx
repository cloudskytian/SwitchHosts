import events from '@common/events'
import About from '@renderer/components/About'
import EditHostsInfo from '@renderer/components/EditHostsInfo'
import History from '@renderer/components/History'
import LeftPanel from '@renderer/components/LeftPanel'
import Loading from '@renderer/components/Loading'
import MainPanel from '@renderer/components/MainPanel'
import PreferencePanel from '@renderer/components/Pref'
import SetWriteMode from '@renderer/components/SetWriteMode'
import SudoPasswordInput from '@renderer/components/SudoPasswordInput'
import UpdateDialog from '@renderer/components/UpdateDialog'
import { agent } from '@renderer/core/agent'
import useOnBroadcast from '@renderer/core/useOnBroadcast'
import useConfigs from '@renderer/models/useConfigs'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import useHostsData from '../models/useHostsData'
import useI18n from '../models/useI18n'
import styles from './index.module.scss'

export default () => {
  const [loading, setLoading] = useState(true)
  const { setLocale } = useI18n()
  const { loadHostsData } = useHostsData()
  const { configs } = useConfigs()
  const [left_width, setLeftWidth] = useState(0)
  const [left_show, setLeftShow] = useState(true)
  const [use_system_window_frame, setSystemFrame] = useState(false)
  const init = async () => {
    // v5: migration is handled automatically by the Rust backend on startup.
    // The renderer only needs to load data.
    await loadHostsData()
    setLoading(false)
  }

  const onConfigsUpdate = async () => {
    if (!configs) return

    setLocale(configs.locale)
    setLeftWidth(configs.left_panel_width)
    setLeftShow(configs.left_panel_show)
    setSystemFrame(configs.use_system_window_frame)

    let theme = configs.theme
    let cls = document.body.className
    document.body.className = cls.replace(/\btheme-\w+/gi, '')
    document.body.classList.add(`platform-${agent.platform}`, `theme-${theme}`)
    await agent.darkModeToggle(theme)
  }

  useEffect(() => {
    init().catch((e) => console.error(e))
  }, [])

  useEffect(() => {
    onConfigsUpdate().catch((e) => console.error(e))
  }, [configs])

  useOnBroadcast(events.toggle_left_panel, (show: boolean) => setLeftShow(show))

  if (loading) {
    return <Loading />
  }

  return (
    <div className={styles.root}>
      <TopBar show_left_panel={left_show} use_system_window_frame={use_system_window_frame} />

      <div>
        <div
          className={styles.left}
          style={{
            width: left_width,
            left: left_show ? 0 : -left_width,
          }}
        >
          <LeftPanel width={left_width} />
        </div>
        <div
          className={clsx(styles.main)}
          style={{ width: `calc(100% - ${left_show ? left_width : 0}px)` }}
        >
          <MainPanel />
        </div>
      </div>

      <EditHostsInfo />
      <SudoPasswordInput />
      <SetWriteMode />
      <PreferencePanel />
      <History />
      <UpdateDialog />
      <About />
    </div>
  )
}
