import { LitElement, html, customElement, property, css } from 'lit-element'

@customElement('lit-log')
export default class extends LitElement {
  @property({ type: Array, attribute: false })
  private entries: Array<{ date: Date, entry: any }> = []

  @property({ type: Boolean })
  private open = false

  @property()
  private entry: any

  static readonly styles = css`
    :host {
      display: block;
      margin: 1em
    }
    .error {
      color: red
    }
  `

  updated(attrs: Map<string, string>) {
    if (attrs.has('entry') && this.entry && this.entry != attrs.get('entry')) {
      if (Array.isArray(this.entry))
        for (const entry of this.entry)
          this.entries = [{ entry, date: new Date }, ...this.entries]
      else
        this.entries = [{ entry: this.entry, date: new Date }, ...this.entries]
    }
  }

  render = () => html`
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
  </details>
  `
}
