import { LitElement, html, customElement, property, css, internalProperty } from 'lit-element'

@customElement('lit-log')
export default class extends LitElement {
  @internalProperty()
  private entries: Array<{ date: Date, entry: any }> = []

  @property({ type: Boolean })
  open = false

  @property()
  entry: any

  static readonly styles = css`
    :host {
      display: block;
      margin: 1em
    }
    .error {
      color: red
    }`

  protected updated(attrs: Map<string, string>) {
    if (attrs.has('entry') && this.entry && this.entry != attrs.get('entry')) {
      if (Array.isArray(this.entry))
        for (const entry of this.entry)
          this.entries = [{ entry, date: new Date }, ...this.entries]
      else
        this.entries = [{ entry: this.entry, date: new Date }, ...this.entries]
    }
  }

  protected readonly render = () => html`
    <details ?open=${this.open}>
      <summary><slot></slot> Log</summary>

      ${this.entries.map(({ date, entry }) => html`
        <pre
          title="${date.toLocaleTimeString()}"
          class=${entry instanceof Error ? 'error' : ''}
        >${entry instanceof Error
      ? entry.stack ? entry.stack : entry.message // Stack isn't always available
      : entry
    }</pre>`)}
    </details>`
}
