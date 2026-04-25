import styles from './index.module.scss'

const RightPanel = () => {
  return (
    <div className={styles.root}>
      <div className={styles.body} />
      <div className={styles.status_bar} />
    </div>
  )
}

export default RightPanel
