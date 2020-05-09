import { LitElement, html, customElement, property, css } from 'lit-element'

@customElement('lit-log')
export default class extends LitElement {
  @property({ type: Array, attribute: false })
  private entries: Array<{ date: Date, entry: any }> = []

  @property()
  private entry: any

  static readonly styles = css`
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
  <details open>
    <summary>Log</summary>

    ${this.entries.map(({ date, entry }) => html`
      <pre
        title="${date.toLocaleTimeString()}"
        class=${entry instanceof Error ? 'error' : ''}
      >${
      entry instanceof Error
        ? entry.stack
        : entry
      }</pre>`)}
  </details>
  `
}
