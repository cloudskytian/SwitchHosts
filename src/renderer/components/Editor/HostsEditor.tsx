/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import { IHostsListObject } from '@common/data'
import events from '@common/events'
import { normalizeLineEndings } from '@common/newlines'
import { IFindShowSourceParam } from '@common/types'
import StatusBar from '@renderer/components/StatusBar'
import { actions, agent } from '@renderer/core/agent'
import useOnBroadcast from '@renderer/core/useOnBroadcast'
import useHostsData from '@renderer/models/useHostsData'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useDebounceFn } from 'ahooks'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import {
  buildExtensions,
  type BuiltExtensions,
  readOnlyExtensions,
} from './hosts_cm'
import { toggleCommentByLine, toggleCommentBySelection } from './hosts_highlight'
import styles from './HostsEditor.module.scss'

const HostsEditor = () => {
  const { current_hosts, isReadOnly } = useHostsData()
  const hosts_id = current_hosts?.id || '0'
  const is_read_only = isReadOnly(current_hosts)
  const [content, setContent] = useState('')

  const ref_mount = useRef<HTMLDivElement>(null)
  const ref_view = useRef<EditorView | null>(null)
  const ref_built = useRef<BuiltExtensions | null>(null)
  // Refs mirror React state so that callbacks captured by EditorView extensions
  // (which are created once on mount) can always read the latest values.
  const ref_hosts_id = useRef(hosts_id)
  const ref_is_read_only = useRef(is_read_only)
  // Pending find: when a show_source event arrives before the target hosts is loaded
  // (List broadcasts select_hosts then show_source synchronously, but hosts_id only
  // updates on the next render), we stash the params here and apply them once
  // loadContent finishes (with a 3s timeout to avoid stale state).
  const ref_pending_find = useRef<IFindShowSourceParam | null>(null)
  const ref_pending_find_timer = useRef<number | null>(null)

  const clearPendingFind = () => {
    if (ref_pending_find_timer.current) {
      window.clearTimeout(ref_pending_find_timer.current)
      ref_pending_find_timer.current = null
    }
    ref_pending_find.current = null
  }

  useEffect(() => clearPendingFind, [])

  useEffect(() => {
    ref_hosts_id.current = hosts_id
  }, [hosts_id])

  useEffect(() => {
    ref_is_read_only.current = is_read_only
  }, [is_read_only])

  const { run: toSave } = useDebounceFn(
    (id: string, nextContent: string) => {
      actions
        .setHostsContent(id, nextContent)
        .then(() => agent.broadcast(events.hosts_content_changed, id))
        .catch((e) => console.error(e))
    },
    { wait: 1000 },
  )

  const onDocChange = (nextContent: string) => {
    const normalizedContent = normalizeLineEndings(nextContent)
    setContent(normalizedContent)
    toSave(ref_hosts_id.current, normalizedContent)
  }

  const onGutterClick = (lineIndex: number) => {
    if (ref_is_read_only.current) return
    const view = ref_view.current
    if (!view) return
    if (view.composing) return

    const code = view.state.doc.toString()
    const sel = view.state.selection.main
    const next = toggleCommentByLine(code, lineIndex, sel.from, sel.to)
    if (!next.changed) return

    view.dispatch({
      changes: next.changes,
      selection: { anchor: next.selectionStart, head: next.selectionEnd },
    })
    view.focus()
  }

  const toggleComment = () => {
    if (ref_is_read_only.current) return
    const view = ref_view.current
    if (!view) return
    // Skip while an IME composition is active to avoid dropping characters.
    if (view.composing) return

    const code = view.state.doc.toString()
    const sel = view.state.selection.main
    const next = toggleCommentBySelection(code, sel.from, sel.to, true)
    if (!next.changed) return

    view.dispatch({
      changes: next.changes,
      selection: { anchor: next.selectionStart, head: next.selectionEnd },
      scrollIntoView: true,
    })
    view.focus()
  }

  /** Restore a character-offset selection in the editor (used by find/show-source). */
  const setSelection = (params: IFindShowSourceParam) => {
    const view = ref_view.current
    if (!view) return

    const docLen = view.state.doc.length
    const start = Math.max(0, Math.min(params.start, docLen))
    const end = Math.max(0, Math.min(params.end, docLen))
    view.dispatch({
      selection: { anchor: start, head: end },
      effects: EditorView.scrollIntoView(start, { y: 'center' }),
    })
    view.focus()
  }

  /**
   * Build a fresh set of extensions bound to the current readOnly value, then
   * either install them on a new EditorView or apply via setState. We rebuild
   * on every doc swap because setState resets compartments to the value bound
   * at extension-creation time — reusing the mount-time extensions would silently
   * revert any subsequent readOnly reconfigure.
   */
  const rebuildExtensions = () =>
    buildExtensions({
      initialReadOnly: ref_is_read_only.current,
      onDocChange,
      onGutterClick,
    })

  /** Fetch hosts content and replace the editor state (clears undo history). */
  const loadContent = async (targetHostsId = hosts_id) => {
    const view = ref_view.current
    if (!view) return

    const nextContent = normalizeLineEndings(
      targetHostsId === '0'
        ? await actions.getSystemHosts()
        : await actions.getHostsContent(targetHostsId),
    )

    if (ref_hosts_id.current !== targetHostsId) return

    setContent(nextContent)
    const built = rebuildExtensions()
    ref_built.current = built
    view.setState(EditorState.create({ doc: nextContent, extensions: built.extensions }))

    const pendingFind = ref_pending_find.current
    if (pendingFind && pendingFind.item_id === targetHostsId) {
      setSelection(pendingFind)
      clearPendingFind()
    }
  }

  // Mount EditorView once; survive across hosts switches via setState.
  useEffect(() => {
    const mount = ref_mount.current
    if (!mount) return

    const built = rebuildExtensions()
    const view = new EditorView({
      state: EditorState.create({ doc: '', extensions: built.extensions }),
      parent: mount,
    })

    ref_built.current = built
    ref_view.current = view

    return () => {
      view.destroy()
      ref_view.current = null
      ref_built.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load content when the active hosts changes.
  useEffect(() => {
    loadContent(hosts_id).catch((e) => console.error(e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts_id])

  // Reconfigure read-only state via the compartment without rebuilding the editor.
  useEffect(() => {
    const view = ref_view.current
    const built = ref_built.current
    if (!view || !built) return

    view.dispatch({
      effects: built.readOnlyCompartment.reconfigure(readOnlyExtensions(is_read_only)),
    })
  }, [is_read_only])

  useOnBroadcast(
    events.hosts_refreshed,
    (h: IHostsListObject) => {
      if (hosts_id !== '0' && h.id !== hosts_id) return
      loadContent().catch((e) => console.error(e))
    },
    [hosts_id],
  )

  useOnBroadcast(
    events.hosts_refreshed_by_id,
    (id: string) => {
      if (hosts_id !== '0' && hosts_id !== id) return
      loadContent().catch((e) => console.error(e))
    },
    [hosts_id],
  )

  useOnBroadcast(
    events.set_hosts_on_status,
    () => {
      if (hosts_id === '0') {
        loadContent().catch((e) => console.error(e))
      }
    },
    [hosts_id],
  )

  useOnBroadcast(
    events.system_hosts_updated,
    () => {
      if (hosts_id === '0') {
        loadContent().catch((e) => console.error(e))
      }
    },
    [hosts_id],
  )

  useOnBroadcast(events.toggle_comment, toggleComment, [hosts_id])

  useOnBroadcast(
    events.show_source,
    (params: IFindShowSourceParam) => {
      // Cross-host jump: List broadcasts select_hosts to switch the active hosts,
      // but hosts_id only updates on the next render. Stash params and let
      // loadContent apply them after setState.
      if (params.item_id !== hosts_id || !ref_view.current) {
        clearPendingFind()
        ref_pending_find.current = params
        ref_pending_find_timer.current = window.setTimeout(clearPendingFind, 3000)
        return
      }

      clearPendingFind()
      setSelection(params)
    },
    [hosts_id],
  )

  return (
    <div className={styles.root}>
      <div className={clsx(styles.editor, is_read_only && styles.read_only)}>
        <div ref={ref_mount} className={styles.mount} />
      </div>

      <StatusBar
        line_count={content.split('\n').length}
        bytes={content.length}
        read_only={is_read_only}
      />
    </div>
  )
}

export default HostsEditor
