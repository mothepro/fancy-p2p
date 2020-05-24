import { html, render } from 'lit-html'
import 'lit-log'
import './peer.js'

const params = new URLSearchParams(location.search)

// Add `lit-peer` element with the attributes if user has a name.
if (params.has('name'))
  render(html`
    <lit-peer
      name=${params.get('name')!}
      retries=5
      timeout=5000
    ></lit-peer>`,
    document.getElementById('main')!)
