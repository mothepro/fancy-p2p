import { LitElement, html, customElement, property, css, internalProperty } from 'lit-element'

export type LogEntry = any

declare global {
  interface HTMLElementEventMap {
    log: CustomEvent<LogEntry>
  }
}

/**
 * Stores events in a log.
 * Listens to events of type `log` and the `entry` attribute.
 */
@customElement('lit-log')
export default class extends LitElement {
  @internalProperty()
  private entries: Array<{ date: Date, entry: LogEntry }> = []

  @property({ type: Boolean })
  open = false

  @property()
  entry: LogEntry

  static readonly styles = css`
    :host {
      display: block;
      margin: 0.5em;
    }
    :host details {
      margin-top: 1em;
    }
    .error {
      color: red
    }`

  protected updated(attrs: Map<string, string>) {
    if (attrs.has('entry') && this.entry && this.entry != attrs.get('entry'))
      this.prependEntry(this.entry)
  }

  protected prependEntry(...entries: LogEntry[]) {
    for (const entry of entries)
      this.entries = [{ entry, date: new Date }, ...this.entries]
    return true
  }

  protected readonly render = () => html`
    <slot @log=${(e: CustomEvent<LogEntry>) => this.prependEntry(...e.detail) && e.stopPropagation()}></slot>

    <details ?open=${this.open}>
      <summary>
        <slot name="summary">Log</slot>
      </summary>

      ${this.entries.map(({ date, entry }) => html`
        <pre
          title="${date.toLocaleTimeString()}"
          class=${entry instanceof Error ? 'error' : ''}
        >${
        entry instanceof Error
          ? entry.stack ? entry.stack : entry.message // Stack isn't always available
          : entry}
        </pre>`)}
    </details>`
}
