/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import styles from './SwitchButton.module.scss'

interface Props {
  on: boolean
  onChange?: (on: boolean) => void
  disabled?: boolean
}

const SwitchButton = (props: Props) => {
  const { on, onChange, disabled } = props
  const [isOn, setIsOn] = useState(on)
  const [isDisabled, setIsDisabled] = useState(disabled)

  const onClick = () => {
    if (disabled) return

    const newStatus = !isOn
    setIsOn(newStatus)
    if (typeof onChange === 'function') {
      onChange(newStatus)
    }
  }

  useEffect(() => {
    setIsOn(on)
    setIsDisabled(disabled)
  }, [on, disabled])

  return (
    <div
      className={clsx(styles.root, isOn && styles.on, isDisabled && styles.disabled)}
      onClick={onClick}
    >
      <div className={styles.handler} />
    </div>
  )
}

export default SwitchButton
