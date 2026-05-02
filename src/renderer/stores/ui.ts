import { atom } from 'jotai'

export type LeftPanelView = 'list' | 'trashcan'

export const left_panel_view_atom = atom<LeftPanelView>('list')
