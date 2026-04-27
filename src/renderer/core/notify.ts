import { notifications } from '@mantine/notifications'
import { IconCheck, IconX } from '@tabler/icons-react'
import { createElement } from 'react'

interface AppNotificationOptions {
  title: string
  message: string
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return fallbackMessage
}

export function showSuccessNotification({ title, message }: AppNotificationOptions) {
  notifications.show({
    title,
    message,
    color: 'green',
    icon: createElement(IconCheck, { size: 18, stroke: 1.8 }),
    autoClose: 3500,
  })
}

export function showErrorNotification({ title, message }: AppNotificationOptions) {
  notifications.show({
    title,
    message,
    color: 'red',
    icon: createElement(IconX, { size: 18, stroke: 1.8 }),
    autoClose: 6000,
  })
}
