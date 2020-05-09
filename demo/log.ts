import { LitElement, html, customElement, property } from 'lit-element'

@customElement('lit-log')
export default class extends LitElement {
  @property({ type: Array, attribute: false })
  private entries: Array<{ date: Date, entry: any }> = []

  @property()
  private entry: any

  updated(attrs: Map<string, string>) {
    if (attrs.has('entry') && this.entry && this.entry != attrs.get('entry'))
      this.entries = [...this.entries, { entry: this.entry, date: new Date }]
    console.log(this.entries)
  }

  render = () => html`
  <details open>
    <summary>Log</summary>

    ${this.entries.map(({ date, entry }) => html`
      <pre
        title="${date.toLocaleTimeString()}"
        .style=${ entry instanceof Error ? 'color: red' : undefined}
      >${entry instanceof Error
          ? entry.stack
          : entry}
      </pre>`)}
  </details>
  `
}
