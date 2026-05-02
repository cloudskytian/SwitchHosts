/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import StatusBar from '@renderer/components/StatusBar'
import styles from './HostsViewer.module.scss'

interface Props {
  content: string
}

const HostsViewer = (props: Props) => {
  const { content } = props
  const lines = content.split('\n')

  const Line = (p: { line: string }) => {
    return <div className={styles.line}>{p.line}</div>
  }

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        {lines.map((line, idx) => (
          <Line line={line} key={idx} />
        ))}
      </div>
      <StatusBar lineCount={lines.length} bytes={content.length} readOnly={true} />
    </div>
  )
}

export default HostsViewer
