/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import { I18N, LocaleName, languages } from '@common/i18n'
import { atom } from 'jotai'

export function resolveSystemLocale(): LocaleName {
  const raw = (typeof navigator !== 'undefined' && navigator.language) || ''
  if (raw in languages) return raw as LocaleName
  const short = raw.split('-')[0]
  if (short in languages) return short as LocaleName
  return 'en'
}

const _locale = localStorage.getItem('locale') as LocaleName | undefined

export const locale_atom = atom<LocaleName>(_locale || resolveSystemLocale())
export const i18n_atom = atom((get) => new I18N(get(locale_atom)))
export const is_half_width_atom = atom((get) => get(i18n_atom).lang.colon.startsWith(':'))
export const lang_atom = atom((get) => get(i18n_atom).lang)
